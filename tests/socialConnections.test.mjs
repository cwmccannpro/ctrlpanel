import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { createHash } from 'node:crypto';
import express from 'express';

Object.assign(process.env, {
  VITE_SUPABASE_URL: 'https://supabase.test', VITE_SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  GOOGLE_CLIENT_ID: 'google-app', GOOGLE_CLIENT_SECRET: 'google-secret', YOUTUBE_REDIRECT_URI: 'https://ctrl.test/api/youtube/callback',
  INSTAGRAM_APP_ID: 'ig-app', INSTAGRAM_APP_SECRET: 'ig-secret', INSTAGRAM_REDIRECT_URI: 'https://ctrl.test/api/instagram/callback',
  X_CLIENT_ID: 'x-app', X_CLIENT_SECRET: 'x-secret', X_REDIRECT_URI: 'https://ctrl.test/api/x/callback', FRONTEND_URL: 'https://ctrl.test',
});
const realFetch = globalThis.fetch;
let calls, rows, missing, xHandler, ytHandler;
const published = daysAgo => new Date(Date.now() - daysAgo * 86400000 - 1000).toISOString();
const profile = { id: 'x-owner', username: 'creator', name: 'Creator', public_metrics: { followers_count: 100, following_count: 12, tweet_count: 4 } };
const post = { id: '123', text: 'First post', created_at: new Date().toISOString(), public_metrics: { impression_count: 1000, like_count: 20, retweet_count: 3, reply_count: 2, quote_count: 1, bookmark_count: 0 }, non_public_metrics: { url_link_clicks: 4, user_profile_clicks: 5 } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  const method = init.method || 'GET';
  const headers = new Headers(init.headers);
  const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
  calls.push({ url, method, body, headers });
  if (url.hostname === 'supabase.test') {
    if (url.pathname === '/auth/v1/user') return headers.get('authorization') === 'Bearer session-one' ? json({ id: 'user-one', email: 'owner@example.test' }) : json({ error: 'invalid' }, 401);
    const table = url.pathname.split('/').at(-1);
    if (missing === table) return json({ code: 'PGRST205', message: 'Missing table' }, 404);
    const data = rows[table] ||= [];
    if (url.searchParams.get('limit') === '0') return json([]);
    const matches = r => [...url.searchParams].filter(([key]) => ['id', 'user_id'].includes(key)).every(([key, value]) => `eq.${r[key]}` === value);
    let found = data.filter(matches);
    if (method === 'POST') {
      const next = JSON.parse(body);
      const existing = data.find(r => r.user_id === next.user_id && r.x_user_id === next.x_user_id);
      if (existing) Object.assign(existing, next); else data.push({ id: `account-${data.length}`, ...next });
      return json(null, 201);
    }
    if (method === 'PATCH') { found.forEach(r => Object.assign(r, JSON.parse(body))); if (!url.searchParams.get('select')) return new Response(null, { status: 204 }); }
    if (method === 'DELETE') { rows[table] = data.filter(r => !matches(r)); return new Response(null, { status: 204 }); }
    const columns = url.searchParams.get('select');
    const projected = found.map(r => columns === '*' ? r : Object.fromEntries(columns.split(',').map(c => c.trim()).filter(c => c in r).map(c => [c, r[c]])));
    const single = headers.get('accept')?.includes('vnd.pgrst.object');
    return json(single ? projected[0] || null : projected);
  }
  if (url.hostname === 'api.x.com') return xHandler(url, { method, headers, body });
  if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'new-yt-token', refresh_token: 'yt-refresh', expires_in: 3600 });
  if (url.hostname === 'www.googleapis.com') {
    if (url.pathname.includes('userinfo')) return json({ email: 'owner@example.test' });
    return ytHandler(url);
  }
  if (url.hostname === 'youtubeanalytics.googleapis.com') return ytHandler(url);
  throw new Error(`Unexpected test host: ${url.hostname}`);
};
const { handleSocialRequest, socialSetup } = await import('../backend/socials.js');
const x = await import('../backend/x.js');
const yt = await import('../backend/youtube.js');
const worker = (await import('../worker/index.js')).default;
const socialRouter = (await import('../backend/routes/socials.js')).default;
beforeEach(() => {
  calls = []; missing = '';
  rows = {
    x_accounts: [{ id: 'mine', user_id: 'user-one', x_user_id: 'x-owner', username: 'creator', label: 'Studio', access_token: 'private-token', refresh_token: 'refresh-secret', expires_at: Date.now() + 3600000 },
      { id: 'other', user_id: 'user-two', x_user_id: 'other-owner', username: 'other', access_token: 'other-private-token' }],
    youtube_channels: [{ id: 'youtube1', user_id: 'user-one', channel_id: 'yt-channel', title: 'Channel', access_token: 'yt-private', refresh_token: 'yt-refresh', expiry_date: Date.now() + 3600000 }], instagram_accounts: [],
  };
  xHandler = (url) => url.pathname === '/2/oauth2/token' ? json({ access_token: 'rotated-token', refresh_token: 'rotated-refresh', expires_in: 7200 })
    : url.pathname === '/2/users/me' ? json({ data: profile }) : json({ data: [post], meta: {} });
  ytHandler = url => {
    if (url.pathname.endsWith('/channels')) return json({ items: [{ id: 'yt-channel', snippet: { title: 'Channel' },
      contentDetails: { relatedPlaylists: { uploads: 'uploads-one' } }, statistics: { subscriberCount: '10', videoCount: '3', viewCount: '103' } }] });
    if (url.pathname.endsWith('/playlistItems')) return json({ items: [
      { contentDetails: { videoId: 'video1', videoPublishedAt: published(4) }, snippet: { title: 'Video title' } },
      { contentDetails: { videoId: 'video3', videoPublishedAt: published(0) }, snippet: { title: 'Processing video' } },
      { contentDetails: { videoId: 'video2', videoPublishedAt: published(2) }, snippet: { title: 'New video' } },
    ] });
    if (url.pathname.endsWith('/videos')) return json({ items: [
      { id: 'video1', snippet: { channelId: 'yt-channel', title: 'Video title', publishedAt: published(4) }, statistics: { viewCount: '100', likeCount: '5', commentCount: '2' } },
      { id: 'video2', snippet: { channelId: 'yt-channel', title: 'New video', publishedAt: published(2) }, statistics: { viewCount: '3', likeCount: '0', commentCount: '0' } },
      { id: 'video3', snippet: { channelId: 'yt-channel', title: 'Processing video', publishedAt: published(0) }, statistics: { viewCount: '0' } },
    ].filter(video => url.searchParams.get('id').split(',').includes(video.id)) });
    return json({ rows: url.searchParams.has('filters') ? [['video1', 100, 60, 5, 2, 1, 36], ['video2', 3, 0, 0, 0, 0, 5]]
      : url.searchParams.get('dimensions') === 'video' ? [['video1', 100, 60, 5, 2, 1]] : [[published(1).slice(0, 10), 100, 60, 2, 1]] });
  };
});
after(() => { globalThis.fetch = realFetch; });
const req = (path, { method = 'GET', auth = true, body, cookie } = {}) => new Request(`https://ctrl.test${path}`, {
  method, headers: { ...(auth ? { Authorization: 'Bearer session-one' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('all platforms reject anonymous and query-token requests; Worker uses the same authenticated surface', async () => {
  for (const p of ['youtube', 'instagram', 'x']) {
    assert.equal((await handleSocialRequest(req(`/api/${p}/status`, { auth: false }))).status, 401);
    assert.equal((await handleSocialRequest(req(`/api/${p}/connect?token=session-one`, { auth: false, method: 'POST' }))).status, 401);
    const r = await worker.fetch(req(`/api/${p}/status`), {}, {});
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ready, true);
  }
});
test('setup distinguishes missing app credentials from missing token tables and invalid callback URLs', async () => {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  delete process.env.INSTAGRAM_APP_SECRET;
  try { const s = await socialSetup('instagram', 'user-one'); assert.equal(s.ready, false); assert.deepEqual(s.missing, ['INSTAGRAM_APP_SECRET']); }
  finally { process.env.INSTAGRAM_APP_SECRET = secret; }
  missing = 'x_accounts';
  const s = await socialSetup('x', 'user-one');
  assert.equal(s.ready, false); assert.match(s.issues.join(' '), /20261011-social-connections/);
  missing = ''; const uri = process.env.X_REDIRECT_URI; process.env.X_REDIRECT_URI = 'http://external.test/api/x/callback';
  try { assert.equal((await socialSetup('x', 'user-one')).ready, false); } finally { process.env.X_REDIRECT_URI = uri; }
});
test('status and mutations are owner scoped and never expose OAuth tokens', async () => {
  const result = await (await handleSocialRequest(req('/api/x/status'))).json();
  assert.equal(result.accounts.length, 1); assert.equal(result.accounts[0].id, 'mine');
  assert.doesNotMatch(JSON.stringify(result), /private-token|refresh-secret|other-owner/);
  assert.equal((await handleSocialRequest(req('/api/x/rename', { method: 'POST', body: { id: 'other', label: 'Hacked' } }))).status, 400);
  await handleSocialRequest(req('/api/x/disconnect', { method: 'POST', body: { id: 'other' } }));
  assert.equal(rows.x_accounts.length, 2);
  assert.equal((await handleSocialRequest(req('/api/x/analytics?id=other'))).status, 502);
  assert.equal(calls.some(c => c.url.hostname === 'api.x.com'), false);
  const renamed = await (await handleSocialRequest(req('/api/x/rename', { method: 'POST', body: { id: 'mine', label: ' New name ' } }))).json();
  assert.equal(renamed.label, 'New name'); assert.equal(renamed.access_token, undefined);
});
test('X uses S256 PKCE and HttpOnly browser-bound state, and retains labels on reconnect', async () => {
  const response = await handleSocialRequest(req('/api/x/connect', { method: 'POST' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  const saved = JSON.parse(Buffer.from(cookie.split(';')[0].split('=')[1], 'base64url').toString());
  const url = new URL((await response.json()).url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(saved.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('scope'), 'tweet.read users.read offline.access');
  assert.doesNotMatch(url.toString(), /session-one|x-secret/);
  const callback = `/api/x/callback?code=auth-code&state=${encodeURIComponent(saved.state)}`;
  const rejected = await handleSocialRequest(req(callback, { auth: false }));
  assert.match(rejected.headers.get('location'), /x=error/);
  assert.equal(calls.some(c => c.url.pathname === '/2/oauth2/token'), false);
  const accepted = await handleSocialRequest(req(callback, { auth: false, cookie: cookie.split(';')[0] }));
  assert.match(accepted.headers.get('location'), /x=connected/);
  assert.match(accepted.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(rows.x_accounts[0].label, 'Studio');
  assert.equal(rows.x_accounts[0].access_token, 'rotated-token');
  const tokenCall = calls.find(c => c.url.pathname === '/2/oauth2/token');
  assert.equal(new URLSearchParams(tokenCall.body).get('code_verifier'), saved.verifier);
});
test('every callback rejects mismatched browser state before exchanging any code', async () => {
  for (const p of ['youtube', 'instagram', 'x']) {
    const start = await handleSocialRequest(req(`/api/${p}/connect`, { method: 'POST' }));
    const state = new URL((await start.json()).url).searchParams.get('state');
    const r = await handleSocialRequest(req(`/api/${p}/callback?state=${state}&code=code`, { auth: false, cookie: 'wrong=cookie' }));
    assert.match(r.headers.get('location'), new RegExp(`${p}=error`));
  }
  assert.equal(calls.some(c => c.url.hostname !== 'supabase.test'), false);
});
test('signed X state rejects tampering and expiration', () => {
  const state = x.signXState('user-one'); assert.equal(x.verifyXState(state), 'user-one');
  assert.throws(() => x.verifyXState(Buffer.from(Buffer.from(state, 'base64url').toString().replace('user-one', 'user-two')).toString('base64url')), /Invalid/);
  const now = Date.now; Date.now = () => now() + 601000;
  try { assert.throws(() => x.verifyXState(state), /expired/); } finally { Date.now = now; }
});
test('X refresh persists rotated tokens and analytics contain public data only', async () => {
  rows.x_accounts[0].expires_at = 0;
  const data = await x.getXAnalytics('user-one', 'mine', '7d');
  assert.equal(data.totals.impressions, 1000); assert.equal(data.totals.urlClicks, 4);
  assert.equal(data.account.followers_count, 100); assert.equal(data.range, '7d');
  assert.equal(rows.x_accounts[0].refresh_token, 'rotated-refresh');
  assert.match(data.notes.join(' '), /lifetime totals/);
  assert.doesNotMatch(JSON.stringify(data), /private-token|refresh-secret|rotated-token|rotated-refresh/);
  const timeline = calls.find(c => c.url.pathname.endsWith('/tweets'));
  assert.equal(timeline.url.searchParams.get('exclude'), 'retweets');
  assert.ok(timeline.url.searchParams.get('start_time'));
});
test('X pagination is bounded and incomplete totals are labelled as partial', async () => {
  xHandler = url => url.pathname === '/2/users/me' ? json({ data: profile }) : json({ data: [{ ...post, id: String(calls.length) }], meta: { next_token: 'next' } });
  const data = await x.getXAnalytics('user-one', 'mine', '28d');
  assert.equal(data.posts.length, 3); assert.equal(data.partial, true);
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/tweets')).length, 3);
  assert.match(data.notes.join(' '), /latest 300/);
});
test('missing X metrics remain unknown, while genuine empty timelines return zero', () => {
  const p = x.normalizeXPost({ id: '1', public_metrics: { like_count: 0 } });
  assert.equal(p.likes, 0); assert.equal(p.impressions, null);
  assert.equal(x.summarizeXPosts([p]).impressions, null);
  assert.equal(x.summarizeXPosts([]).impressions, 0);
});
test('X incomplete empty responses remain unknown rather than reporting zero performance', async () => {
  xHandler = url => url.pathname === '/2/users/me' ? json({ data: profile }) : json({ errors: [{ title: 'Unavailable metrics' }] });
  const data = await x.getXAnalytics('user-one', 'mine');
  assert.equal(data.partial, true);
  assert.equal(data.totals.impressions, null);
  assert.equal(data.totals.likes, null);
});
test('X private-metric permission failures fall back to public data; billing errors remain actionable', async () => {
  xHandler = url => url.pathname === '/2/users/me' ? json({ data: profile })
    : url.searchParams.get('tweet.fields')?.includes('non_public_metrics') ? json({ secret: 'should-not-escape' }, 403)
      : json({ data: [{ ...post, non_public_metrics: undefined }] });
  const data = await x.getXAnalytics('user-one', 'mine');
  assert.equal(data.totals.impressions, 1000); assert.equal(data.totals.urlClicks, null);
  assert.match(data.notes.join(' '), /Private click metrics/);
  for (const status of [401, 402, 429]) {
    xHandler = () => json({ detail: 'private-token' }, status);
    await assert.rejects(x.getXAnalytics('user-one', 'mine'), e => /Reconnect|credits|rate limiting/.test(e.message) && !e.message.includes('private-token'));
  }
});
test('YouTube returns top video content alongside daily analytics', async () => {
  const data = await yt.getYoutubeAnalytics('user-one', 'youtube1', '7d');
  assert.equal(data.totals.views, 100); assert.equal(data.totals.watchHours, 1);
  assert.equal(data.posts[0].caption, 'Video title'); assert.equal(data.posts[0].likes, 5);
  assert.doesNotMatch(JSON.stringify(data), /yt-private|yt-refresh/);
});
test('YouTube latest publications use the channel uploads, newest first, including uploads absent from top reports', async () => {
  const data = await yt.getYoutubeAnalytics('user-one', 'youtube1', '7d');
  assert.deepEqual(data.latestPosts.map(p => p.id), ['video3', 'video2', 'video1']);
  assert.equal(data.posts[0].id, 'video1');
  assert.equal(data.latestPosts[1].likes, 0);
  assert.equal(data.latestPosts[1].watchHours, 0);
  assert.equal(data.latestPosts[2].averageViewDuration, 36);
  assert.equal(data.latestPosts[2].shares, 1);
  assert.equal(data.latestStatus, 'ready');
  assert.doesNotMatch(JSON.stringify(data), /yt-private|yt-refresh/);
  const uploads = calls.find(c => c.url.pathname.endsWith('/playlistItems'));
  assert.equal(uploads.url.searchParams.get('playlistId'), 'uploads-one');
  assert.equal(uploads.url.searchParams.get('maxResults'), '12');
  const lifetime = calls.find(c => c.url.searchParams.has('filters'));
  assert.equal(lifetime.url.searchParams.get('startDate'), published(4).slice(0, 10));
  assert.equal(lifetime.url.searchParams.get('filters'), 'video==video3,video2,video1');
  assert.equal(calls.filter(c => c.url.searchParams.has('filters')).length, 1);
});
test('YouTube missing publication metrics and pending analytics remain unknown; actual zero is preserved', async () => {
  const data = await yt.getYoutubeAnalytics('user-one', 'youtube1');
  const pending = data.latestPosts[0];
  assert.equal(pending.views, 0);
  for (const key of ['likes', 'comments', 'watchHours', 'shares', 'averageViewDuration']) assert.equal(pending[key], null);
});
test('YouTube recent publications are independent of the selected channel date range', async () => {
  const handler = ytHandler;
  ytHandler = url => url.pathname.endsWith('/videos') ? json({ items: [{ id: 'video1', snippet: { channelId: 'yt-channel', title: 'Older latest upload', publishedAt: published(100) }, statistics: { viewCount: '9' } }] })
    : url.pathname.endsWith('/playlistItems') ? json({ items: [{ contentDetails: { videoId: 'video1', videoPublishedAt: published(100) } }] }) : handler(url);
  const data = await yt.getYoutubeAnalytics('user-one', 'youtube1', '7d');
  assert.equal(data.latestPosts[0].caption, 'Older latest upload');
  assert.equal(calls.find(c => c.url.searchParams.has('filters')).url.searchParams.get('startDate'), published(100).slice(0, 10));
});
test('YouTube analytics failure keeps available latest publication totals without false channel totals', async () => {
  const handler = ytHandler;
  ytHandler = url => url.hostname === 'youtubeanalytics.googleapis.com' ? json({ error: 'Unavailable' }, 403) : handler(url);
  const data = await yt.getYoutubeAnalytics('user-one', 'youtube1');
  assert.equal(data.totals, null); assert.deepEqual(data.series, []);
  assert.equal(data.latestPosts.length, 3); assert.equal(data.latestPosts[2].views, 100);
  assert.equal(data.latestPosts[2].watchHours, null);
  assert.match(data.notes.join(' '), /Channel analytics could not be loaded/);
  assert.match(data.latestNotes.join(' '), /watch time and shares/);
});
test('YouTube distinguishes empty uploads from publication failures and keeps channel analytics', async () => {
  const handler = ytHandler;
  ytHandler = url => url.pathname.endsWith('/playlistItems') ? json({ items: [] }) : handler(url);
  const empty = await yt.getYoutubeAnalytics('user-one', 'youtube1');
  assert.equal(empty.latestStatus, 'ready'); assert.deepEqual(empty.latestPosts, []);
  assert.equal(calls.some(c => c.url.searchParams.has('filters')), false);
  ytHandler = url => url.pathname.endsWith('/playlistItems') ? json({}, 503) : handler(url);
  const failed = await yt.getYoutubeAnalytics('user-one', 'youtube1');
  assert.equal(failed.latestStatus, 'unavailable'); assert.equal(failed.totals.views, 100);
  assert.match(failed.latestNotes.join(' '), /Latest publications could not be loaded/);
});
test('YouTube snippet failure preserves upload titles and unavailable lifetime counts', async () => {
  const handler = ytHandler;
  ytHandler = url => url.pathname.endsWith('/videos') ? json({}, 503) : handler(url);
  const data = await yt.getYoutubeAnalytics('user-one', 'youtube1');
  assert.equal(data.latestPosts[0].caption, 'Processing video');
  assert.equal(data.latestPosts[2].views, null);
  assert.equal(data.latestPosts[2].watchHours, 1);
  assert.match(data.latestNotes.join(' '), /Publication totals/);
});
test('YouTube publication requests cannot read another owner’s connected channel', async () => {
  await assert.rejects(yt.getYoutubeAnalytics('user-two', 'youtube1'), /Channel not found/);
  assert.equal(calls.some(c => c.url.hostname.includes('googleapis.com')), false);
});
test('Express carries the shared OAuth cookie and status errors just like the Worker', async () => {
  const app = express(); app.use(express.json()); app.use('/api/x', socialRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/x/status`;
    const r = await realFetch(url, { headers: { Authorization: 'Bearer session-one' } });
    assert.equal(r.status, 200); assert.equal((await r.json()).accounts.length, 1);
    assert.equal((await realFetch(url)).status, 401);
    // Callback still clears the browser cookie after a rejected connection.
    const callback = await realFetch(url.replace('status', 'callback?state=bad'), { redirect: 'manual' });
    assert.equal(callback.status, 302); assert.match(callback.headers.get('set-cookie'), /Max-Age=0/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
