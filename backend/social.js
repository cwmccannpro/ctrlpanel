// ============================================================
// CTRLpanel — sharing + social (server-side, service role)
//
// Covers: shared to-do list invites, nutrition friend invites, the
// universal tokenized accept flow, leaderboards, and challenges.
//
// Everything here runs with the service role because it must (a) write
// invite rows on behalf of two users and (b) aggregate friends' metrics
// WITHOUT exposing raw logs — clients only ever receive the numbers
// computed here. Workers-compatible: fetch-based SDK + node:crypto only.
// ============================================================
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sendInviteEmail, sendAcceptedEmail } from './email.js';

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  if (!_admin) throw new Error('Supabase service role is not configured on the server.');
  return _admin;
}

const newToken = () => randomBytes(24).toString('base64url');
const norm = (email) => String(email || '').trim().toLowerCase();
const dayKey = (ts) => String(ts || '').slice(0, 10);
const todayKey = () => new Date().toISOString().slice(0, 10);

// Display name for a set of user ids (falls back to the email's local part).
async function namesFor(userIds) {
  if (!userIds.length) return {};
  const { data } = await admin().from('profiles').select('id, full_name, email').in('id', userIds);
  const map = {};
  for (const p of data || []) {
    map[p.id] = { name: p.full_name || (p.email || '').split('@')[0] || 'Member', email: p.email };
  }
  return map;
}

// Does an account already exist for this email? (profiles mirrors auth.users)
async function userIdByEmail(email) {
  const { data } = await admin().from('profiles').select('id').ilike('email', email).maybeSingle();
  return data?.id || null;
}

/* ============================================================
 * Shared to-do lists
 * ============================================================ */

export async function createBoardShare(user, { board_id, email }, appUrl) {
  const invitee = norm(email);
  if (!invitee || !invitee.includes('@')) throw new Error('Enter a valid email address.');
  if (invitee === norm(user.email)) throw new Error("You can't share a list with yourself.");
  if (!board_id) throw new Error('Missing board_id.');

  const { data: board } = await admin().from('boards').select('id, name, user_id').eq('id', board_id).maybeSingle();
  if (!board) throw new Error('Board not found.');
  if (board.user_id !== user.id) throw new Error('Only the list owner can share it.');

  const { data: existing } = await admin()
    .from('board_shares').select('id, status').eq('board_id', board_id).eq('invitee_email', invitee).maybeSingle();
  if (existing) throw new Error(existing.status === 'accepted' ? 'That person already has access.' : 'An invite for that email is already pending.');

  const row = {
    board_id,
    owner_id: user.id,
    board_name: board.name,
    inviter_email: user.email,
    invitee_email: invitee,
    invitee_user_id: await userIdByEmail(invitee),
    token: newToken(),
    status: 'pending',
  };
  const { data, error } = await admin().from('board_shares').insert(row).select().single();
  if (error) throw new Error(error.message);

  try {
    await sendInviteEmail({
      to: invitee,
      inviterName: user.user_metadata?.full_name || user.email,
      kind: 'board',
      boardName: board.name,
      token: row.token,
      appUrl,
    });
  } catch (e) {
    // Don't leave an invite the recipient never heard about.
    await admin().from('board_shares').delete().eq('id', data.id);
    throw e;
  }
  return data;
}

/* ============================================================
 * Nutrition friends
 * ============================================================ */

export async function createFriendInvite(user, { email }, appUrl) {
  const invitee = norm(email);
  if (!invitee || !invitee.includes('@')) throw new Error('Enter a valid email address.');
  if (invitee === norm(user.email)) throw new Error("You can't friend yourself.");

  // Any existing connection in either direction blocks a duplicate invite.
  const { data: mine } = await admin()
    .from('nutrition_friends').select('id, status').eq('inviter_id', user.id).eq('invitee_email', invitee);
  const { data: theirs } = await admin()
    .from('nutrition_friends').select('id, status').ilike('inviter_email', invitee).eq('invitee_user_id', user.id);
  const existing = [...(mine || []), ...(theirs || [])][0];
  if (existing) throw new Error(existing.status === 'accepted' ? "You're already friends." : 'An invite between you is already pending.');

  const row = {
    inviter_id: user.id,
    inviter_email: user.email,
    invitee_email: invitee,
    invitee_user_id: await userIdByEmail(invitee),
    token: newToken(),
    status: 'pending',
  };
  const { data, error } = await admin().from('nutrition_friends').insert(row).select().single();
  if (error) throw new Error(error.message);

  try {
    await sendInviteEmail({
      to: invitee,
      inviterName: user.user_metadata?.full_name || user.email,
      kind: 'friend',
      token: row.token,
      appUrl,
    });
  } catch (e) {
    await admin().from('nutrition_friends').delete().eq('id', data.id);
    throw e;
  }
  return data;
}

