// ============================================================
// CTRLpanel — Google Calendar (multi-user OAuth + two-way CRUD)
//
// One app-level OAuth client (GOOGLE_CLIENT_ID/SECRET) authenticates every
// user; each user's tokens are stored per-account in Supabase (google_tokens)
// and are only ever touched here on the server with the service_role key.
// The browser never sees Google tokens.
// ============================================================
import crypto from 'crypto';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// service_role client: bypasses RLS to manage tokens on the user's behalf
const admin = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) : null;
// anon client: only used to verify a user's access token → user id
const anon = SUPABASE_URL && ANON_KEY ? createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }) : null;

// Full calendar scope so we can list ALL of the user's calendars
// (calendar.events alone cannot call calendarList.list) and read/write their events.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ---- Color mapping -------------------------------------------------------
// Google calendars come with arbitrary hex colors that clash with the app's
// dark theme. We remap every Google color to the nearest hue in the app's
// curated palette, so each user's calendars keep their identity (red stays
// red, green stays green) but always look at home in CTRLpanel.
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
  if (c.s < 0.12) return '#8a7070'; // near-gray calendars
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const ph = hsl(p).h;
    const d = Math.min(Math.abs(c.h - ph), 360 - Math.abs(c.h - ph));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Google's 11 per-event override colors, remapped through the same palette.
const GOOGLE_EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26',
  6: '#f4511e', 7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const COLOR_BY_ID = Object.fromEntries(
  Object.entries(GOOGLE_EVENT_COLORS).map(([id, hex]) => [id, mapCalendarColor(hex)])
);
// Writing an explicit color back to Google (used when a color is supplied).
const ID_BY_COLOR = { '#e11d48': '11', '#f97316': '6', '#f59e0b': '5', '#10b981': '10', '#14b8a6': '7', '#3b82f6': '9', '#8b5cf6': '3', '#ec4899': '4' };

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}
export function backendReady() {
  return Boolean(googleConfigured() && admin && anon);
}

function oauth() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

/* ---- Stateless signed OAuth state (carries the user id round-trip) ---- */
const STATE_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'ctrlpanel-state';
export function signState(userId) {
  const body = `${userId}.${Date.now() + 10 * 60 * 1000}`;
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
}
export function verifyState(state) {
  const [userId, exp, sig] = Buffer.from(String(state), 'base64url').toString().split('.');
  const expect = crypto.createHmac('sha256', STATE_SECRET).update(`${userId}.${exp}`).digest('base64url');
  if (!sig || sig !== expect) throw new Error('bad state');
  if (Date.now() > Number(exp)) throw new Error('state expired');
  return userId;
}

export function authUrl(state) {
  return oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

// Verify a Supabase access token (Bearer header or ?token=) → user
export async function verifyUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token || '';
  if (!token || !anon) return null;
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function saveTokens(userId, tokens, email) {
  const row = { user_id: userId, scope: tokens.scope, token_type: tokens.token_type, expiry_date: tokens.expiry_date, updated_at: new Date().toISOString() };
  if (tokens.access_token) row.access_token = tokens.access_token;
  if (tokens.refresh_token) row.refresh_token = tokens.refresh_token; // Google omits on refresh — keep existing
  if (email) row.google_email = email;
  await admin.from('google_tokens').upsert(row, { onConflict: 'user_id' });
}

export async function exchangeCode(userId, code) {
  const client = oauth();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email = null;
  try {
    const me = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    email = me.data.email;
  } catch { /* email optional */ }
  await saveTokens(userId, tokens, email);
  return email;
}

export async function getStatus(userId) {
  if (!admin) return { connected: false };
  const { data } = await admin.from('google_tokens').select('google_email, refresh_token').eq('user_id', userId).maybeSingle();
  return { connected: Boolean(data?.refresh_token), email: data?.google_email || null };
}

async function clientForUser(userId) {
  const { data } = await admin.from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (!data?.refresh_token) return null;
  const client = oauth();
  client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    scope: data.scope,
    token_type: data.token_type,
    expiry_date: Number(data.expiry_date) || undefined,
  });
  // Persist refreshed access tokens automatically
  client.on('tokens', (t) => saveTokens(userId, t).catch(() => {}));
  return client;
}

