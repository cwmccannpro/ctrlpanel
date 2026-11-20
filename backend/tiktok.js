import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API = 'https://open.tiktokapis.com/v2';
const TABLE = 'tiktok_accounts';
const PUBLIC = 'id,name,label,avatar_url,followers_count,following_count,likes_count,video_count';
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.list'];
const RANGES = { '7d': 7, '28d': 28 };
const VIDEO_FIELDS = 'id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count';
const MAX_PAGES = 5;
let client;

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('TikTok storage is unavailable.');
  return client ||= createClient(url, key, { auth: { persistSession: false } });
}

export function tiktokRedirectUri() { return process.env.TIKTOK_REDIRECT_URI || ''; }

function stateSignature(body) {
  return createHmac('sha256', process.env.TIKTOK_CLIENT_SECRET).update(body).digest('base64url');
}

export function signTikTokState(userId) {
  const body = `${userId}.${Date.now() + 600000}.${randomBytes(16).toString('hex')}`;
  return Buffer.from(`${body}.${stateSignature(body)}`).toString('base64url');
}

export function verifyTikTokState(state) {
  const parts = Buffer.from(String(state || ''), 'base64url').toString().split('.');
  const signature = Buffer.from(parts.pop() || '');
  const expected = Buffer.from(stateSignature(parts.join('.')));
  if (parts.length !== 3 || signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new Error('Invalid TikTok connection state.');
  }
  if (!Number.isFinite(Number(parts[1])) || Date.now() >= Number(parts[1])) {
    throw new Error('The TikTok connection request expired. Please try again.');
  }
  return parts[0];
}

export function tiktokAuthUrl(state) {
  return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY, redirect_uri: tiktokRedirectUri(), response_type: 'code',
    scope: SCOPES.join(','), state, disable_auto_auth: '1',
  })}`;
}

function apiError(status, code) {
  if (code === 'scope_not_authorized') return new Error('Reconnect TikTok and allow the requested analytics permissions.');
  if (status === 401 || code === 'access_token_invalid' || code === 'invalid_grant') {
    return Object.assign(new Error('TikTok access expired or was revoked. Reconnect this account.'), { expired: true });
  }
  if (status === 429) return new Error('TikTok is rate limiting requests. Try again in a moment.');
  return new Error('TikTok could not complete the request. Try again or reconnect the account.');
}

function oauthRequest(action, params) {
  return fetch(`${API}/oauth/${action}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...params }),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
}

async function tokenRequest(params) {
  const res = await oauthRequest('token', params);
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || tokens.error || !tokens.access_token || !tokens.refresh_token) throw apiError(res.status, tokens.error);
  return tokens;
}