/**
 * Friends overview for the signed-in user:
 *   friends  — accepted connections (id = share row, user_id = the friend)
 *   incoming — pending invites addressed to me (token included so I can accept in-app)
 *   outgoing — pending invites I sent (revocable)
 */
export async function getFriends(user) {
  const email = norm(user.email);
  const { data: sent } = await admin().from('nutrition_friends').select('*').eq('inviter_id', user.id);
  const { data: recvById } = await admin().from('nutrition_friends').select('*').eq('invitee_user_id', user.id);
  const { data: recvByEmail } = await admin().from('nutrition_friends').select('*').ilike('invitee_email', email);

  const seen = new Set();
  const rows = [...(sent || []), ...(recvById || []), ...(recvByEmail || [])].filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  const friendPairs = rows
    .filter((r) => r.status === 'accepted')
    .map((r) => ({ id: r.id, user_id: r.inviter_id === user.id ? r.invitee_user_id : r.inviter_id }))
    .filter((f) => f.user_id && f.user_id !== user.id);
  const names = await namesFor(friendPairs.map((f) => f.user_id));

  // Dedupe friendships that exist in both directions.
  const seenFriends = new Set();
  const friends = friendPairs.filter((f) => {
    if (seenFriends.has(f.user_id)) return false;
    seenFriends.add(f.user_id);
    return true;
  }).map((f) => ({ ...f, name: names[f.user_id]?.name || 'Member', email: names[f.user_id]?.email }));

  return {
    friends,
    incoming: rows
      .filter((r) => r.status === 'pending' && r.inviter_id !== user.id)
      .map((r) => ({ id: r.id, token: r.token, inviter_email: r.inviter_email })),
    outgoing: rows
      .filter((r) => r.status === 'pending' && r.inviter_id === user.id)
      .map((r) => ({ id: r.id, invitee_email: r.invitee_email, created_at: r.created_at })),
  };
}

/** Revoke a pending invite, decline an incoming one, or unfriend. */
export async function removeFriend(user, id) {
  const { data: row } = await admin().from('nutrition_friends').select('*').eq('id', id).maybeSingle();
  if (!row) return { ok: true };
  const isParty = row.inviter_id === user.id || row.invitee_user_id === user.id || norm(row.invitee_email) === norm(user.email);
  if (!isParty) throw new Error('Not your connection.');
  await admin().from('nutrition_friends').delete().eq('id', id);
  return { ok: true };
}

/* ============================================================
 * Universal invite accept (board share OR friend request)
 * The token is the bearer credential from the email; whoever redeems it
 * while signed in becomes the collaborator/friend.
 * ============================================================ */

