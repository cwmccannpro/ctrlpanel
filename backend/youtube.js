// ============================================================
// CTRLpanel — YouTube channel analytics (multi-user, multi-channel OAuth)
//
// Reuses the app's Google OAuth client (GOOGLE_CLIENT_ID/SECRET) with a
// YouTube-specific redirect URI + read-only YouTube scopes. Each connected
// channel is stored as its own row in `youtube_channels` (tokens included,
// service-role only — never sent to the browser). Nothing is hardcoded to a
// single channel: connecting a Google account adds whatever channel(s) it
// owns, and the user can connect more accounts later.
//
// Plain REST `fetch` only, so the same module runs in Express dev and the
// Cloudflare Worker.
// ============================================================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

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
  if (!client) throw new Error('YouTube storage is not configured on the server.');
  return client;
}

function redirectUri() {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  const cal = process.env.GOOGLE_REDIRECT_URI || '';
  return cal.includes('/calendar/') ? cal.replace('/calendar/', '/youtube/') : cal.replace('/callback', '/youtube/callback');
}

export function youtubeReady() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && redirectUri() && admin());
}

/* ---- Signed OAuth state (carries the user id) ---- */
const stateSecret = () => process.env.GOOGLE_CLIENT_SECRET || 'ctrlpanel-state';
export function signYoutubeState(userId) {
  const body = `${userId}.${Date.now() + 10 * 60 * 1000}`;
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
}
export function verifyYoutubeState(state) {
  const [userId, exp, sig] = Buffer.from(String(state), 'base64url').toString().split('.');
  const expect = createHmac('sha256', stateSecret()).update(`${userId}.${exp}`).digest('base64url');
  const provided = Buffer.from(sig || '');
  const expected = Buffer.from(expect);
  if (!sig || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid YouTube connection state.');
  }
  if (!Number.isFinite(Number(exp)) || Date.now() > Number(exp)) {
    throw new Error('The YouTube connection request expired. Please try again.');
  }
  return userId;
}

export function youtubeAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH}?${q.toString()}`;
}

/* ---- Token helpers (tokens live on each youtube_channels row) ---- */
async function refreshRow(row) {
  if (!row?.refresh_token) throw new Error('YouTube access expired. Reconnect this channel.');
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not refresh YouTube access (${res.status}): ${detail.slice(0, 180)}`);
  }
  const t = await res.json();
  const patch = {
    access_token: t.access_token,
    expiry_date: Date.now() + Number(t.expires_in || 3500) * 1000,
    updated_at: new Date().toISOString(),
  };
  const { error } = await requireAdmin().from('youtube_channels').update(patch).eq('id', row.id);
  if (error) throw new Error(`Could not save refreshed YouTube access: ${error.message}`);
  return t.access_token;
}

async function accessTokenFor(row, force = false) {
  const fresh = !force && row.access_token && Number(row.expiry_date || 0) - Date.now() > 60000;
  if (fresh) return row.access_token;
  return refreshRow(row);
}

async function yapi(row, url) {
  let token = await accessTokenFor(row);
  if (!token) throw new Error('YouTube not connected');
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await accessTokenFor(row, true);
    if (!token) throw new Error('YouTube access expired. Reconnect this channel.');
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/* ---- OAuth flow ---- */
export async function exchangeYoutubeCode(userId, code) {
  if (!userId || !code) throw new Error('The YouTube connection response was incomplete.');
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${(await res.text()).slice(0, 200)}`);
  const tokens = await res.json();

  let email = null;
  try {
    const me = await fetch(USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (me.ok) email = (await me.json()).email;
  } catch { /* optional */ }

  // The channel(s) this account owns.
  const chRes = await fetch(`${DATA_API}/channels?part=snippet,statistics&mine=true`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!chRes.ok) throw new Error(`Could not read channels: ${(await chRes.text()).slice(0, 200)}`);
  const channels = (await chRes.json()).items || [];
  if (!channels.length) throw new Error('This Google account has no YouTube channel.');

  const now = new Date().toISOString();
  for (const c of channels) {
    const s = c.statistics || {};
    const row = {
      user_id: userId,
      channel_id: c.id,
      title: c.snippet?.title || 'Channel',
      thumbnail: c.snippet?.thumbnails?.default?.url || null,
      subscriber_count: Number(s.subscriberCount || 0),
      video_count: Number(s.videoCount || 0),
      view_count: Number(s.viewCount || 0),
      google_email: email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // present because prompt=consent
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: Date.now() + Number(tokens.expires_in || 3500) * 1000,
      updated_at: now,
    };
    // Keep an existing refresh_token if Google didn't return a new one.
    if (!row.refresh_token) delete row.refresh_token;
    const { error } = await requireAdmin()
      .from('youtube_channels')
      .upsert(row, { onConflict: 'user_id,channel_id' });
    if (error) throw new Error(`Could not save YouTube channel: ${error.message}`);
  }
  return channels.map((c) => c.snippet?.title).filter(Boolean);
}

/** Public channel list (no tokens). */
export async function listYoutubeChannels(userId) {
  if (!admin()) return [];
  const { data, error } = await admin()
    .from('youtube_channels')
    .select('id, channel_id, title, label, thumbnail, subscriber_count, video_count, view_count, google_email')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not load YouTube channels: ${error.message}`);
  return data || [];
}

