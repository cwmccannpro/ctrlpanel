// ============================================================
// CTRLpanel — Google Calendar (multi-user OAuth + two-way CRUD)
//
// One app-level OAuth client (GOOGLE_CLIENT_ID/SECRET) authenticates every
// user; each user's tokens are stored per-account in Supabase (google_tokens)
// and only ever touched server-side with the service_role key. The browser
// never sees Google tokens.
//
// Implemented with plain REST `fetch` (no googleapis) so the exact same
// module runs in local Express dev AND the Cloudflare Worker in production.
// ============================================================
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE = 'https://oauth2.googleapis.com/revoke';
const USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CAL_API = 'https://www.googleapis.com/calendar/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// Lazily created so process.env is read at call time (Workers populate it on
// first request via the nodejs_compat flag).
let _admin = null;
let _anon = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}
function anon() {
  if (_anon) return _anon;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) _anon = createClient(url, key, { auth: { persistSession: false } });
  return _anon;
}

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}
export function backendReady() {
  return Boolean(googleConfigured() && admin() && anon());
}

/* ---- Color mapping -------------------------------------------------------
   Google calendars come with arbitrary hex colors that clash with the app's
   dark theme. Remap every Google color to the nearest hue in the app's
   curated palette so calendars keep their identity but look at home. */
const PALETTE = ['#e11d48', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];

