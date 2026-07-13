import { useState, useEffect, useCallback } from 'react';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import { authApi } from '../../lib/api.js';
import { formatDate } from '../../lib/helpers.js';

// Friends, leaderboard + challenges for the Nutrition section. Everything
// here talks to the backend (/api/social/*), which returns aggregate
// numbers only — friends never see each other's food logs.

const LEADERBOARD_METRICS = [
  { value: 'calories', label: 'Calorie goal %' },
  { value: 'protein', label: 'Protein goal %' },
  { value: 'water', label: 'Water (oz)' },
  { value: 'streak', label: 'Logging streak' },
];

const CHALLENGE_METRICS = [
  { value: 'calorie_goal_days', label: 'Most days hitting calorie goal' },
  { value: 'protein_goal_days', label: 'Most days hitting protein goal' },
  { value: 'water_total', label: 'Most water drunk' },
  { value: 'log_days', label: 'Most days logged' },
];

const STATUS_LABEL = { upcoming: 'Upcoming', active: 'Active', ended: 'Ended' };

function Standings({ rows, unit }) {
  if (!rows?.length) return <p className="body-text">No standings yet.</p>;
  return rows.map((r, i) => (
    <div className="list-row" key={r.user_id}>
      <span className="list-row-meta" style={{ width: 22 }}>#{i + 1}</span>
      <span className="list-row-title" style={r.is_me ? { color: 'var(--accent)' } : undefined}>{r.name}</span>
      <span className="list-row-meta" style={{ color: 'var(--text-primary)' }}>
        {r.value}{unit === '%' ? '%' : ` ${unit}`}
      </span>
    </div>
  ));
}