/**
 * Rename a connected channel. `label` is the user's own name for the section
 * (sidebar + page title); the real channel title is kept untouched underneath.
 * An empty label clears the override and falls back to the channel title.
 */
export async function renameYoutubeChannel(userId, id, label) {
  if (!id) throw new Error('Channel id is required.');
  const next = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null;
  const { data, error } = await requireAdmin()
    .from('youtube_channels')
    .update({ label: next, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, channel_id, title, label, thumbnail, subscriber_count, video_count, view_count, google_email')
    .maybeSingle();
  if (error) throw new Error(`Could not rename YouTube channel: ${error.message}`);
  if (!data) throw new Error('Channel not found.');
  return data;
}

export async function disconnectYoutubeChannel(userId, id) {
  if (!id) throw new Error('Channel id is required.');
  const { error } = await requireAdmin().from('youtube_channels').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`Could not disconnect YouTube channel: ${error.message}`);
  return { ok: true };
}

const RANGE_DAYS = { '7d': 7, '28d': 28, '90d': 90, '365d': 365 };
const iso = (d) => d.toISOString().slice(0, 10);

/** Analytics for one connected channel over a range. */
export async function getYoutubeAnalytics(userId, id, range = '28d') {
  if (!id) throw new Error('Channel id is required.');
  const { data: row, error } = await requireAdmin()
    .from('youtube_channels')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load YouTube channel: ${error.message}`);
  if (!row) throw new Error('Channel not found.');

  const days = RANGE_DAYS[range] || 28;
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);

  // Refresh live channel stats (subscribers etc.).
  let subscribers = Number(row.subscriber_count || 0);
  let totalViews = Number(row.view_count || 0);
  let videoCount = Number(row.video_count || 0);
  try {
    const stat = await yapi(row, `${DATA_API}/channels?part=statistics&id=${encodeURIComponent(row.channel_id)}`);
    const s = stat.items?.[0]?.statistics;
    if (s) {
      subscribers = Number(s.subscriberCount || subscribers);
      totalViews = Number(s.viewCount || totalViews);
      videoCount = Number(s.videoCount || videoCount);
      requireAdmin()
        .from('youtube_channels')
        .update({ subscriber_count: subscribers, view_count: totalViews, video_count: videoCount, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .then(() => {}, () => {});
    }
  } catch { /* stats optional */ }

  // Daily time-series report.
  const q = new URLSearchParams({
    ids: `channel==${row.channel_id}`,
    startDate: iso(start),
    endDate: iso(end),
    metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
    dimensions: 'day',
    sort: 'day',
  });
  let series = [];
  let totals = { views: 0, watchHours: 0, netSubs: 0 };
  try {
    const rep = await yapi(row, `${ANALYTICS_API}?${q}`);
    const rows = rep.rows || [];
    const points = new Map(rows.map((r) => [
      r[0],
      {
        date: r[0],
        views: Number(r[1] || 0),
        watchMinutes: Number(r[2] || 0),
        subs: Number(r[3] || 0) - Number(r[4] || 0),
      },
    ]));
    series = Array.from({ length: days }, (_, index) => {
      const date = iso(new Date(start.getTime() + index * 86400000));
      return points.get(date) || { date, views: 0, watchMinutes: 0, subs: 0 };
    });
    const watchMinutes = rows.reduce((sum, r) => sum + Number(r[2] || 0), 0);
    totals = {
      views: rows.reduce((sum, r) => sum + Number(r[1] || 0), 0),
      watchHours: Number((watchMinutes / 60).toFixed(1)),
      netSubs: rows.reduce((sum, r) => sum + Number(r[3] || 0) - Number(r[4] || 0), 0),
    };
  } catch (e) {
    throw new Error(e.message);
  }

  return {
    channel: { id: row.id, channel_id: row.channel_id, title: row.title, label: row.label || null, thumbnail: row.thumbnail, subscribers, totalViews, videoCount },
    range,
    totals,
    series,
  };
}