export async function disconnect(userId) {
  try {
    const client = await clientForUser(userId);
    if (client) await client.revokeCredentials();
  } catch { /* ignore revoke failure */ }
  await admin.from('google_tokens').delete().eq('user_id', userId);
}

function mapEvent(e, ctx = {}) {
  return {
    id: e.id,
    cal_id: ctx.calId || 'primary',
    title: e.summary || '(no title)',
    starts_at: e.start?.dateTime || e.start?.date,
    ends_at: e.end?.dateTime || e.end?.date,
    all_day: !e.start?.dateTime,
    calendar: ctx.calName || 'Google',
    // Prefer a per-event color; otherwise use the source calendar's color.
    color: (e.colorId && COLOR_BY_ID[e.colorId]) || ctx.calColor || '#3b82f6',
    html_link: e.htmlLink,
  };
}

// Fetch every event page for one calendar within the window (paginated).
async function fetchCalendarEvents(cal, calendarId, tMin, tMax) {
  let items = [];
  let pageToken;
  for (let i = 0; i < 8; i++) {
    const { data } = await cal.events.list({
      calendarId,
      timeMin: tMin,
      timeMax: tMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    items = items.concat(data.items || []);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

// Read events across ALL of the user's calendars (primary, secondary, shared,
// subscribed), tagged with each calendar's name + color.
export async function listEvents(userId, { timeMin, timeMax } = {}) {
  const client = await clientForUser(userId);
  if (!client) return { connected: false, events: [] };
  const cal = google.calendar({ version: 'v3', auth: client });
  const tMin = timeMin || new Date(Date.now() - 365 * 86400000).toISOString();
  const tMax = timeMax || new Date(Date.now() + 730 * 86400000).toISOString();

  let calendars = [{ id: 'primary', summary: 'Google', backgroundColor: '#3b82f6' }];
  try {
    const listRes = await cal.calendarList.list({ maxResults: 250 });
    if (listRes.data.items?.length) calendars = listRes.data.items;
  } catch (e) {
    console.warn('calendarList.list failed (scope?):', e.message);
  }

  const perCal = await Promise.all(
    calendars.map(async (c) => {
      try {
        const items = await fetchCalendarEvents(cal, c.id, tMin, tMax);
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

// The user's calendar list (name, mapped color, writability) for pickers.
export async function listCalendars(userId) {
  const client = await clientForUser(userId);
  if (!client) return { connected: false, calendars: [] };
  const cal = google.calendar({ version: 'v3', auth: client });
  const { data } = await cal.calendarList.list({ maxResults: 250 });
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

function bodyFor({ title, starts_at, ends_at, color }) {
  const start = new Date(starts_at);
  const end = ends_at ? new Date(ends_at) : new Date(start.getTime() + 3600000);
  const b = { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  if (ID_BY_COLOR[color]) b.colorId = ID_BY_COLOR[color];
  return b;
}

export async function createEvent(userId, ev, calendarId = 'primary') {
  const client = await clientForUser(userId);
  if (!client) throw new Error('Google Calendar not connected');
  const cal = google.calendar({ version: 'v3', auth: client });
  const { data } = await cal.events.insert({ calendarId, requestBody: bodyFor(ev) });
  return mapEvent(data, { calId: calendarId });
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

export async function updateEvent(userId, id, ev, calendarId = 'primary') {
  const client = await clientForUser(userId);
  if (!client) throw new Error('Google Calendar not connected');
  const cal = google.calendar({ version: 'v3', auth: client });
  const { data } = await cal.events.patch({ calendarId, eventId: id, requestBody: patchBody(ev) });
  return mapEvent(data, { calId: calendarId });
}

export async function deleteEvent(userId, id, calendarId = 'primary') {
  const client = await clientForUser(userId);
  if (!client) throw new Error('Google Calendar not connected');
  const cal = google.calendar({ version: 'v3', auth: client });
  await cal.events.delete({ calendarId, eventId: id });
  return { ok: true };
}
