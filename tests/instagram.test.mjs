import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';

// Env must be set before the module first reads it (admin() is lazy).
process.env.INSTAGRAM_APP_ID = 'app-1';
process.env.INSTAGRAM_APP_SECRET = 'secret-1';
process.env.INSTAGRAM_REDIRECT_URI = 'http://localhost:3001/api/instagram/callback';
process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
delete process.env.INSTAGRAM_API_VERSION;

const realFetch = globalThis.fetch;
const DAY = 86400000;

// ---- A fake Meta + Supabase behind global fetch --------------------------------
let calls; // every request, in order
let graph; // (path, params, call) => { status?, body }
let oauth; // (call) => { status?, body }
let supabase; // (call) => { status?, body }

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url || String(input);
    const url = new URL(raw);
    const call = {
      host: url.host,
      path: url.pathname,
      params: Object.fromEntries(url.searchParams),
      method: init.method || 'GET',
      body: typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null,
    };
    calls.push(call);
    let out;
    // Graph accepts a /vNN.N prefix on any path; routes are written without it.
    if (url.host === 'graph.instagram.com') out = graph(call.path.replace(/^\/v\d+\.\d+/, ''), call.params, call);
    else if (url.host === 'api.instagram.com') out = oauth(call);
    else if (url.host === 'supabase.test') out = supabase(call);
    else throw new Error(`unexpected request to ${raw}`);
    return json(out.status ?? 200, out.body);
  };
}

const PROFILE = {
  user_id: '17841400000000000',
  username: 'cam.codes',
  name: 'Cameron',
  account_type: 'MEDIA_CREATOR',
  profile_picture_url: 'https://cdn.example/pic.jpg',
  followers_count: 1200,
  follows_count: 50,
  media_count: 80,
};

const TOTALS = { views: 5000, reach: 3000, accounts_engaged: 210, total_interactions: 640, likes: 400, comments: 60, shares: 90, saves: 90, profile_links_taps: 12 };

const totalValue = (metrics) => ({
  data: metrics.filter((m) => m in TOTALS).map((m) => ({ name: m, period: 'day', total_value: { value: TOTALS[m] } })),
});

// Instagram labels a day with the END of its period (07:00 UTC).
const series = (name, values) => ({
  data: [{ name, period: 'day', values: values.map(([end, value]) => ({ value, end_time: end })) }],
});

