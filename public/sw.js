/* CTRLpanel service worker — makes the app installable and gives it an offline shell.
 *
 * What it caches: the app's own code (index.html + hashed /assets/*), the icons and
 * manifest, and three CDN hosts (fonts + the Tabler icon font) so the shell looks right offline.
 *
 * What it NEVER touches: /api/*, Supabase, Google, Yahoo or any other cross-origin request,
 * and anything that isn't a GET. Your data is never stored by this file — offline, the shell
 * opens and the app shows its normal "couldn't reach the server" states.
 *
 * tests/pwa.test.mjs runs this file in a sandbox to enforce those rules.
 */
const VERSION = 'ctrlpanel-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const CDN = `${VERSION}-cdn`;
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const MAX_ASSET_ENTRIES = 160; // old deploys' hashed files age out instead of piling up

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>CTRLpanel — offline</title>' +
  '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0808;color:#f0e8e8;font:15px system-ui,sans-serif;text-align:center">' +
  '<div><h1 style="font-size:18px;margin:0 0 8px">You’re offline</h1><p style="margin:0;color:#8a7070">Reconnect and reload to open CTRLpanel.</p></div>';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Pre-cache the shell AND the hashed files it references, so the very first
      // offline reload works (those files were fetched before this worker existed).
      try {
        const res = await fetch('/', { cache: 'reload' });
        const html = await res.clone().text();
        await cache.put('/', res);
        const assets = await caches.open(ASSETS);
        const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await Promise.all(urls.map((u) => assets.add(u).catch(() => {})));
      } catch {
        /* installing offline or mid-deploy: the runtime caches will fill in later */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, CDN]);
      for (const name of await caches.keys()) {
        if (name.startsWith('ctrlpanel-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

async function put(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  if (cacheName === ASSETS) {
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSET_ENTRIES))) await cache.delete(k);
  }
}

// Pages: the network when it answers (always fresh), the cached shell when it doesn't.
async function navigate(request) {
  try {
    const res = await fetch(request);
    if (res.ok) await put(SHELL, '/', res.clone());
    return res;
  } catch {
    const cached = await caches.match('/', { cacheName: SHELL });
    return cached || new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Hashed build files never change under the same URL: cache first.
async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, { cacheName });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await put(cacheName, request, res.clone());
  return res;
}

// Fonts / icon CSS: show the cached copy now, refresh it in the background.
async function staleWhileRevalidate(request, cacheName) {
  const hit = await caches.match(request, { cacheName });
  const refresh = fetch(request)
    .then(async (res) => {
      if (res.ok || res.type === 'opaque') await put(cacheName, request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // never touch writes
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // never cache the API
    if (request.mode === 'navigate') return event.respondWith(navigate(request));
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.svg') {
      return event.respondWith(cacheFirst(request, ASSETS));
    }
    return; // everything else on this origin goes straight to the network
  }

  if (CDN_HOSTS.includes(url.hostname)) return event.respondWith(staleWhileRevalidate(request, CDN));
  // Supabase, Google, Yahoo, … — not ours to cache.
});