function hsl(hex) {
  const s6 = String(hex || '').replace('#', '');
  if (s6.length !== 6) return null;
  const r = parseInt(s6.slice(0, 2), 16) / 255;
  const g = parseInt(s6.slice(2, 4), 16) / 255;
  const b = parseInt(s6.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function mapCalendarColor(googleHex) {
  const c = hsl(googleHex);
  if (!c) return '#3b82f6';
  if (c.s < 0.12) return '#8a7070';
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const ph = hsl(p).h;
    const d = Math.min(Math.abs(c.h - ph), 360 - Math.abs(c.h - ph));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

const GOOGLE_EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26',
  6: '#f4511e', 7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const COLOR_BY_ID = Object.fromEntries(
  Object.entries(GOOGLE_EVENT_COLORS).map(([id, hex]) => [id, mapCalendarColor(hex)])
);
const ID_BY_COLOR = { '#e11d48': '11', '#f97316': '6', '#f59e0b': '5', '#10b981': '10', '#14b8a6': '7', '#3b82f6': '9', '#8b5cf6': '3', '#ec4899': '4' };

/* ---- Stateless signed OAuth state (carries the user id round-trip) ---- */
const stateSecret = () => process.env.GOOGLE_CLIENT_SECRET || 'ctrlpanel-state';
export function signState(userId) {
  const body = `${userId}.${Date.now() + 10 * 60 * 1000}`;
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
}
export function verifyState(state) {
  const [userId, exp, sig] = Buffer.from(String(state), 'base64url').toString().split('.');
  const expect = createHmac('sha256', stateSecret()).update(`${userId}.${exp}`).digest('base64url');
  if (!sig || sig !== expect) throw new Error('bad state');
  if (Date.now() > Number(exp)) throw new Error('state expired');
  return userId;
}

export function authUrl(state) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${OAUTH_AUTH}?${q.toString()}`;
}

/* ---- Supabase auth: token → user ---- */
export async function verifyUserToken(token) {
  if (!token || !anon()) return null;
  const { data, error } = await anon().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
// Express-shaped convenience (Bearer header or ?token=)
export async function verifyUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token || '';
  return verifyUserToken(token);
}

/* ---- Token storage + refresh ---- */
async function saveTokens(userId, tokens, email) {
  const row = { user_id: userId, updated_at: new Date().toISOString() };
  if (tokens.access_token) row.access_token = tokens.access_token;
  if (tokens.refresh_token) row.refresh_token = tokens.refresh_token; // absent on refresh — keep existing
  if (tokens.scope) row.scope = tokens.scope;
  if (tokens.token_type) row.token_type = tokens.token_type;
  if (tokens.expires_in) row.expiry_date = Date.now() + Number(tokens.expires_in) * 1000;
  if (tokens.expiry_date) row.expiry_date = tokens.expiry_date;
  if (email) row.google_email = email;
  await admin().from('google_tokens').upsert(row, { onConflict: 'user_id' });
}

async function tokenRow(userId) {
  const { data } = await admin().from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  return data || null;
}

async function refreshAccessToken(userId, refreshToken) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null; // e.g. invalid_grant after revocation / 7-day test expiry
  const tokens = await res.json();
  await saveTokens(userId, tokens);
  return tokens.access_token;
}

// Valid access token for the user, refreshing if expired. Null → not connected.
async function getAccessToken(userId, force = false) {
  const row = await tokenRow(userId);
  if (!row?.refresh_token) return null;
  const fresh = !force && row.access_token && Number(row.expiry_date || 0) - Date.now() > 60000;
  if (fresh) return row.access_token;
  return refreshAccessToken(userId, row.refresh_token);
}

// Authenticated Google API call with a single retry on 401.
async function gapi(userId, url, init = {}) {
  let token = await getAccessToken(userId);
  if (!token) throw new Error('Google Calendar not connected');
  let res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await getAccessToken(userId, true);
    if (!token) throw new Error('Google Calendar not connected');
    res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---- OAuth flow ---- */
export async function exchangeCode(userId, code) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${(await res.text()).slice(0, 200)}`);
  const tokens = await res.json();

  let email = null;
  try {
    const me = await fetch(USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (me.ok) email = (await me.json()).email;
  } catch { /* email optional */ }

  await saveTokens(userId, tokens, email);
  return email;
}

export async function getStatus(userId) {
  if (!admin()) return { connected: false };
  const row = await tokenRow(userId);
  return { connected: Boolean(row?.refresh_token), email: row?.google_email || null };
}

export async function disconnect(userId) {
  try {
    const row = await tokenRow(userId);
    const tok = row?.refresh_token || row?.access_token;
    if (tok) await fetch(`${OAUTH_REVOKE}?token=${encodeURIComponent(tok)}`, { method: 'POST' });
  } catch { /* best-effort revoke */ }
  await admin().from('google_tokens').delete().eq('user_id', userId);
}

/* ---- Calendars + events ---- */
function mapEvent(e, ctx = {}) {
  return {
    id: e.id,
    cal_id: ctx.calId || 'primary',
    title: e.summary || '(no title)',
    starts_at: e.start?.dateTime || e.start?.date,
    ends_at: e.end?.dateTime || e.end?.date,
    all_day: !e.start?.dateTime,
    calendar: ctx.calName || 'Google',
    color: (e.colorId && COLOR_BY_ID[e.colorId]) || ctx.calColor || '#3b82f6',
    html_link: e.htmlLink,
  };
}

export async function listCalendars(userId) {
  const token = await getAccessToken(userId);
  if (!token) return { connected: false, calendars: [] };
  const data = await gapi(userId, `${CAL_API}/users/me/calendarList?maxResults=250`);
  const calendars = (data.items || []).map((c) => ({
    id: c.id,
    name: c.summaryOverride || c.summary || c.id,
    color: mapCalendarColor(c.backgroundColor),
    primary: !!c.primary,
    writable: c.accessRole === 'owner' || c.accessRole === 'writer',
  }));
  calendars.sort((a, b) => (b.primary - a.primary) || (b.writable - a.writable) || a.name.localeCompare(b.name));
  return { connected: true, calendars };
}

async function fetchCalendarEvents(userId, calendarId, tMin, tMax) {
  let items = [];
  let pageToken;
  for (let i = 0; i < 8; i++) {
    const q = new URLSearchParams({
      timeMin: tMin,
      timeMax: tMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await gapi(userId, `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    items = items.concat(data.items || []);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

// Events across ALL of the user's calendars, tagged with name + mapped color.
export async function listEvents(userId, { timeMin, timeMax } = {}) {
  const token = await getAccessToken(userId);
  if (!token) return { connected: false, events: [] };
  const tMin = timeMin || new Date(Date.now() - 365 * 86400000).toISOString();
  const tMax = timeMax || new Date(Date.now() + 730 * 86400000).toISOString();

  let calendars = [{ id: 'primary', summary: 'Google', backgroundColor: '#3b82f6' }];
  try {
    const listRes = await gapi(userId, `${CAL_API}/users/me/calendarList?maxResults=250`);
    if (listRes.items?.length) calendars = listRes.items;
  } catch { /* fall back to primary only */ }

  const perCal = await Promise.all(
    calendars.map(async (c) => {
      try {
        const items = await fetchCalendarEvents(userId, c.id, tMin, tMax);
        const ctx = { calId: c.id, calName: c.summaryOverride || c.summary || 'Google', calColor: mapCalendarColor(c.backgroundColor) };
        return items.map((e) => mapEvent(e, ctx));
      } catch {
        return [];
      }
    })
  );

  const events = perCal.flat().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return { connected: true, events };
}

function bodyFor({ title, starts_at, ends_at, color }) {
  const start = new Date(starts_at);
  const end = ends_at ? new Date(ends_at) : new Date(start.getTime() + 3600000);
  const b = { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  if (color && ID_BY_COLOR[color]) b.colorId = ID_BY_COLOR[color];
  return b;
}

// Partial patch — only send the fields provided (safe for title-only edits).
function patchBody({ title, starts_at, ends_at, color }) {
  const b = {};
  if (title != null) b.summary = title;
  if (starts_at) b.start = { dateTime: new Date(starts_at).toISOString() };
  if (ends_at) b.end = { dateTime: new Date(ends_at).toISOString() };
  if (color && ID_BY_COLOR[color]) b.colorId = ID_BY_COLOR[color];
  return b;
}

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function createEvent(userId, ev, calendarId = 'primary') {
  const data = await gapi(userId, `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, jsonInit('POST', bodyFor(ev)));
  return mapEvent(data, { calId: calendarId });
}

export async function updateEvent(userId, id, ev, calendarId = 'primary') {
  const data = await gapi(
    userId,
    `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
    jsonInit('PATCH', patchBody(ev))
  );
  return mapEvent(data, { calId: calendarId });
}

export async function deleteEvent(userId, id, calendarId = 'primary') {
  await gapi(userId, `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: true };
}
