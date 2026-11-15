// X user OAuth + content analytics. Plain fetch/node:crypto for both runtimes.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API = 'https://api.x.com/2';
const PUBLIC = 'id,x_user_id,username,name,label,profile_image_url,followers_count,following_count,tweet_count';
export const X_RANGES = { '7d': 7, '28d': 28 };
let client;
function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('X storage is not configured on the server.');
  return client ||= createClient(url, key, { auth: { persistSession: false } });
}
export function xRedirectUri() { return process.env.X_REDIRECT_URI || ''; }
export function xReady() {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && xRedirectUri() &&
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
export function signXState(userId) {
  const body = `${userId}.${Date.now() + 600000}.${randomBytes(16).toString('hex')}`;
  return Buffer.from(`${body}.${createHmac('sha256', process.env.X_CLIENT_SECRET).update(body).digest('base64url')}`).toString('base64url');
}
export function verifyXState(state) {
  const parts = Buffer.from(String(state || ''), 'base64url').toString().split('.');
  const sig = parts.pop() || '';
  const body = parts.join('.');
  const expected = createHmac('sha256', process.env.X_CLIENT_SECRET).update(body).digest('base64url');
  if (parts.length !== 3 || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid X connection state.');
  if (!Number.isFinite(Number(parts[1])) || Date.now() > Number(parts[1])) throw new Error('The X connection request expired. Please try again.');
  return parts[0];
}
export function xAuthUrl(state, verifier) {
  return `https://x.com/i/oauth2/authorize?${new URLSearchParams({
    client_id: process.env.X_CLIENT_ID, redirect_uri: xRedirectUri(), response_type: 'code',
    scope: 'tweet.read users.read offline.access', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  })}`;
}
function xError(status) {
  const message = status === 401 ? 'X access expired or was revoked. Reconnect this account.'
    : status === 402 ? 'X API credits are exhausted. Check billing and spending limits in the X Developer Console.'
      : status === 403 ? 'X denied access. Check app permissions and API access in the X Developer Console, then reconnect.'
        : status === 429 ? 'X is rate limiting requests. Try again after the rate limit resets.'
          : `X could not complete this request (${status}). Try again later.`;
  return Object.assign(new Error(message), { status });
}
async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth2/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(process.env.X_CLIENT_ID)}:${encodeURIComponent(process.env.X_CLIENT_SECRET)}`).toString('base64')}` },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw xError(res.status);
  const tokens = await res.json();
  if (!tokens.access_token) throw new Error('X did not return an access token. Reconnect this account.');
  return tokens;
}
async function api(path, token, params = {}) {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw xError(res.status);
  return res.json();
}
function profileRow(profile) {
  const metrics = profile.public_metrics || {};
  return { x_user_id: profile.id, username: profile.username, name: profile.name,
    profile_image_url: profile.profile_image_url || null, followers_count: metrics.followers_count ?? null,
    following_count: metrics.following_count ?? null, tweet_count: metrics.tweet_count ?? null };
}
async function profile(token) {
  const result = await api('/users/me', token, { 'user.fields': 'profile_image_url,public_metrics' });
  if (!result.data?.id) throw new Error('X did not return the connected account.');
  return result.data;
}
export async function exchangeXCode(userId, code, verifier) {
  if (!userId || !code || !verifier) throw new Error('The X connection response was incomplete.');
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: xRedirectUri() });
  const row = { ...profileRow(await profile(tokens.access_token)), user_id: userId,
    access_token: tokens.access_token, refresh_token: tokens.refresh_token, scope: tokens.scope,
    expires_at: Date.now() + Number(tokens.expires_in || 7200) * 1000, updated_at: new Date().toISOString() };
  if (!row.refresh_token) delete row.refresh_token;
  const { error } = await admin().from('x_accounts').upsert(row, { onConflict: 'user_id,x_user_id' });
  if (error) throw new Error('Could not save X connection. Apply migrations/20261011-social-connections.sql and try again.');
}
export async function listXAccounts(userId) {
  const { data, error } = await admin().from('x_accounts').select(PUBLIC).eq('user_id', userId).order('created_at');
  if (error) throw new Error('Could not load X accounts. Apply migrations/20261011-social-connections.sql and try again.');
  return data || [];
}
export async function renameXAccount(userId, id, label) {
  if (!id) throw new Error('Account id is required.');
  const { data, error } = await admin().from('x_accounts').update({ label: String(label || '').trim().slice(0, 80) || null,
    updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id).select(PUBLIC).maybeSingle();
  if (error) throw new Error('Could not rename X account.');
  if (!data) throw new Error('Account not found.');
  return data;
}
export async function disconnectXAccount(userId, id) {
  if (!id) throw new Error('Account id is required.');
  const { error } = await admin().from('x_accounts').delete().eq('user_id', userId).eq('id', id);
  if (error) throw new Error('Could not disconnect X account.');
  return { ok: true };
}
export function normalizeXPost(post) {
  const publicMetrics = post.public_metrics || {};
  const privateMetrics = post.non_public_metrics || {};
  return { id: post.id, caption: post.text || '', timestamp: post.created_at,
    permalink: `https://x.com/i/web/status/${post.id}`, type: 'Post',
    impressions: publicMetrics.impression_count ?? privateMetrics.impression_count ?? null,
    likes: publicMetrics.like_count ?? null, replies: publicMetrics.reply_count ?? null,
    reposts: publicMetrics.retweet_count ?? null, quotes: publicMetrics.quote_count ?? null,
    bookmarks: publicMetrics.bookmark_count ?? null, urlClicks: privateMetrics.url_link_clicks ?? null,
    profileClicks: privateMetrics.user_profile_clicks ?? null };
}
export function summarizeXPosts(posts) {
  return Object.fromEntries(['impressions', 'likes', 'replies', 'reposts', 'quotes', 'bookmarks', 'urlClicks', 'profileClicks'].map(key =>
    [key, posts.length === 0 ? 0 : posts.every(p => p[key] != null) ? posts.reduce((sum, p) => sum + Number(p[key]), 0) : null]));
}
export async function loadXAnalytics(row, range = '28d', { save = async () => {} } = {}) {
  if (!X_RANGES[range]) range = '28d';
  let token = row.access_token;
  const refresh = async () => {
    if (!row.refresh_token) throw xError(401);
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
    const patch = { access_token: t.access_token, refresh_token: t.refresh_token || row.refresh_token,
      expires_at: Date.now() + Number(t.expires_in || 7200) * 1000, updated_at: new Date().toISOString() };
    await save(patch);
    Object.assign(row, patch);
    token = t.access_token;
  };
  if (!token || Number(row.expires_at || 0) - Date.now() < 60000) await refresh();
  let me;
  try { me = await profile(token); } catch (e) {
    if (e.status !== 401) throw e;
    await refresh(); me = await profile(token);
  }
  if (me.id !== row.x_user_id) throw new Error('The X token belongs to a different account. Reconnect this account.');
  const start = new Date(Date.now() - X_RANGES[range] * 86400000).toISOString();
  const params = { start_time: start, max_results: '100', exclude: 'retweets', 'tweet.fields': 'created_at,public_metrics,non_public_metrics' };
  const posts = [], notes = [];
  let next, partial = false;
  for (let page = 0; page < 3; page++) {
    if (next) params.pagination_token = next;
    let result;
    try { result = await api(`/users/${row.x_user_id}/tweets`, token, params); }
    catch (e) {
      // Private metrics can be unavailable despite public metrics being usable.
      if (e.status !== 403 || !params['tweet.fields'].includes('non_public_metrics')) throw e;
      params['tweet.fields'] = 'created_at,public_metrics';
      result = await api(`/users/${row.x_user_id}/tweets`, token, params);
      notes.push('Private click metrics are unavailable; public post metrics are shown.');
    }
    if (result.errors?.length) { partial = true; notes.push('X returned incomplete post data. Some metrics may be unavailable.'); }
    posts.push(...(result.data || []).map(normalizeXPost));
    next = result.meta?.next_token;
    if (!next) break;
  }
  if (next) { partial = true; notes.push('Showing the latest 300 posts. This account has more posts in the selected range.'); }
  notes.push('Metrics are lifetime totals for posts published in this range, not engagement that occurred during the range.');
  const account = { id: row.id, label: row.label, ...profileRow(me) };
  await save({ ...profileRow(me), updated_at: new Date().toISOString() });
  const totals = summarizeXPosts(posts);
  if (partial && !posts.length) for (const key of Object.keys(totals)) totals[key] = null;
  return { account, range, posts, totals, partial, notes, fetchedAt: new Date().toISOString() };
}
export async function getXAnalytics(userId, id, range) {
  if (!id) throw new Error('Account id is required.');
  const { data, error } = await admin().from('x_accounts').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
  if (error || !data) throw new Error('Account not found.');
  return loadXAnalytics(data, range, { save: async patch => {
    const { error: saveError } = await admin().from('x_accounts').update(patch).eq('user_id', userId).eq('id', id);
    if (saveError) throw new Error('Could not save refreshed X access.');
  } });
}
