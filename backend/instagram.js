// ============================================================
// CTRLpanel — Instagram account analytics (multi-user, multi-account OAuth)
//
// Uses "Instagram API with Instagram Login" (Meta): the owner signs in with
// their Instagram professional (Business or Creator) account, so no Facebook
// Page is involved. A short-lived code becomes a 60-day token that is
// refreshed whenever analytics are loaded. Each connected account is its own
// row in `instagram_accounts` (token included, service-role only — never sent
// to the browser), mirroring `youtube_channels`.
//
// Plain REST `fetch` + `node:crypto` only, so the same module runs in Express
// dev and the Cloudflare Worker. Env is read at call time.
//
// Insights notes (verified against Meta's docs): `views`, `reach`,
// `accounts_engaged`, … are `total_value` metrics; `reach` and `follower_count`
// also give a daily series. `impressions` is retired. Account insights reach
// back ~30 days per request, hence the short ranges below. `follower_count`
// is only returned for accounts with 100+ followers.
// ============================================================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const SHORT_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';
const SCOPES = 'instagram_business_basic,instagram_business_manage_insights';
const DAY = 86400000;
// Long-lived tokens last 60 days; refresh once fewer than this many remain.
const REFRESH_WITHIN = 20 * DAY;

export const RANGE_DAYS = { '7d': 7, '14d': 14, '28d': 28, '30d': 30 };

const PUBLIC_COLUMNS =
  'id, ig_user_id, username, name, label, account_type, profile_picture_url, followers_count, follows_count, media_count';

/** Account totals we ask for, mapped to the keys the UI reads. */
const TOTAL_METRICS = {
  views: 'views',
  reach: 'reach',
  accounts_engaged: 'accountsEngaged',
  total_interactions: 'interactions',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves',
  profile_links_taps: 'profileTaps',
};

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count';
const POST_LIMIT = 12;

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

function requireAdmin() {
  const client = admin();
  if (!client) throw new Error('Instagram storage is not configured on the server.');
  return client;
}

/** A missing table means the migration hasn't been applied — say so plainly. */
function dbError(action, error) {
  const missing = error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || '');
  if (missing) {
    return new Error('The instagram_accounts table is missing. Run migrations/20261006-socials-instagram.sql in Supabase.');
  }
  return new Error(`${action}: ${error.message}`);
}

export class InstagramError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'InstagramError';
    this.code = code;
    this.status = status;
  }
}

/** Turn a Graph error payload into something the owner can act on. */
export function graphError(status, err = {}) {
  const code = Number(err.code);
  const message = String(err.message || '').slice(0, 200);
  if (code === 190 || status === 401) {
    return new InstagramError('Instagram access expired or was revoked. Reconnect this account.', { code, status });
  }
  if (code === 10 || (code >= 200 && code <= 299)) {
    return new InstagramError('Instagram did not grant permission for this data. Reconnect and approve every permission.', { code, status });
  }
  if ([4, 17, 32, 613].includes(code)) {
    return new InstagramError('Instagram is rate limiting requests. Try again in a few minutes.', { code, status });
  }
  return new InstagramError(`Instagram API ${status}${message ? `: ${message}` : ''}`, { code, status });
}

/* ---- Config ---- */
export function instagramRedirectUri() {
  if (process.env.INSTAGRAM_REDIRECT_URI) return process.env.INSTAGRAM_REDIRECT_URI;
  const cal = process.env.GOOGLE_REDIRECT_URI || '';
  return cal.includes('/calendar/') ? cal.replace('/calendar/', '/instagram/') : '';
}
const redirectUri = instagramRedirectUri;

export function instagramReady() {
  return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && redirectUri() && admin());
}

/* ---- Signed OAuth state (carries the user id) ---- */
const stateSecret = () => process.env.INSTAGRAM_APP_SECRET || 'ctrlpanel-instagram-state';
export function signInstagramState(userId) {
  const body = `${userId}.${Date.now() + 10 * 60 * 1000}`;
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
}
export function verifyInstagramState(state) {
  const [userId, exp, sig] = Buffer.from(String(state), 'base64url').toString().split('.');
  const expect = createHmac('sha256', stateSecret()).update(`${userId}.${exp}`).digest('base64url');
  const provided = Buffer.from(sig || '');
  const expected = Buffer.from(expect);
  if (!sig || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid Instagram connection state.');
  }
  if (!Number.isFinite(Number(exp)) || Date.now() > Number(exp)) {
    throw new Error('The Instagram connection request expired. Please try again.');
  }
  return userId;
}