function happyGraph(path, params) {
  if (path === '/me') return { body: PROFILE };
  if (path === '/me/insights') {
    if (params.metric === 'reach' && params.metric_type === 'time_series') {
      // Deliberately out of order: the parser must sort.
      return { body: series('reach', [['2026-10-03T07:00:00+0000', 30], ['2026-10-02T07:00:00+0000', 20]]) };
    }
    if (params.metric === 'follower_count') {
      return { body: series('follower_count', [['2026-10-02T07:00:00+0000', 4], ['2026-10-03T07:00:00+0000', 6]]) };
    }
    return { body: totalValue(params.metric.split(',')) };
  }
  if (path === '/me/media') {
    return {
      body: {
        data: [
          { id: 'm1', caption: 'A reel', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://instagram.com/reel/1', thumbnail_url: 'https://cdn.example/t1.jpg', timestamp: '2026-10-02T10:00:00+0000', like_count: 10, comments_count: 2 },
          { id: 'm2', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', permalink: 'https://instagram.com/p/2', media_url: 'https://cdn.example/m2.jpg', timestamp: '2026-10-01T10:00:00+0000', like_count: 5, comments_count: 0 },
        ],
      },
    };
  }
  const media = path.match(/^\/(m\d)\/insights$/);
  if (media) {
    return { body: { data: ['reach', 'views', 'total_interactions'].map((name, i) => ({ name, period: 'lifetime', values: [{ value: (i + 1) * 100 }] })) } };
  }
  return { status: 404, body: { error: { message: `no route ${path}`, code: 100 } } };
}

const freshRow = (over = {}) => ({
  id: 'row-1',
  ig_user_id: PROFILE.user_id,
  username: 'old',
  label: null,
  access_token: 'tok-live',
  expires_at: Date.now() + 50 * DAY,
  ...over,
});

let ig;
before(async () => {
  installFetch(); // admin() captures fetch when first created
  ig = await import('../backend/instagram.js');
});

beforeEach(() => {
  calls = [];
  graph = happyGraph;
  oauth = () => ({ body: {} });
  supabase = () => ({ status: 201 });
  installFetch();
  delete process.env.INSTAGRAM_API_VERSION;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- Pure helpers ----------------------------------------------------------------
test('a daily value belongs to the day before its end_time', () => {
  assert.equal(ig.dayOfEnd('2026-10-02T07:00:00+0000'), '2026-10-01');
  assert.equal(ig.dayOfEnd('2026-10-02T07:00:00+00:00'), '2026-10-01');
  assert.equal(ig.dayOfEnd('not a date'), null);
});

test('parseSeries sorts by date and drops unparseable points', () => {
  const body = series('reach', [['2026-10-03T07:00:00+0000', 3], ['garbage', 9], ['2026-10-02T07:00:00+0000', 2]]);
  assert.deepEqual(ig.parseSeries(body), [
    { date: '2026-10-01', value: 2 },
    { date: '2026-10-02', value: 3 },
  ]);
  assert.deepEqual(ig.parseSeries({}), []);
});

test('parseTotals reads total_value, lifetime values, and omits metrics Instagram left out', () => {
  const out = ig.parseTotals({
    data: [
      { name: 'views', total_value: { value: 10 } },
      { name: 'reach', values: [{ value: 7 }] },
      { name: 'likes', total_value: { value: 0 } },
      { name: 'saves' }, // no value → not reported
    ],
  });
  assert.deepEqual(out, { views: 10, reach: 7, likes: 0 });
});

test('mergeSeries joins reach and follower points on date', () => {
  const merged = ig.mergeSeries(
    [{ date: '2026-10-02', value: 20 }, { date: '2026-10-01', value: 10 }],
    [{ date: '2026-10-02', value: 4 }, { date: '2026-10-03', value: 1 }]
  );
  assert.deepEqual(merged, [
    { date: '2026-10-01', reach: 10, newFollowers: null },
    { date: '2026-10-02', reach: 20, newFollowers: 4 },
    { date: '2026-10-03', reach: null, newFollowers: 1 },
  ]);
});

test('normalizePost labels the type and picks a thumbnail', () => {
  const reel = ig.normalizePost({ id: '1', media_type: 'VIDEO', media_product_type: 'REELS', thumbnail_url: 't', caption: 'x'.repeat(500) }, { reach: 5 });
  assert.equal(reel.type, 'Reel');
  assert.equal(reel.thumbnail, 't');
  assert.equal(reel.caption.length, 160);
  assert.equal(reel.reach, 5);
  assert.equal(reel.views, null);
  // A video without a thumbnail must not fall back to the .mp4 URL.
  assert.equal(ig.normalizePost({ id: '2', media_type: 'VIDEO', media_url: 'video.mp4' }).thumbnail, null);
  assert.equal(ig.normalizePost({ id: '3', media_type: 'IMAGE', media_url: 'i.jpg' }).thumbnail, 'i.jpg');
  assert.equal(ig.normalizePost({ id: '4', media_type: 'CAROUSEL_ALBUM' }).type, 'Carousel');
});

test('graphError turns Meta error codes into actionable messages', () => {
  assert.match(ig.graphError(400, { code: 190, message: 'x' }).message, /Reconnect/);
  assert.match(ig.graphError(401, {}).message, /Reconnect/);
  assert.match(ig.graphError(403, { code: 10 }).message, /permission/);
  assert.match(ig.graphError(400, { code: 4 }).message, /rate limiting/);
  assert.match(ig.graphError(400, { code: 100, message: 'Unsupported metric' }).message, /Unsupported metric/);
});

// ---- OAuth ---------------------------------------------------------------------
test('instagramReady needs app id, secret, a redirect URI and storage', () => {
  assert.equal(ig.instagramReady(), true);
  const id = process.env.INSTAGRAM_APP_ID;
  delete process.env.INSTAGRAM_APP_ID;
  assert.equal(ig.instagramReady(), false);
  process.env.INSTAGRAM_APP_ID = id;
});

test('the authorize URL carries the app, redirect, scopes and state', () => {
  const u = new URL(ig.instagramAuthUrl('state-1'));
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'app-1');
  assert.equal(u.searchParams.get('redirect_uri'), process.env.INSTAGRAM_REDIRECT_URI);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_insights');
  assert.equal(u.searchParams.get('state'), 'state-1');
});

test('state round-trips the user id and rejects tampering and expiry', () => {
  const state = ig.signInstagramState('user-123');
  assert.equal(ig.verifyInstagramState(state), 'user-123');

  const [uid, exp, sig] = Buffer.from(state, 'base64url').toString().split('.');
  const forged = Buffer.from(`other-user.${exp}.${sig}`).toString('base64url');
  assert.throws(() => ig.verifyInstagramState(forged), /Invalid Instagram connection state/);
  assert.throws(() => ig.verifyInstagramState('garbage'), /Invalid/);

  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    assert.throws(() => ig.verifyInstagramState(state), /expired/);
  } finally {
    Date.now = realNow;
  }
  assert.equal(uid, 'user-123');
});

test('connecting exchanges the code, upgrades to a 60-day token and saves the account', async () => {
  oauth = () => ({ body: { data: [{ access_token: 'short-tok', user_id: '999', permissions: 'instagram_business_basic,instagram_business_manage_insights' }] } });
  graph = (path, params) => {
    if (path === '/access_token') return { body: { access_token: 'long-tok', token_type: 'bearer', expires_in: 5184000 } };
    if (path === '/me') return { body: PROFILE };
    return { status: 404, body: { error: { message: 'no' } } };
  };
  let saved;
  supabase = (call) => {
    saved = { path: call.path, params: call.params, row: JSON.parse(call.body) };
    return { status: 201 };
  };

  const before = Date.now();
  const username = await ig.exchangeInstagramCode('user-1', 'AQD-code#_');
  assert.equal(username, 'cam.codes');

  // Short-lived exchange: POST form with the "#_" stripped from the code.
  const short = calls.find((c) => c.host === 'api.instagram.com');
  assert.equal(short.method, 'POST');
  const form = new URLSearchParams(short.body);
  assert.equal(form.get('code'), 'AQD-code');
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('client_id'), 'app-1');
  assert.equal(form.get('client_secret'), 'secret-1');
  assert.equal(form.get('redirect_uri'), process.env.INSTAGRAM_REDIRECT_URI);

  // Long-lived exchange uses the short token; the profile read uses the long one.
  const longCall = calls.find((c) => c.path === '/access_token');
  assert.equal(longCall.params.grant_type, 'ig_exchange_token');
  assert.equal(longCall.params.access_token, 'short-tok');
  assert.equal(calls.find((c) => c.path === '/me').params.access_token, 'long-tok');

  assert.equal(saved.path, '/rest/v1/instagram_accounts');
  assert.equal(saved.params.on_conflict, 'user_id,ig_user_id');
  assert.equal(saved.row.user_id, 'user-1');
  assert.equal(saved.row.ig_user_id, PROFILE.user_id);
  assert.equal(saved.row.access_token, 'long-tok');
  assert.equal(saved.row.followers_count, 1200);
  assert.ok(saved.row.expires_at >= before + 59 * DAY, 'token expiry is ~60 days out');
  assert.ok(!('label' in saved.row), 'reconnecting must not wipe the owner’s own section name');
});

test('connecting also accepts the older flat token response', async () => {
  oauth = () => ({ body: { access_token: 'short-tok', user_id: 999 } });
  graph = (path) => (path === '/access_token' ? { body: { access_token: 'long-tok', expires_in: 5184000 } } : { body: { ...PROFILE, user_id: undefined } });
  let row;
  supabase = (call) => { row = JSON.parse(call.body); return { status: 201 }; };
  await ig.exchangeInstagramCode('user-1', 'code');
  assert.equal(row.ig_user_id, '999', 'falls back to the user_id from the token response');
});

test('a failed code exchange reports Meta’s reason and saves nothing', async () => {
  oauth = () => ({ status: 400, body: { error_type: 'OAuthException', error_message: 'Invalid authorization code', code: 400 } });
  let wrote = false;
  supabase = () => { wrote = true; return { status: 201 }; };
  await assert.rejects(ig.exchangeInstagramCode('user-1', 'bad'), /Invalid authorization code/);
  assert.equal(wrote, false);
  await assert.rejects(ig.exchangeInstagramCode('', 'code'), /incomplete/);
});

// ---- Analytics -----------------------------------------------------------------
test('analytics: totals, daily series, followers and posts all come back', async () => {
  const saves = [];
  const data = await ig.loadInstagramAnalytics(freshRow(), '30d', { save: async (p) => { saves.push(p); } });

  assert.equal(data.range, '30d');
  assert.equal(data.days, 30);
  assert.deepEqual(data.totals, {
    views: 5000, reach: 3000, accountsEngaged: 210, interactions: 640,
    likes: 400, comments: 60, shares: 90, saves: 90, profileTaps: 12,
  });
  assert.deepEqual(data.unavailable, []);
  assert.deepEqual(data.series, [
    { date: '2026-10-01', reach: 20, newFollowers: 4 },
    { date: '2026-10-02', reach: 30, newFollowers: 6 },
  ]);
  assert.equal(data.hasFollowerSeries, true);
  assert.deepEqual(data.notes, []);

  assert.equal(data.account.username, 'cam.codes');
  assert.equal(data.account.followers_count, 1200);
  assert.equal(data.posts.length, 2);
  assert.equal(data.posts[0].type, 'Reel');
  assert.deepEqual([data.posts[0].reach, data.posts[0].views, data.posts[0].interactions], [100, 200, 300]);
  assert.equal(data.posts[0].likes, 10);

  // The cached counts were refreshed.
  assert.equal(saves.at(-1).followers_count, 1200);
});

test('analytics: windows are range-sized and every request is authenticated and unversioned', async () => {
  await ig.loadInstagramAnalytics(freshRow(), '7d');
  const totals = calls.find((c) => c.path === '/me/insights' && c.params.metric_type === 'total_value');
  assert.equal(Number(totals.params.until) - Number(totals.params.since), 7 * 86400);
  assert.equal(totals.params.period, 'day');
  assert.ok(totals.params.metric.split(',').includes('views'));
  for (const c of calls) {
    assert.equal(c.params.access_token, 'tok-live');
    assert.ok(!c.path.startsWith('/v'), `unversioned by default: ${c.path}`);
  }
  // Unknown ranges fall back to 30 days rather than asking for something huge.
  const bad = await ig.loadInstagramAnalytics(freshRow(), '365d');
  assert.equal(bad.range, '30d');
});

test('analytics: INSTAGRAM_API_VERSION pins data endpoints but not token endpoints', async () => {
  process.env.INSTAGRAM_API_VERSION = 'v23.0';
  await ig.loadInstagramAnalytics(freshRow({ expires_at: Date.now() + 10 * DAY }), '7d', { save: async () => {} });
  const dataCalls = calls.filter((c) => c.path !== '/refresh_access_token');
  assert.ok(dataCalls.length > 3);
  assert.ok(dataCalls.every((c) => c.path.startsWith('/v23.0/')), 'data endpoints are pinned');
  assert.ok(calls.some((c) => c.path === '/refresh_access_token'), 'token refresh stays unversioned');
});

test('analytics: one unsupported metric does not blank the rest', async () => {
  graph = (path, params, call) => {
    if (path === '/me/insights' && params.metric_type === 'total_value') {
      const names = params.metric.split(',');
      if (names.includes('profile_links_taps')) {
        return { status: 400, body: { error: { code: 100, message: 'metric profile_links_taps not supported' } } };
      }
      return { body: totalValue(names) };
    }
    return happyGraph(path, params, call);
  };
  const data = await ig.loadInstagramAnalytics(freshRow(), '30d');
  assert.equal(data.totals.views, 5000);
  assert.equal(data.totals.profileTaps, null);
  assert.deepEqual(data.unavailable, ['profile_links_taps']);
});

test('analytics: accounts under 100 followers still get everything else', async () => {
  graph = (path, params, call) =>
    path === '/me/insights' && params.metric === 'follower_count'
      ? { status: 400, body: { error: { code: 100, message: 'not enough followers' } } }
      : happyGraph(path, params, call);
  const data = await ig.loadInstagramAnalytics(freshRow(), '30d');
  assert.equal(data.hasFollowerSeries, false);
  assert.ok(data.notes.some((n) => /100\+ followers/.test(n)));
  assert.equal(data.totals.views, 5000);
  assert.deepEqual(data.series.map((p) => p.newFollowers), [null, null]);
  assert.equal(data.series.length, 2);
});

test('analytics: a post whose insights fail still shows with its public counts', async () => {
  graph = (path, params, call) =>
    /^\/m\d\/insights$/.test(path)
      ? { status: 400, body: { error: { code: 100, message: 'unsupported' } } }
      : happyGraph(path, params, call);
  const data = await ig.loadInstagramAnalytics(freshRow(), '30d');
  assert.equal(data.posts.length, 2);
  assert.equal(data.posts[0].reach, null);
  assert.equal(data.posts[0].likes, 10);
});

test('analytics: a post falls back to reach alone when views is unsupported', async () => {
  graph = (path, params, call) => {
    if (/^\/m\d\/insights$/.test(path)) {
      return params.metric === 'reach'
        ? { body: { data: [{ name: 'reach', values: [{ value: 42 }] }] } }
        : { status: 400, body: { error: { code: 100, message: 'views unsupported' } } };
    }
    return happyGraph(path, params, call);
  };
  const data = await ig.loadInstagramAnalytics(freshRow(), '30d');
  assert.equal(data.posts[0].reach, 42);
  assert.equal(data.posts[0].views, null);
});

test('analytics: a revoked token reads as "reconnect", not four empty sections', async () => {
  graph = () => ({ status: 400, body: { error: { code: 190, message: 'Error validating access token' } } });
  await assert.rejects(ig.loadInstagramAnalytics(freshRow(), '30d'), /Reconnect this account/);

  // Dies after the profile check (token revoked mid-load).
  graph = (path, params, call) =>
    path === '/me' ? { body: PROFILE } : { status: 400, body: { error: { code: 190, message: 'revoked' } } };
  await assert.rejects(ig.loadInstagramAnalytics(freshRow(), '30d'), /Reconnect this account/);
});

test('tokens: an old token is refreshed and the new one is saved and used', async () => {
  const saves = [];
  graph = (path, params, call) =>
    path === '/refresh_access_token'
      ? { body: { access_token: 'tok-new', token_type: 'bearer', expires_in: 5184000 } }
      : happyGraph(path, params, call);
  const row = freshRow({ expires_at: Date.now() + 10 * DAY });
  await ig.loadInstagramAnalytics(row, '30d', { save: async (p) => { saves.push(p); } });

  const refresh = calls.find((c) => c.path === '/refresh_access_token');
  assert.equal(refresh.params.grant_type, 'ig_refresh_token');
  assert.equal(refresh.params.access_token, 'tok-live');
  const tokenSave = saves.find((p) => p.access_token);
  assert.equal(tokenSave.access_token, 'tok-new');
  assert.ok(tokenSave.expires_at > Date.now() + 59 * DAY);
  assert.ok(calls.filter((c) => c.path !== '/refresh_access_token').every((c) => c.params.access_token === 'tok-new'));
});

test('tokens: a fresh token is left alone', async () => {
  await ig.loadInstagramAnalytics(freshRow(), '30d');
  assert.ok(!calls.some((c) => c.path === '/refresh_access_token'));
});

test('tokens: a failed refresh falls back to the still-valid token', async () => {
  graph = (path, params, call) =>
    path === '/refresh_access_token'
      ? { status: 400, body: { error: { code: 100, message: 'token must be 24h old' } } }
      : happyGraph(path, params, call);
  const data = await ig.loadInstagramAnalytics(freshRow({ expires_at: Date.now() + 5 * DAY }), '30d');
  assert.equal(data.totals.views, 5000);
  assert.ok(calls.filter((c) => c.path !== '/refresh_access_token').every((c) => c.params.access_token === 'tok-live'));
});

test('tokens: an expired or missing token asks to reconnect without calling Meta', async () => {
  await assert.rejects(ig.loadInstagramAnalytics(freshRow({ expires_at: Date.now() - 1000 }), '30d'), /expired.*Reconnect/);
  await assert.rejects(ig.loadInstagramAnalytics(freshRow({ access_token: null }), '30d'), /Reconnect/);
  assert.equal(calls.length, 0);
});

test('errors never leak the access token', async () => {
  graph = () => ({ status: 500, body: { error: { code: 1, message: 'boom' } } });
  try {
    await ig.loadInstagramAnalytics(freshRow(), '30d');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(!String(e.message).includes('tok-live'));
  }
});

// ---- Storage --------------------------------------------------------------------
test('listing returns only public columns, scoped to the user', async () => {
  let seen;
  supabase = (call) => {
    seen = call;
    return { body: [{ id: 'a1', username: 'cam.codes' }] };
  };
  const rows = await ig.listInstagramAccounts('user-1');
  assert.deepEqual(rows, [{ id: 'a1', username: 'cam.codes' }]);
  assert.equal(seen.params.user_id, 'eq.user-1');
  assert.ok(!seen.params.select.includes('access_token'));
});

test('a missing table says which migration to run', async () => {
  supabase = () => ({
    status: 404,
    body: { code: 'PGRST205', message: "Could not find the table 'public.instagram_accounts' in the schema cache" },
  });
  await assert.rejects(ig.listInstagramAccounts('user-1'), /20261006-socials-instagram\.sql/);
});

test('rename and disconnect are scoped to the owner', async () => {
  const seen = [];
  supabase = (call) => {
    seen.push(call);
    return call.method === 'DELETE' ? { status: 204 } : { body: { id: 'a1', label: 'Studio' } };
  };
  const renamed = await ig.renameInstagramAccount('user-1', 'a1', '  Studio  ');
  assert.equal(renamed.label, 'Studio');
  assert.equal(JSON.parse(seen[0].body).label, 'Studio');
  assert.equal(seen[0].params.user_id, 'eq.user-1');
  assert.equal(seen[0].params.id, 'eq.a1');

  await ig.renameInstagramAccount('user-1', 'a1', '   ');
  assert.equal(JSON.parse(seen[1].body).label, null, 'a blank name clears the override');

  await ig.disconnectInstagramAccount('user-1', 'a1');
  assert.equal(seen[2].method, 'DELETE');
  assert.equal(seen[2].params.user_id, 'eq.user-1');

  await assert.rejects(ig.renameInstagramAccount('user-1', '', 'x'), /required/);
  await assert.rejects(ig.disconnectInstagramAccount('user-1', ''), /required/);
});
