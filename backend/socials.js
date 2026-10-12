// One social dispatcher shared by Express and Worker, including setup checks.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyUserToken } from './google.js';
import * as yt from './youtube.js';
import * as ig from './instagram.js';
import * as x from './x.js';

const providers = {
  youtube: { table: 'youtube_channels', listKey: 'channels', required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    redirect: yt.youtubeRedirectUri, sign: yt.signYoutubeState, verify: yt.verifyYoutubeState, auth: yt.youtubeAuthUrl,
    exchange: yt.exchangeYoutubeCode, list: yt.listYoutubeChannels, rename: yt.renameYoutubeChannel,
    disconnect: yt.disconnectYoutubeChannel, analytics: yt.getYoutubeAnalytics },
  instagram: { table: 'instagram_accounts', listKey: 'accounts', required: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
    redirect: ig.instagramRedirectUri, sign: ig.signInstagramState, verify: ig.verifyInstagramState, auth: ig.instagramAuthUrl,
    exchange: ig.exchangeInstagramCode, list: ig.listInstagramAccounts, rename: ig.renameInstagramAccount,
    disconnect: ig.disconnectInstagramAccount, analytics: ig.getInstagramAnalytics },
  x: { table: 'x_accounts', listKey: 'accounts', required: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    redirect: x.xRedirectUri, sign: x.signXState, verify: x.verifyXState, auth: x.xAuthUrl,
    exchange: x.exchangeXCode, list: x.listXAccounts, rename: x.renameXAccount,
    disconnect: x.disconnectXAccount, analytics: x.getXAnalytics },
};
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const cookieName = p => `ctrlpanel_social_${p}`;
function cookie(platform, value, uri, clear = false) {
  return `${cookieName(platform)}=${value}; Path=/api/${platform}; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${uri.startsWith('https:') ? '; Secure' : ''}`;
}
function readCookie(request, platform) {
  const entry = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName(platform)}=`));
  try { return JSON.parse(Buffer.from(entry?.slice(entry.indexOf('=') + 1) || '', 'base64url').toString()); } catch { return null; }
}
export async function socialSetup(platform, userId) {
  const p = providers[platform];
  const missing = p.required.filter(key => !process.env[key]);
  const storageUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!storageUrl) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  const redirectUri = p.redirect();
  let callbackValid = false;
  try {
    const u = new URL(redirectUri);
    callbackValid = u.pathname === `/api/${platform}/callback` && !u.search && !u.hash &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)));
  } catch { /* reported below */ }
  const issues = [];
  if (!callbackValid) issues.push(`Set ${platform === 'youtube' ? 'YOUTUBE' : platform.toUpperCase()}_REDIRECT_URI to the registered /api/${platform}/callback URL.`);
  let storage = 'unconfigured';
  if (storageUrl && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const client = createClient(storageUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    try {
      const { error } = await client.from(p.table).select('id').eq('user_id', userId).limit(0).abortSignal(AbortSignal.timeout(10000));
      storage = error ? 'error' : 'ready';
      if (error) issues.push(['42P01', 'PGRST205', 'PGRST204'].includes(error.code)
        ? `Apply migrations/20261011-social-connections.sql in Supabase to prepare ${p.table}.`
        : 'Cannot reach social connection storage. Check the server Supabase configuration.');
    } catch { storage = 'error'; issues.push('Cannot reach social connection storage. Check the server Supabase configuration.'); }
  }
  return { ready: !missing.length && callbackValid && storage === 'ready', missing, redirectUri, storage, issues };
}
export async function handleSocialRequest(request) {
  const url = new URL(request.url);
  const [, , platform, action] = url.pathname.split('/');
  const p = providers[platform];
  if (!p || url.pathname !== `/api/${platform}/${action}`) return response({ error: 'Not found' }, 404);
  const method = request.method;
  if (action === 'callback' && method === 'GET') {
    const uri = p.redirect();
    const base = process.env.FRONTEND_URL || url.origin;
    const back = new URL('/socials', base);
    try {
      const state = url.searchParams.get('state');
      const saved = readCookie(request, platform);
      if (!state || saved?.state !== state) throw new Error('This connection must finish in the browser where it started. Please connect again.');
      const userId = p.verify(state);
      if (url.searchParams.get('error')) throw new Error('Sign-in was cancelled or denied. Please connect again and approve the requested permissions.');
      await p.exchange(userId, url.searchParams.get('code'), saved.verifier);
      back.searchParams.set(platform, 'connected');
    } catch (e) {
      back.searchParams.set(platform, 'error');
      back.searchParams.set('message', e.message || 'Connection failed.');
    }
    return new Response(null, { status: 302, headers: { Location: back.toString(), 'Cache-Control': 'no-store',
      'Set-Cookie': cookie(platform, '', uri, true) } });
  }
  // Session tokens travel only in Authorization, never in OAuth redirect URLs.
  const authorization = request.headers.get('authorization') || '';
  const user = await verifyUserToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!user) return response({ error: 'Not authenticated' }, 401);
  try {
    if (action === 'status' && method === 'GET') {
      const setup = await socialSetup(platform, user.id);
      let accounts = [], error = '';
      if (setup.storage === 'ready') {
        try { accounts = await p.list(user.id); } catch (e) { error = e.message; setup.ready = false; setup.issues.push(error); }
      }
      return response({ ready: setup.ready, setup, error, [p.listKey]: accounts });
    }
    if (action === 'connect' && method === 'POST') {
      const setup = await socialSetup(platform, user.id);
      if (!setup.ready) return response({ error: 'Finish the connection setup before signing in.', setup }, 503);
      // OAuth cookies are host scoped. Reject cross-host callbacks before sign-in.
      if (new URL(setup.redirectUri).hostname !== url.hostname) return response({ error: 'Open CTRLpanel on the same hostname as its registered callback URL before connecting.' }, 400);
      const state = p.sign(user.id);
      const verifier = randomBytes(32).toString('base64url');
      return response({ url: p.auth(state, verifier) }, 200, {
        'Set-Cookie': cookie(platform, Buffer.from(JSON.stringify({ state, verifier })).toString('base64url'), setup.redirectUri),
      });
    }
    if (action === 'analytics' && method === 'GET') return response(await p.analytics(user.id, url.searchParams.get('id'), url.searchParams.get('range') || undefined));
    if (['rename', 'disconnect'].includes(action) && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return response({ error: 'Invalid JSON.' }, 400); }
      return response(await p[action](user.id, body?.id, body?.label));
    }
    return response({ error: 'Not found' }, 404);
  } catch (e) { return response({ error: e.message || 'Social request failed.' }, action === 'analytics' ? 502 : 400); }
}