export async function acceptInvite(user, token) {
  if (!token) throw new Error('Missing invite token.');
  const accepterName = user.user_metadata?.full_name || user.email;

  const { data: share } = await admin().from('board_shares').select('*').eq('token', token).maybeSingle();
  if (share) {
    if (share.owner_id === user.id) throw new Error("You can't accept your own invite.");
    if (share.status !== 'accepted') {
      await admin().from('board_shares')
        .update({ invitee_user_id: user.id, invitee_email: norm(user.email), status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', share.id);
      try {
        await sendAcceptedEmail({ to: share.inviter_email, accepterName, kind: 'board', boardName: share.board_name });
      } catch { /* confirmation email is best-effort */ }
    }
    return { kind: 'board', board_id: share.board_id, board_name: share.board_name };
  }

  const { data: fr } = await admin().from('nutrition_friends').select('*').eq('token', token).maybeSingle();
  if (fr) {
    if (fr.inviter_id === user.id) throw new Error("You can't accept your own invite.");
    if (fr.status !== 'accepted') {
      await admin().from('nutrition_friends')
        .update({ invitee_user_id: user.id, invitee_email: norm(user.email), status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', fr.id);
      try {
        await sendAcceptedEmail({ to: fr.inviter_email, accepterName, kind: 'friend' });
      } catch { /* best-effort */ }
    }
    return { kind: 'friend', inviter_email: fr.inviter_email };
  }

  throw new Error('This invite is invalid or was revoked.');
}

/* ============================================================
 * Metrics (aggregates only — raw logs never leave the server)
 * ============================================================ */

const GOAL_DEFAULTS = { calories: 2400, protein: 180, carbs: 250, fat: 80, water: 64 };

// Inclusive day window [startKey..endKey] clamped to today.
function windowDays(startKey, endKey) {
  const end = endKey < todayKey() ? endKey : todayKey();
  const days = [];
  const d = new Date(`${startKey}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  for (let i = 0; d <= stop && i < 400; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Per-user aggregates over [startKey..endKey]:
 * { calorieGoalDays, proteinGoalDays, logDays, waterTotal,
 *   calorieAdherence, proteinAdherence, daysElapsed }
 */
async function computeStats(userIds, startKey, endKey) {
  const stats = {};
  if (!userIds.length) return stats;
  const days = windowDays(startKey, endKey);
  const from = `${startKey}T00:00:00Z`;
  const to = `${endKey}T23:59:59.999Z`;

  const [{ data: goalRows }, { data: meals }, { data: water }] = await Promise.all([
    admin().from('user_goals').select('user_id, calories, protein, water').in('user_id', userIds),
    admin().from('nutrition_logs').select('user_id, calories, protein, logged_at').in('user_id', userIds).gte('logged_at', from).lte('logged_at', to),
    admin().from('water_logs').select('user_id, amount, logged_at').in('user_id', userIds).gte('logged_at', from).lte('logged_at', to),
  ]);

  const goals = {};
  for (const g of goalRows || []) goals[g.user_id] = goals[g.user_id] || { ...GOAL_DEFAULTS, ...g };

  const byUserDay = {};
  for (const m of meals || []) {
    const k = `${m.user_id}|${dayKey(m.logged_at)}`;
    const t = (byUserDay[k] = byUserDay[k] || { calories: 0, protein: 0, logged: 0 });
    t.calories += Number(m.calories || 0);
    t.protein += Number(m.protein || 0);
    t.logged += 1;
  }
  const waterByUser = {};
  for (const w of water || []) waterByUser[w.user_id] = (waterByUser[w.user_id] || 0) + Number(w.amount || 0);

  for (const uid of userIds) {
    const goal = goals[uid] || GOAL_DEFAULTS;
    let calorieGoalDays = 0, proteinGoalDays = 0, logDays = 0;
    for (const day of days) {
      const t = byUserDay[`${uid}|${day}`];
      if (!t || !t.logged) continue;
      logDays += 1;
      if (t.calories > 0 && t.calories <= Number(goal.calories || GOAL_DEFAULTS.calories)) calorieGoalDays += 1;
      if (Number(goal.protein) > 0 && t.protein >= Number(goal.protein)) proteinGoalDays += 1;
    }
    const n = Math.max(days.length, 1);
    stats[uid] = {
      calorieGoalDays,
      proteinGoalDays,
      logDays,
      waterTotal: Math.round(waterByUser[uid] || 0),
      calorieAdherence: Math.round((100 * calorieGoalDays) / n),
      proteinAdherence: Math.round((100 * proteinGoalDays) / n),
      daysElapsed: days.length,
    };
  }
  return stats;
}

// Consecutive days with ≥1 nutrition log, ending today (or yesterday).
async function computeStreaks(userIds) {
  const streaks = {};
  if (!userIds.length) return streaks;
  const from = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data } = await admin().from('nutrition_logs').select('user_id, logged_at').in('user_id', userIds).gte('logged_at', from);
  const daysByUser = {};
  for (const m of data || []) {
    (daysByUser[m.user_id] = daysByUser[m.user_id] || new Set()).add(dayKey(m.logged_at));
  }
  for (const uid of userIds) {
    const set = daysByUser[uid] || new Set();
    let streak = 0;
    const cursor = new Date();
    // A streak is alive if today OR yesterday is logged.
    if (!set.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (set.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    streaks[uid] = streak;
  }
  return streaks;
}

const LEADERBOARD_METRICS = {
  calories: { label: 'Calorie goal adherence', unit: '%', pick: (s) => s.calorieAdherence },
  protein: { label: 'Protein goal adherence', unit: '%', pick: (s) => s.proteinAdherence },
  water: { label: 'Water intake', unit: 'oz', pick: (s) => s.waterTotal },
  streak: { label: 'Logging streak', unit: 'days', pick: (s, streaks, uid) => streaks[uid] || 0 },
};

export async function getLeaderboard(user, { metric = 'calories', days = 7 } = {}) {
  const def = LEADERBOARD_METRICS[metric] || LEADERBOARD_METRICS.calories;
  const span = Math.min(Math.max(Number(days) || 7, 1), 90);
  const { friends } = await getFriends(user);
  const ids = [user.id, ...friends.map((f) => f.user_id)];

  const start = new Date(Date.now() - (span - 1) * 86400000).toISOString().slice(0, 10);
  const [stats, streaks, names] = await Promise.all([
    computeStats(ids, start, todayKey()),
    metric === 'streak' ? computeStreaks(ids) : Promise.resolve({}),
    namesFor(ids),
  ]);

  const rows = ids
    .map((uid) => ({
      user_id: uid,
      name: uid === user.id ? 'You' : names[uid]?.name || 'Member',
      value: def.pick(stats[uid] || {}, streaks, uid) || 0,
      is_me: uid === user.id,
    }))
    .sort((a, b) => b.value - a.value);

  return { metric, label: def.label, unit: def.unit, days: span, rows };
}

/* ============================================================
 * Challenges
 * ============================================================ */

const CHALLENGE_METRICS = {
  calorie_goal_days: { label: 'Days hitting calorie goal', unit: 'days', pick: (s) => s.calorieGoalDays },
  protein_goal_days: { label: 'Days hitting protein goal', unit: 'days', pick: (s) => s.proteinGoalDays },
  water_total: { label: 'Total water', unit: 'oz', pick: (s) => s.waterTotal },
  log_days: { label: 'Days logged', unit: 'days', pick: (s) => s.logDays },
};

export async function createChallenge(user, { name, metric, starts_on, ends_on, friend_ids = [] }) {
  if (!name?.trim()) throw new Error('Give the challenge a name.');
  if (!CHALLENGE_METRICS[metric]) throw new Error('Unknown challenge metric.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts_on || '') || !/^\d{4}-\d{2}-\d{2}$/.test(ends_on || '')) throw new Error('Pick start and end dates.');
  if (ends_on < starts_on) throw new Error('The end date must be after the start date.');

  const { friends } = await getFriends(user);
  const allowed = new Set(friends.map((f) => f.user_id));
  const invitees = [...new Set(friend_ids)].filter((id) => allowed.has(id));
  if (!invitees.length) throw new Error('Invite at least one friend.');

  const { data: challenge, error } = await admin()
    .from('nutrition_challenges')
    .insert({ creator_id: user.id, name: name.trim(), metric, starts_on, ends_on })
    .select().single();
  if (error) throw new Error(error.message);

  const members = [
    { challenge_id: challenge.id, user_id: user.id, status: 'accepted' },
    ...invitees.map((uid) => ({ challenge_id: challenge.id, user_id: uid, status: 'invited' })),
  ];
  const { error: mErr } = await admin().from('nutrition_challenge_members').insert(members);
  if (mErr) {
    await admin().from('nutrition_challenges').delete().eq('id', challenge.id);
    throw new Error(mErr.message);
  }
  return challenge;
}

/** All challenges I'm part of, with live standings and (when ended) winners. */
export async function listChallenges(user) {
  const { data: myMemberships } = await admin()
    .from('nutrition_challenge_members').select('challenge_id, status').eq('user_id', user.id);
  const ids = [...new Set((myMemberships || []).map((m) => m.challenge_id))];
  if (!ids.length) return [];

  const [{ data: challenges }, { data: members }] = await Promise.all([
    admin().from('nutrition_challenges').select('*').in('id', ids),
    admin().from('nutrition_challenge_members').select('*').in('challenge_id', ids),
  ]);
  const names = await namesFor([...new Set((members || []).map((m) => m.user_id))]);
  const today = todayKey();

  const results = [];
  for (const c of challenges || []) {
    const cMembers = (members || []).filter((m) => m.challenge_id === c.id);
    const accepted = cMembers.filter((m) => m.status === 'accepted').map((m) => m.user_id);
    const def = CHALLENGE_METRICS[c.metric] || CHALLENGE_METRICS.log_days;
    const status = today < c.starts_on ? 'upcoming' : today > c.ends_on ? 'ended' : 'active';

    let standings = [];
    if (status !== 'upcoming' && accepted.length) {
      const stats = await computeStats(accepted, c.starts_on, c.ends_on);
      standings = accepted
        .map((uid) => ({
          user_id: uid,
          name: uid === user.id ? 'You' : names[uid]?.name || 'Member',
          value: def.pick(stats[uid] || {}) || 0,
          is_me: uid === user.id,
        }))
        .sort((a, b) => b.value - a.value);
    }
    const top = standings[0]?.value ?? null;
    results.push({
      ...c,
      metric_label: def.label,
      unit: def.unit,
      status,
      is_creator: c.creator_id === user.id,
      my_status: cMembers.find((m) => m.user_id === user.id)?.status || 'invited',
      members: cMembers.map((m) => ({
        user_id: m.user_id,
        status: m.status,
        name: m.user_id === user.id ? 'You' : names[m.user_id]?.name || 'Member',
      })),
      standings,
      winners: status === 'ended' && top !== null ? standings.filter((s) => s.value === top).map((s) => s.name) : [],
    });
  }
  return results.sort((a, b) => (b.starts_on || '').localeCompare(a.starts_on || ''));
}

export async function respondChallenge(user, challengeId, accept) {
  const { error } = await admin()
    .from('nutrition_challenge_members')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('challenge_id', challengeId)
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteChallenge(user, challengeId) {
  const { data: c } = await admin().from('nutrition_challenges').select('creator_id').eq('id', challengeId).maybeSingle();
  if (!c) return { ok: true };
  if (c.creator_id !== user.id) throw new Error('Only the creator can delete a challenge.');
  await admin().from('nutrition_challenges').delete().eq('id', challengeId);
  return { ok: true };
}