export function instagramAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    enable_fb_login: '0',
    force_authentication: '1',
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/* ---- Graph helper ---- */
function graphUrl(path, params, versioned) {
  const version = versioned && process.env.INSTAGRAM_API_VERSION ? `/${process.env.INSTAGRAM_API_VERSION}` : '';
  return `${GRAPH}${version}${path}?${new URLSearchParams(params).toString()}`;
}

/**
 * GET against graph.instagram.com. Errors never echo the URL (it carries the
 * access token). Token endpoints are unversioned, data endpoints follow the
 * optional INSTAGRAM_API_VERSION (otherwise the app's default).
 */
async function graph(path, params, token, { versioned = true } = {}) {
  const res = await fetch(graphUrl(path, { ...params, access_token: token }, versioned));
  const text = await res.text().catch(() => '');
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok || body.error) throw graphError(res.status, body.error);
  return body;
}

/* ---- OAuth flow ---- */
export async function exchangeInstagramCode(userId, rawCode) {
  // Meta appends "#_" to the redirect; it is not part of the code.
  const code = String(rawCode || '').replace(/#_$/, '');
  if (!userId || !code) throw new Error('The Instagram connection response was incomplete.');

  const shortRes = await fetch(SHORT_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code,
    }),
  });
  const shortBody = await shortRes.json().catch(() => ({}));
  if (!shortRes.ok || shortBody.error_message || shortBody.error) {
    const why = shortBody.error_message || shortBody.error?.message || `status ${shortRes.status}`;
    throw new Error(`Instagram token exchange failed: ${String(why).slice(0, 200)}`);
  }
  // Current docs wrap the result in `data: [ … ]`; older responses are flat.
  const first = Array.isArray(shortBody.data) ? shortBody.data[0] : shortBody;
  if (!first?.access_token) throw new Error('Instagram did not return an access token.');

  const long = await graph('/access_token', { grant_type: 'ig_exchange_token', client_secret: process.env.INSTAGRAM_APP_SECRET }, first.access_token, { versioned: false });
  const token = long.access_token || first.access_token;
  const profile = await fetchProfile(token);

  const igUserId = String(profile.user_id || first.user_id || '');
  if (!igUserId) throw new Error('Instagram did not say which account this is.');
  const row = {
    user_id: userId,
    ig_user_id: igUserId,
    username: profile.username || null,
    name: profile.name || null,
    account_type: profile.account_type || null,
    profile_picture_url: profile.profile_picture_url || null,
    followers_count: Number(profile.followers_count || 0),
    follows_count: Number(profile.follows_count || 0),
    media_count: Number(profile.media_count || 0),
    access_token: token,
    scope: Array.isArray(first.permissions) ? first.permissions.join(',') : first.permissions || SCOPES,
    expires_at: Date.now() + Number(long.expires_in || 5184000) * 1000,
    updated_at: new Date().toISOString(),
  };
  // `label` is deliberately absent so reconnecting keeps the owner's own name.
  const { error } = await requireAdmin().from('instagram_accounts').upsert(row, { onConflict: 'user_id,ig_user_id' });
  if (error) throw dbError('Could not save Instagram account', error);
  return row.username;
}

