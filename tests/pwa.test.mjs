import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { THEMES, THEME_IDS, themeColor } from '../src/lib/themes.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const html = read('index.html');

/* ---------------- manifest + icons ---------------- */

function pngSize(path) {
  const b = readFileSync(new URL(`../public${path}`, import.meta.url));
  assert.equal(b.slice(1, 4).toString(), 'PNG', `${path} is a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('manifest has what an installable app needs', () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
});

test('every declared icon exists at its declared size, with a maskable one', () => {
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(`../public${icon.src}`, import.meta.url)), `${icon.src} exists`);
    assert.equal(pngSize(icon.src), icon.sizes, `${icon.src} is ${icon.sizes}`);
  }
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'has 192 and 512');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'has a maskable icon');
  assert.equal(pngSize('/icons/apple-touch-icon.png'), '180x180');
  assert.ok(existsSync(new URL('../public/favicon.svg', import.meta.url)));
});

test('shortcuts stay inside the app scope', () => {
  assert.ok(manifest.shortcuts.length > 0);
  for (const s of manifest.shortcuts) assert.ok(s.url.startsWith('/'), `${s.name} → ${s.url}`);
});

/* ---------------- index.html ---------------- */

test('index.html links the manifest, icons and theme-color', () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg"/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}"/i);
  assert.match(html, /<meta name="viewport"/);
});

test('the no-flash inline script knows every theme and its browser colour', () => {
  const ids = html.match(/\[((?:'[a-z]+',?\s*)+)\]\.indexOf/)[1].match(/[a-z]+/g);
  assert.deepEqual(ids, THEME_IDS, 'inline theme id list matches src/lib/themes.js');
  const colors = Object.fromEntries([...html.matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]]));
  for (const t of THEMES.filter((x) => x.preview)) assert.equal(colors[t.id], themeColor(t.id), `${t.id} browser colour`);
});

/* ---------------- service worker, run in a sandbox ---------------- */

class FakeCache {
  constructor() { this.map = new Map(); }
  static key(req) { return new URL(typeof req === 'string' ? req : req.url, 'https://app.test').href; }
  async put(req, res) { this.map.set(FakeCache.key(req), res); }
  async match(req) { return this.map.get(FakeCache.key(req))?.clone(); }
  async add(req) { const res = await sandbox.fetch(req); this.map.set(FakeCache.key(req), res); }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
  async delete(req) { return this.map.delete(FakeCache.key(req)); }
}
class FakeCaches {
  constructor() { this.stores = new Map(); }
  async open(name) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache()); return this.stores.get(name); }
  async match(req, opts = {}) {
    for (const [name, store] of this.stores) if (!opts.cacheName || name === opts.cacheName) { const hit = await store.match(req); if (hit) return hit; }
    return undefined;
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
}

let sandbox;
let handlers;
let fetchLog;
let network; // (url) => Response | throws

function loadWorker() {
  handlers = {};
  fetchLog = [];
  network = async () => new Response('ok', { status: 200 });
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  sandbox = {
    self, URL, Response, Promise, Set, Map, Math, JSON, Array, Object,
    caches: new FakeCaches(),
    fetch: async (req, opts) => {
      const url = typeof req === 'string' ? req : req.url;
      fetchLog.push(url);
      return network(url, opts);
    },
  };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox);
}

/** Fire a fetch event; returns the promise given to respondWith, or null if the worker declined it. */
function fire(url, { method = 'GET', mode = 'cors' } = {}) {
  let response = null;
  handlers.fetch({ request: { method, url: new URL(url, 'https://app.test').href, mode }, respondWith: (p) => { response = p; } });
  return response;
}

const lifecycle = async (type) => { let p; handlers[type]({ waitUntil: (x) => { p = x; } }); await p; };
const allCachedUrls = async () => {
  const urls = [];
  for (const store of sandbox.caches.stores.values()) urls.push(...(await store.keys()).map((k) => k.url));
  return urls;
};

test('worker declines writes, the API, Supabase and every other cross-origin request', () => {
  loadWorker();
  assert.equal(fire('/api/sheets/status'), null);
  assert.equal(fire('/api/nutrition/log', { method: 'POST' }), null);
  assert.equal(fire('/some/page.json', { method: 'DELETE' }), null);
  assert.equal(fire('https://abcd.supabase.co/rest/v1/tasks?select=*'), null);
  assert.equal(fire('https://abcd.supabase.co/auth/v1/token', { method: 'POST' }), null);
  assert.equal(fire('https://www.googleapis.com/calendar/v3/events'), null);
  assert.equal(fire('https://query1.finance.yahoo.com/v8/finance/chart/AAPL'), null);
  assert.equal(fire('/sw.js'), null, 'other same-origin files go to the network');
});

test('worker handles pages, build assets, icons and the CDN hosts', () => {
  loadWorker();
  assert.ok(fire('/todo', { mode: 'navigate' }));
  assert.ok(fire('/assets/index-abc123.js'));
  assert.ok(fire('/icons/icon-192.png'));
  assert.ok(fire('/manifest.webmanifest'));
  assert.ok(fire('https://fonts.googleapis.com/css2?family=Inter'));
  assert.ok(fire('https://fonts.gstatic.com/s/inter/x.woff2'));
  assert.ok(fire('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css'));
});

test('a page loads from the network and keeps a shell copy; offline it serves that copy', async () => {
  loadWorker();
  network = async () => new Response('<html>fresh shell</html>', { status: 200 });
  assert.equal(await (await fire('/habits', { mode: 'navigate' })).text(), '<html>fresh shell</html>');
  network = async () => { throw new TypeError('offline'); };
  const offline = await fire('/calendar', { mode: 'navigate' });
  assert.equal(await offline.text(), '<html>fresh shell</html>', 'any SPA route gets the cached shell');
});

test('offline with nothing cached shows a minimal offline page, not a browser error', async () => {
  loadWorker();
  network = async () => { throw new TypeError('offline'); };
  const res = await fire('/', { mode: 'navigate' });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /offline/i);
});

test('hashed assets are cache-first: fetched once, then served from cache', async () => {
  loadWorker();
  await (await fire('/assets/index-abc123.js')).text();
  await (await fire('/assets/index-abc123.js')).text();
  assert.equal(fetchLog.filter((u) => u.endsWith('/assets/index-abc123.js')).length, 1);
  network = async () => new Response('nope', { status: 500 });
  await fire('/assets/broken.js');
  assert.ok(!(await allCachedUrls()).some((u) => u.endsWith('/assets/broken.js')), 'errors are never cached');
});

test('CDN files show the cached copy even when the network is gone', async () => {
  loadWorker();
  const css = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css';
  network = async () => new Response('.ti{}', { status: 200 });
  await fire(css); // first visit: network, and cached in the background
  await new Promise((r) => setTimeout(r, 20));
  network = async () => { throw new TypeError('offline'); };
  assert.equal(await (await fire(css)).text(), '.ti{}');
});

test('no API, Supabase or private data ever lands in any cache', async () => {
  loadWorker();
  await fire('/api/finance/prices?tickers=AAPL');
  await fire('https://abcd.supabase.co/rest/v1/habits');
  await fire('/todo', { mode: 'navigate' });
  await fire('/assets/index-x.js');
  await new Promise((r) => setTimeout(r, 20));
  const urls = await allCachedUrls();
  assert.ok(urls.length > 0);
  assert.ok(!urls.some((u) => /\/api\/|supabase|googleapis|yahoo/i.test(u)), `cached: ${urls.join(', ')}`);
});

test('install pre-caches the shell and the hashed files it references, and survives being offline', async () => {
  loadWorker();
  network = async (url) => new Response(
    url.endsWith('/') ? '<script src="/assets/index-aaa.js"></script><link href="/assets/index-bbb.css" rel="stylesheet">' : 'file',
    { status: 200 }
  );
  await lifecycle('install');
  const urls = await allCachedUrls();
  assert.ok(urls.includes('https://app.test/'));
  assert.ok(urls.includes('https://app.test/assets/index-aaa.js'));
  assert.ok(urls.includes('https://app.test/assets/index-bbb.css'));

  loadWorker();
  network = async () => { throw new TypeError('offline'); };
  await lifecycle('install'); // must not throw
});

test('activate removes old CTRLpanel caches but leaves other apps alone', async () => {
  loadWorker();
  await lifecycle('install');
  await sandbox.caches.open('ctrlpanel-v0-shell');
  await sandbox.caches.open('someone-elses-cache');
  await lifecycle('activate');
  const names = await sandbox.caches.keys();
  assert.ok(!names.includes('ctrlpanel-v0-shell'));
  assert.ok(names.includes('someone-elses-cache'));
  assert.ok(names.includes('ctrlpanel-v1-shell'));
});