export default function NutritionSocial() {
  const [social, setSocial] = useState({ friends: [], incoming: [], outgoing: [] });
  const [board, setBoard] = useState(null);
  const [metric, setMetric] = useState('calories');
  const [days, setDays] = useState(7);
  const [challenges, setChallenges] = useState([]);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(null); // { email }
  const [creating, setCreating] = useState(null); // challenge draft
  const [busy, setBusy] = useState(false);

  const loadFriends = useCallback(() => authApi.get('/social/friends').then(setSocial), []);
  const loadBoard = useCallback(
    () => authApi.get(`/social/leaderboard?metric=${metric}&days=${days}`).then(setBoard),
    [metric, days]
  );
  const loadChallenges = useCallback(() => authApi.get('/social/challenges').then(setChallenges), []);

  useEffect(() => {
    Promise.all([loadFriends(), loadChallenges()]).catch((e) => setError(e.message));
  }, [loadFriends, loadChallenges]);

  useEffect(() => {
    loadBoard().catch((e) => setError(e.message));
  }, [loadBoard]);

  const run = async (fn, ...reloads) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await Promise.all(reloads.map((r) => r()));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const sendFriendInvite = () =>
    run(async () => {
      await authApi.post('/social/friends', { email: inviting.email });
      setInviting(null);
    }, loadFriends);

  const acceptFriend = (inv) =>
    run(() => authApi.post('/invites/accept', { token: inv.token }), loadFriends, loadBoard);

  const removeFriend = (id) => run(() => authApi.del(`/social/friends/${id}`), loadFriends, loadBoard);

  const createChallenge = () =>
    run(async () => {
      await authApi.post('/social/challenges', {
        name: creating.name,
        metric: creating.metric,
        starts_on: creating.starts_on,
        ends_on: creating.ends_on,
        friend_ids: creating.friend_ids,
      });
      setCreating(null);
    }, loadChallenges);

  const respondChallenge = (id, accept) =>
    run(() => authApi.post(`/social/challenges/${id}/respond`, { accept }), loadChallenges);

  const deleteChallenge = (id) =>
    run(() => {
      if (!confirm('Delete this challenge for everyone?')) return Promise.resolve();
      return authApi.del(`/social/challenges/${id}`);
    }, loadChallenges);

  const openNewChallenge = () => {
    const today = new Date().toISOString().slice(0, 10);
    const inAWeek = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    setCreating({ name: '', metric: 'calorie_goal_days', starts_on: today, ends_on: inAWeek, friend_ids: [] });
  };

  const toggleFriendPick = (id) =>
    setCreating((c) => ({
      ...c,
      friend_ids: c.friend_ids.includes(id) ? c.friend_ids.filter((f) => f !== id) : [...c.friend_ids, id],
    }));

  return (
    <>
      {error && (
        <Card className="card-section" static>
          <p className="body-text" style={{ color: 'var(--accent)' }}>
            <i className="ti ti-alert-triangle" /> {error}
          </p>
        </Card>
      )}

      <div className="grid grid-2">
        {/* Friends + leaderboard */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Friends & Leaderboard</span>
            <button className="btn btn--sm btn--accent" onClick={() => setInviting({ email: '' })}>
              <i className="ti ti-user-plus" /> Add Friend
            </button>
          </div>

          {social.incoming.map((inv) => (
            <div className="list-row" key={inv.id}>
              <i className="ti ti-mail-heart" style={{ color: 'var(--accent)' }} />
              <span className="list-row-title">{inv.inviter_email}</span>
              <span className="list-row-meta">wants to connect</span>
              <button className="btn btn--sm btn--accent" disabled={busy} onClick={() => acceptFriend(inv)}>Accept</button>
              <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => removeFriend(inv.id)}>Decline</button>
            </div>
          ))}
          {social.outgoing.map((inv) => (
            <div className="list-row" key={inv.id}>
              <i className="ti ti-mail-forward" />
              <span className="list-row-title">{inv.invitee_email}</span>
              <span className="list-row-meta">invited {formatDate(inv.created_at)}</span>
              <button className="btn btn--ghost btn--icon" title="Revoke invite" disabled={busy} onClick={() => removeFriend(inv.id)}>
                <i className="ti ti-x" />
              </button>
            </div>
          ))}

          {social.friends.length === 0 ? (
            <p className="body-text" style={{ marginTop: 8 }}>
              Invite friends by email to compare goal adherence, water intake, and streaks — they only ever
              see your aggregate stats, never your food log.
            </p>
          ) : (
            <>
              <div className="toolbar" style={{ marginTop: 10, marginBottom: 8 }}>
                <select className="select" style={{ width: 'auto' }} value={metric} onChange={(e) => setMetric(e.target.value)}>
                  {LEADERBOARD_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select className="select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </div>
              <Standings rows={board?.rows} unit={board?.unit || ''} />
            </>
          )}
        </Card>

        {/* Challenges */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Challenges</span>
            <button className="btn btn--sm btn--accent" onClick={openNewChallenge} disabled={social.friends.length === 0}>
              <i className="ti ti-trophy" /> New Challenge
            </button>
          </div>

          {challenges.length === 0 && (
            <p className="body-text">
              Create a time-boxed challenge — most days hitting your calorie goal, most water this week —
              and race your friends. Winner is declared when it ends.
            </p>
          )}

          {challenges.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
              <div className="spread">
                <div className="row" style={{ gap: 8 }}>
                  <span className="list-row-title" style={{ fontWeight: 600 }}>{c.name}</span>
                  <span className="badge">{STATUS_LABEL[c.status] || c.status}</span>
                </div>
                {c.is_creator && (
                  <button className="btn btn--ghost btn--icon" title="Delete challenge" disabled={busy} onClick={() => deleteChallenge(c.id)}>
                    <i className="ti ti-trash" />
                  </button>
                )}
              </div>
              <div className="list-row-meta" style={{ margin: '4px 0 8px' }}>
                {c.metric_label} · {formatDate(c.starts_on)} → {formatDate(c.ends_on)}
                {c.status === 'ended' && c.winners?.length > 0 && (
                  <span style={{ color: 'var(--accent)' }}> · <i className="ti ti-trophy" /> {c.winners.join(' & ')} won</span>
                )}
              </div>

              {c.my_status === 'invited' && c.status !== 'ended' ? (
                <div className="row" style={{ gap: 8 }}>
                  <span className="body-text">You're invited —</span>
                  <button className="btn btn--sm btn--accent" disabled={busy} onClick={() => respondChallenge(c.id, true)}>Join</button>
                  <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => respondChallenge(c.id, false)}>Decline</button>
                </div>
              ) : c.status === 'upcoming' ? (
                <p className="body-text">
                  Starts {formatDate(c.starts_on)} · {c.members.filter((m) => m.status === 'accepted').length} joined
                  {c.members.some((m) => m.status === 'invited') && `, ${c.members.filter((m) => m.status === 'invited').length} invited`}
                </p>
              ) : (
                <Standings rows={c.standings} unit={c.unit} />
              )}
            </div>
          ))}
        </Card>
      </div>

      {inviting && (
        <Modal
          title="Add Nutrition Friend"
          onClose={() => setInviting(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setInviting(null)}>Cancel</button>
              <button className="btn btn--accent" disabled={busy || !inviting.email.trim()} onClick={sendFriendInvite}>
                {busy ? 'Sending…' : 'Send invite'}
              </button>
            </>
          }
        >
          <p className="body-text" style={{ marginBottom: 12 }}>
            They'll get an email with an accept link. Once connected you can see each other's aggregate
            stats on leaderboards and challenges — never actual food logs.
          </p>
          <div className="field">
            <label className="field-label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="friend@email.com"
              value={inviting.email}
              onChange={(e) => setInviting({ email: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && inviting.email.trim() && sendFriendInvite()}
              autoFocus
            />
          </div>
        </Modal>
      )}

      {creating && (
        <Modal
          title="New Challenge"
          onClose={() => setCreating(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setCreating(null)}>Cancel</button>
              <button
                className="btn btn--accent"
                disabled={busy || !creating.name.trim() || creating.friend_ids.length === 0}
                onClick={createChallenge}
              >
                {busy ? 'Creating…' : 'Create & invite'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Name</label>
            <input
              className="input"
              placeholder='e.g. "Hydration week"'
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label">Metric</label>
            <select className="select" value={creating.metric} onChange={(e) => setCreating({ ...creating, metric: e.target.value })}>
              {CHALLENGE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Starts</label>
              <input className="input" type="date" value={creating.starts_on} onChange={(e) => setCreating({ ...creating, starts_on: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Ends</label>
              <input className="input" type="date" value={creating.ends_on} onChange={(e) => setCreating({ ...creating, ends_on: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Invite friends</label>
            {social.friends.map((f) => (
              <div className="list-row" key={f.user_id} style={{ cursor: 'pointer' }} onClick={() => toggleFriendPick(f.user_id)}>
                <i className={`ti ${creating.friend_ids.includes(f.user_id) ? 'ti-checkbox' : 'ti-square'}`} style={{ color: 'var(--accent)' }} />
                <span className="list-row-title">{f.name}</span>
                <span className="list-row-meta">{f.email}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