function fetchProfile(token) {
  return graph('/me', { fields: 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count' }, token);
}

/* ---- Account list / rename / disconnect ---- */
/** Public account list (no tokens). */
export async function listInstagramAccounts(userId) {
  if (!admin()) return [];
  const { data, error } = await admin()
    .from('instagram_accounts')
    .select(PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw dbError('Could not load Instagram accounts', error);
  return data || [];
}

/** Rename the sidebar section. An empty label falls back to @username. */
export async function renameInstagramAccount(userId, id, label) {
  if (!id) throw new Error('Account id is required.');
  const next = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null;
  const { data, error } = await requireAdmin()
    .from('instagram_accounts')
    .update({ label: next, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select(PUBLIC_COLUMNS)
    .maybeSingle();
  if (error) throw dbError('Could not rename Instagram account', error);
  if (!data) throw new Error('Account not found.');
  return data;
}

export async function disconnectInstagramAccount(userId, id) {
  if (!id) throw new Error('Account id is required.');
  const { error } = await requireAdmin().from('instagram_accounts').delete().eq('id', id).eq('user_id', userId);
  if (error) throw dbError('Could not disconnect Instagram account', error);
  return { ok: true };
}

/* ---- Tokens ---- */
/**
 * A usable access token for `row`, refreshing the 60-day token when it is
 * getting old. A failed refresh is not fatal while the current token is still
 * valid (Meta only refreshes tokens that are 24h+ old).
 */
async function liveToken(row, save) {
  if (!row?.access_token) throw new InstagramError('Instagram is not connected. Reconnect this account.');
  const left = Number(row.expires_at || 0) - Date.now();
  if (left <= 0) throw new InstagramError('Instagram access expired. Reconnect this account.');
  if (left < REFRESH_WITHIN) {
    try {
      const t = await graph('/refresh_access_token', { grant_type: 'ig_refresh_token' }, row.access_token, { versioned: false });
      if (t.access_token) {
        await save({
          access_token: t.access_token,
          expires_at: Date.now() + Number(t.expires_in || 5184000) * 1000,
          updated_at: new Date().toISOString(),
        });
        return t.access_token;
      }
    } catch { /* keep the still-valid token; try again next load */ }
  }
  return row.access_token;
}

/* ---- Pure parsing helpers (exported for tests) ---- */
/** "2024-05-02T07:00:00+0000" → ms. V8 is lenient, but normalise the offset anyway. */
const parseTime = (s) => Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));

/**
 * Instagram labels a daily value with the END of its period (07:00 UTC ≈
 * Pacific midnight). The value belongs to the day before that moment.
 */
export function dayOfEnd(endTime) {
  const t = parseTime(endTime);
  return Number.isFinite(t) ? new Date(t - DAY).toISOString().slice(0, 10) : null;
}

/** A time-series insights response → [{ date, value }] sorted by date. */
export function parseSeries(body) {
  const values = body?.data?.[0]?.values || [];
  return values
    .map((v) => ({ date: dayOfEnd(v.end_time), value: Number(v.value || 0) }))
    .filter((v) => v.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A total_value insights response → { [metric name]: number }. */
export function parseTotals(body) {
  const out = {};
  for (const d of body?.data || []) {
    const value = d.total_value?.value ?? d.values?.[0]?.value;
    if (d.name && value !== undefined && value !== null) out[d.name] = Number(value) || 0;
  }
  return out;
}

/** Join reach + follower series on date. */
export function mergeSeries(reach, followers) {
  const byDate = new Map();
  for (const p of reach) byDate.set(p.date, { date: p.date, reach: p.value, newFollowers: null });
  for (const p of followers) {
    const point = byDate.get(p.date) || { date: p.date, reach: null, newFollowers: null };
    point.newFollowers = p.value;
    byDate.set(p.date, point);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** A /me/media item (+ optional insights) → what the Posts grid renders. */
export function normalizePost(item, insights = {}) {
  const type = item.media_product_type === 'REELS' ? 'Reel' : item.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : item.media_type === 'VIDEO' ? 'Video' : 'Post';
  return {
    id: item.id,
    type,
    caption: String(item.caption || '').slice(0, 160),
    permalink: item.permalink || null,
    thumbnail: item.thumbnail_url || (item.media_type === 'VIDEO' ? null : item.media_url) || null,
    timestamp: item.timestamp || null,
    likes: item.like_count ?? null,
    comments: item.comments_count ?? null,
    reach: insights.reach ?? null,
    views: insights.views ?? null,
    interactions: insights.total_interactions ?? null,
  };
}

/* ---- Analytics fetchers ---- */
const windowParams = (since, until) => ({ period: 'day', since, until });

async function fetchTotals(token, since, until) {
  const names = Object.keys(TOTAL_METRICS);
  const ask = (metric) => graph('/me/insights', { metric, metric_type: 'total_value', ...windowParams(since, until) }, token);
  try {
    return parseTotals(await ask(names.join(',')));
  } catch (e) {
    // One unsupported metric fails the whole request — retry one by one so the
    // rest still show. A dead token fails them all, so surface that instead.
    if (e.code === 190 || e.status === 401) throw e;
    const settled = await Promise.allSettled(names.map((n) => ask(n)));
    return settled.reduce((acc, r) => (r.status === 'fulfilled' ? { ...acc, ...parseTotals(r.value) } : acc), {});
  }
}

async function fetchSeries(token, metric, since, until) {
  const params = { metric, ...windowParams(since, until) };
  if (metric === 'reach') params.metric_type = 'time_series';
  return parseSeries(await graph('/me/insights', params, token));
}

async function fetchPostInsights(token, id) {
  for (const metric of ['reach,views,total_interactions', 'reach']) {
    try {
      return parseTotals(await graph(`/${id}/insights`, { metric }, token));
    } catch (e) {
      if (e.code === 190 || e.status === 401) throw e;
    }
  }
  return {};
}

async function fetchPosts(token) {
  const media = await graph('/me/media', { fields: MEDIA_FIELDS, limit: String(POST_LIMIT) }, token);
  const items = media.data || [];
  return Promise.all(items.map(async (item) => normalizePost(item, await fetchPostInsights(token, item.id).catch(() => ({})))));
}

/**
 * Analytics for one stored account row. `save(patch)` persists refreshed
 * tokens / cached counts (injected so tests need no database).
 */
export async function loadInstagramAnalytics(row, range = '30d', { save = async () => {} } = {}) {
  const days = RANGE_DAYS[range] || 30;
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const token = await liveToken(row, save);

  // The profile call doubles as the token check; everything else may degrade.
  const profile = await fetchProfile(token);
  const [totals, reach, followers, posts] = await Promise.allSettled([
    fetchTotals(token, since, until),
    fetchSeries(token, 'reach', since, until),
    fetchSeries(token, 'follower_count', since, until),
    fetchPosts(token),
  ]);
  const ok = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
  // An expired/revoked token should read as such, not as four empty sections.
  const dead = [totals, reach, followers, posts].find((r) => r.status === 'rejected' && (r.reason?.code === 190 || r.reason?.status === 401));
  if (dead) throw dead.reason;

  const raw = ok(totals, {});
  const mapped = {};
  const unavailable = [];
  for (const [metric, key] of Object.entries(TOTAL_METRICS)) {
    mapped[key] = raw[metric] ?? null;
    if (raw[metric] === undefined) unavailable.push(metric);
  }

  const notes = [];
  if (totals.status === 'rejected') notes.push(`Account totals couldn’t be loaded: ${totals.reason?.message}`);
  if (reach.status === 'rejected') notes.push(`Daily reach couldn’t be loaded: ${reach.reason?.message}`);
  if (followers.status === 'rejected') notes.push('New followers per day isn’t available (Instagram only reports it for accounts with 100+ followers).');
  if (posts.status === 'rejected') notes.push(`Recent posts couldn’t be loaded: ${posts.reason?.message}`);

  const account = {
    id: row.id,
    ig_user_id: row.ig_user_id,
    username: profile.username || row.username,
    name: profile.name || row.name,
    label: row.label || null,
    account_type: profile.account_type || row.account_type,
    profile_picture_url: profile.profile_picture_url || row.profile_picture_url,
    followers_count: Number(profile.followers_count ?? row.followers_count ?? 0),
    follows_count: Number(profile.follows_count ?? row.follows_count ?? 0),
    media_count: Number(profile.media_count ?? row.media_count ?? 0),
  };
  try {
    await save({
      username: account.username,
      name: account.name,
      account_type: account.account_type,
      profile_picture_url: account.profile_picture_url,
      followers_count: account.followers_count,
      follows_count: account.follows_count,
      media_count: account.media_count,
      updated_at: new Date().toISOString(),
    });
  } catch { /* cached counts are optional */ }

  return {
    account,
    range: RANGE_DAYS[range] ? range : '30d',
    days,
    totals: mapped,
    unavailable,
    series: mergeSeries(ok(reach, []), ok(followers, [])),
    hasFollowerSeries: followers.status === 'fulfilled',
    posts: ok(posts, []),
    notes,
  };
}

/** Analytics for one connected account, by id. */
export async function getInstagramAnalytics(userId, id, range = '30d') {
  if (!id) throw new Error('Account id is required.');
  const { data: row, error } = await requireAdmin()
    .from('instagram_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw dbError('Could not load Instagram account', error);
  if (!row) throw new Error('Account not found.');
  const save = async (patch) => {
    const { error: saveError } = await requireAdmin().from('instagram_accounts').update(patch).eq('id', row.id);
    if (saveError) throw dbError('Could not save Instagram account', saveError);
  };
  return loadInstagramAnalytics(row, range, { save });
}