async function display(path, token, fields, body) {
  const res = await fetch(`${API}/${path}/?${new URLSearchParams({ fields })}`, {
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { method: 'POST', body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || result.error?.code !== 'ok' || !result.data) throw apiError(res.status, result.error?.code);
  return result.data;
}

async function getProfile(token, scope, openId) {
  const stats = scope?.split(',').includes('user.info.stats');
  const fields = 'open_id,display_name,avatar_url' + (stats ? ',follower_count,following_count,likes_count,video_count' : '');
  const { user } = await display('user/info', token, fields);
  if (!openId || user?.open_id !== openId) throw new Error('TikTok did not return the connected account. Reconnect this account.');
  return {
    name: user.display_name || null, avatar_url: user.avatar_url || null,
    followers_count: user.follower_count ?? null, following_count: user.following_count ?? null,
    likes_count: user.likes_count ?? null, video_count: user.video_count ?? null,
  };
}

function tokenFields(tokens, scope) {
  return {
    access_token: tokens.access_token, refresh_token: tokens.refresh_token, scope: tokens.scope ?? scope,
    expires_at: Date.now() + Number(tokens.expires_in || 0) * 1000,
    refresh_expires_at: Date.now() + Number(tokens.refresh_expires_in || 0) * 1000,
  };
}

export async function exchangeTikTokCode(userId, code) {
  if (!userId || !code) throw new Error('The TikTok connection response was incomplete.');
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: tiktokRedirectUri() });
  if (!['user.info.basic', 'video.list'].every(scope => tokens.scope?.split(',').includes(scope))) {
    throw new Error('Allow TikTok profile and public video access to connect this account.');
  }
  const profile = await getProfile(tokens.access_token, tokens.scope, tokens.open_id);
  const { data, error } = await admin().from(TABLE).upsert({
    ...profile, ...tokenFields(tokens), user_id: userId, open_id: tokens.open_id, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,open_id' }).select('id').single();
  if (error) throw new Error('Could not save the TikTok connection. Check connection setup and try again.');
  return [data.id];
}

export async function listTikTokAccounts(userId) {
  const { data, error } = await admin().from(TABLE).select(PUBLIC).eq('user_id', userId).order('created_at');
  if (error) throw new Error('Could not load TikTok accounts.');
  return data;
}

function accountQuery(userId, id, update) {
  if (!id) throw new Error('Account id is required.');
  const table = admin().from(TABLE);
  return (update ? table.update(update) : table.select('*')).eq('user_id', userId).eq('id', id);
}

export async function renameTikTokAccount(userId, id, label) {
  const { data, error } = await accountQuery(userId, id, { label: String(label || '').trim().slice(0, 80) || null })
    .select(PUBLIC).maybeSingle();
  if (error || !data) throw new Error('Could not rename this TikTok account.');
  return data;
}

async function getAccount(userId, id) {
  const { data, error } = await accountQuery(userId, id).maybeSingle();
  if (error || !data) throw new Error('TikTok account not found.');
  return data;
}

async function refresh(userId, row) {
  if (row.refresh_expires_at <= Date.now()) throw apiError(401);
  let tokens;
  try {
    tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
  } catch (error) {
    if (error.expired) {
      const current = await getAccount(userId, row.id);
      if (current.refresh_token !== row.refresh_token) return current;
    }
    throw error;
  }
  if (tokens.open_id !== row.open_id) throw new Error('TikTok returned a different account. Reconnect this account.');
  const patch = { ...tokenFields(tokens, row.scope), updated_at: new Date().toISOString() };
  const { data, error } = await accountQuery(userId, row.id, patch)
    .eq('updated_at', row.updated_at).select('id').maybeSingle();
  if (error) throw new Error('Could not save refreshed TikTok access.');
  return data ? { ...row, ...patch } : getAccount(userId, row.id);
}

export async function disconnectTikTokAccount(userId, id) {
  let row = await getAccount(userId, id);
  try {
    if (row.expires_at <= Date.now()) row = await refresh(userId, row);
    const res = await oauthRequest('revoke', { token: row.access_token });
    const result = await res.json().catch(() => null);
    if (!res.ok || result?.error) throw apiError(res.status, result?.error);
  } catch (error) {
    if (!error.expired) throw error;
  }
  const { data, error } = await admin().from(TABLE).delete().eq('user_id', userId).eq('id', id)
    .eq('updated_at', row.updated_at).select('id').maybeSingle();
  if (error || !data) throw new Error('Could not disconnect this TikTok account. Try again.');
  return { ok: true };
}

export async function getTikTokAnalytics(userId, id, range) {
  if (!Object.hasOwn(RANGES, range)) range = '28d';
  let row = await getAccount(userId, id);
  if (row.expires_at - Date.now() < 60000) row = await refresh(userId, row);
  let profile;
  try {
    profile = await getProfile(row.access_token, row.scope, row.open_id);
  } catch (error) {
    if (!error.expired) throw error;
    row = await refresh(userId, row);
    profile = await getProfile(row.access_token, row.scope, row.open_id);
  }
  const now = Date.now();
  const since = now - RANGES[range] * 86400000;
  const posts = new Map();
  const notes = [];
  let cursor, partial = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    let result;
    try {
      result = await display('video/list', row.access_token, VIDEO_FIELDS, { max_count: 20, cursor });
      if (!Array.isArray(result.videos)) throw new Error('TikTok did not return a video list.');
    } catch (error) {
      if (!page) throw error;
      partial = true;
      notes.push('Some videos could not be loaded.');
      break;
    }
    const older = result.videos.some(video => Number.isFinite(video.create_time) && video.create_time * 1000 < since);
    for (const video of result.videos) {
      const published = video.create_time * 1000;
      if (!/^\d+$/.test(video.id) || !Number.isFinite(published) || published < since || published > now) continue;
      const link = /^https:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\//i.test(video.share_url)
        ? video.share_url : `https://www.tiktok.com/player/v1/${video.id}`;
      posts.set(video.id, {
        id: video.id, caption: video.title || video.video_description || '', type: 'Video',
        permalink: link, thumbnail: video.cover_image_url || null,
        timestamp: new Date(published).toISOString(), views: video.view_count ?? null,
        likes: video.like_count ?? null, comments: video.comment_count ?? null, shares: video.share_count ?? null,
      });
    }
    if (older || !result.has_more) break;
    if (page === MAX_PAGES - 1 || !Number.isFinite(result.cursor) || (cursor != null && result.cursor >= cursor)) {
      partial = true;
      notes.push('Showing available videos. More videos may be in this date range.');
      break;
    }
    cursor = result.cursor;
  }
  const videos = [...posts.values()];
  const totals = Object.fromEntries(['views', 'likes', 'comments', 'shares'].map(key => [
    key, (!videos.length && partial) || videos.some(video => video[key] == null)
      ? null : videos.reduce((total, video) => total + video[key], 0),
  ]));
  return { account: { id, label: row.label, ...profile }, range, posts: videos, totals, partial, notes };
}
