// ============================================================
// CTRLpanel — Cloudflare Worker (production API + static assets)
//
// Serves the same /api surface as the local Express server, reusing the
// exact same backend modules (backend/claude.js, backend/google.js,
// backend/finance.js are all plain fetch + Workers-compatible SDKs).
// Static frontend assets are served by the `assets` binding in
// wrangler.jsonc; run_worker_first routes /api/* here.
//
// Requires compatibility flag "nodejs_compat" (node:crypto, Buffer, and
// process.env populated from Worker secrets/vars).
// ============================================================
import { streamChatCore, supplementAnalyze, interactionCheck, extractResumeProfile } from '../backend/claude.js';
import { runOpportunitiesCore } from '../backend/opportunities.js';
import { contextRequest } from '../backend/knowledge.js';
import { getPrices, getHistory, getPortfolioHistory } from '../backend/finance.js';
import { userIdForApiKey, apiKeyFromHeaders, logNutritionEntry } from '../backend/nutritionApi.js';
import {
  youtubeReady,
  youtubeAuthUrl,
  signYoutubeState,
  verifyYoutubeState,
  exchangeYoutubeCode,
  listYoutubeChannels,
  renameYoutubeChannel,
  disconnectYoutubeChannel,
  getYoutubeAnalytics,
} from '../backend/youtube.js';
import { getSheetsStatus, handleSheetsRequest } from '../backend/sheets.js';
import {
  backendReady,
  authUrl,
  signState,
  verifyState,
  verifyUserToken,
  exchangeCode,
  getStatus,
  disconnect,
  listCalendars,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from '../backend/google.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const redirect = (url) => Response.redirect(url, 302);

async function userFrom(request, url) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') || '';
  return verifyUserToken(token);
}

// The SPA origin for post-OAuth redirects: explicit env var, else this deploy.
const frontendBase = (url) => process.env.FRONTEND_URL || url.origin;

export default {
  async fetch(request, env, ctx) {
    // nodejs_compat populates process.env from env on modern compat dates,
    // but assign defensively so module code always sees the bindings.
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
    }

    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === '/api/knowledge/notes') {
        try {
          const raw = method === 'POST' ? await request.text() : '';
          if (new TextEncoder().encode(raw).length > 1048576) return json({error:'Request too large.'},413);
          let body;
          try { body = raw ? JSON.parse(raw) : undefined; } catch { return json({error:'Invalid JSON.'},400); }
          return json(await contextRequest(method,url,request.headers,body));
        } catch(e) { return json({error:e.message||'Context sync failed.'},e.status||500); }
      }
      /* ---- health ---- */
      if (pathname === '/api/health') {
        return json({ ok: true, service: 'ctrlpanel-worker', anthropic: Boolean(process.env.ANTHROPIC_API_KEY), ts: Date.now() });
      }

      /* ---- AI ---- */
      if (pathname === '/api/ai/chat' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        const write = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n'));
        ctx.waitUntil(
          streamChatCore(body, write)
            .catch((e) => write({ type: 'error', message: e?.message || 'Claude API error' }))
            .finally(() => writer.close().catch(() => {}))
        );
        return new Response(readable, {
          headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }
      if (pathname === '/api/ai/supplement-analyze' && method === 'POST') {
        return json(await supplementAnalyze(await request.json().catch(() => ({}))));
      }
      if (pathname === '/api/ai/interaction-check' && method === 'POST') {
        return json(await interactionCheck(await request.json().catch(() => ({}))));
      }

      /* ---- Finance ---- */
      if (pathname === '/api/finance/prices' && method === 'GET') {
        const tickers = (url.searchParams.get('tickers') || '').split(',').map((t) => t.trim()).filter(Boolean);
        return json(await getPrices(tickers));
      }
      if (pathname === '/api/finance/history' && method === 'GET') {
        const ticker = (url.searchParams.get('ticker') || '').trim();
        if (!ticker) return json({ error: 'ticker is required' }, 400);
        try {
          return json(await getHistory(ticker, url.searchParams.get('scale') || '1M'));
        } catch (e) {
          return json({ error: e?.message || 'History failed' }, 502);
        }
      }
      if (pathname === '/api/finance/portfolio-history' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        try {
          return json(await getPortfolioHistory(body.holdings || [], body.scale || '6M'));
        } catch (e) {
          return json({ error: e?.message || 'Portfolio history failed' }, 502);
        }
      }

      /* ---- External nutrition logging (per-user API key, not a session) ---- */
      if (pathname === '/api/nutrition/log' && method === 'POST') {
        try {
          const key = apiKeyFromHeaders((h) => request.headers.get(h) || '');
          const userId = await userIdForApiKey(key);
          if (!userId) return json({ error: 'Invalid or revoked API key.' }, 401);
          return json(await logNutritionEntry(userId, await request.json().catch(() => ({}))));
        } catch (e) {
          return json({ error: e?.message || 'Request failed' }, 400);
        }
      }

      /* ---- Agents folder (per-user session) ---- */
      if (pathname.startsWith('/api/agents')) {
        const user = await userFrom(request, url);
        if (!user) return json({ error: 'Not authenticated' }, 401);
        const body = method === 'POST' ? await request.json().catch(() => ({})) : {};

        // On-demand Opportunities run: NDJSON progress stream. Streaming keeps
        // the response alive through a multi-minute web-search run.
        if (pathname === '/api/agents/opportunities/run' && method === 'POST') {
          const { readable, writable } = new TransformStream();
          const writer = writable.getWriter();
          const enc = new TextEncoder();
          const write = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n')).catch(() => {});
          ctx.waitUntil(
            runOpportunitiesCore({ userId: user.id, apiKey: body.apiKey, today: body.today }, write)
              .catch((e) => write({ type: 'error', message: e?.message || 'Opportunities run failed' }))
              .finally(() => writer.close().catch(() => {}))
          );
          return new Response(readable, {
            headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' },
          });
        }
        if (pathname === '/api/agents/opportunities/profile' && method === 'POST') {
          try {
            return json(await extractResumeProfile(body));
          } catch (e) {
            return json({ error: e?.message || 'Could not read that resume.' }, 400);
          }
        }
      }

      /* ---- Calendar ---- */
      if (pathname.startsWith('/api/calendar')) {
        if (pathname === '/api/calendar/status' && method === 'GET') {
          const ready = backendReady();
          const user = await userFrom(request, url);
          if (!user) return json({ connected: false, ready });
          return json({ ...(await getStatus(user.id)), ready });
        }

        if (pathname === '/api/calendar/connect' && method === 'GET') {
          if (!backendReady()) return new Response('Google Calendar is not configured on the server.', { status: 500 });
          const user = await userFrom(request, url);
          if (!user) return new Response('Not authenticated.', { status: 401 });
          return redirect(authUrl(signState(user.id)));
        }

        if (pathname === '/api/calendar/callback' && method === 'GET') {
          const base = frontendBase(url);
          try {
            if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
            const userId = verifyState(url.searchParams.get('state'));
            await exchangeCode(userId, url.searchParams.get('code'));
            return redirect(`${base}/calendar?google=connected`);
          } catch (e) {
            return redirect(`${base}/calendar?google=error&message=${encodeURIComponent(e.message)}`);
          }
        }

        // Everything below requires auth
        const user = await userFrom(request, url);
        if (!user) return json({ error: 'Not authenticated' }, 401);

        if (pathname === '/api/calendar/disconnect' && method === 'POST') {
          await disconnect(user.id);
          return json({ ok: true });
        }
        if (pathname === '/api/calendar/calendars' && method === 'GET') {
          return json(await listCalendars(user.id));
        }
        if (pathname === '/api/calendar/events' && method === 'GET') {
          return json(await listEvents(user.id, Object.fromEntries(url.searchParams)));
        }
        if (pathname === '/api/calendar/events' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          return json(await createEvent(user.id, body, body.cal_id || 'primary'));
        }
        const evMatch = pathname.match(/^\/api\/calendar\/events\/([^/]+)$/);
        if (evMatch && method === 'PATCH') {
          const body = await request.json().catch(() => ({}));
          const calId = url.searchParams.get('calendarId') || body.cal_id || 'primary';
          return json(await updateEvent(user.id, decodeURIComponent(evMatch[1]), body, calId));
        }
        if (evMatch && method === 'DELETE') {
          return json(await deleteEvent(user.id, decodeURIComponent(evMatch[1]), url.searchParams.get('calendarId') || 'primary'));
        }
      }

      /* ---- Google Sheets (CRM backing, service-account auth) ---- */
      if (pathname.startsWith('/api/sheets')) {
        if (pathname === '/api/sheets/status' && method === 'GET') {
          return json(getSheetsStatus());
        }
        const user = await userFrom(request, url);
        if (!user) return json({ error: 'Not authenticated' }, 401);
        const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
        // Same dispatcher as Express (backend/routes/sheets.js) so the surfaces match.
        const action = pathname.slice('/api/sheets/'.length);
        const result = await handleSheetsRequest(method, action, Object.fromEntries(url.searchParams), body);
        if (result) return json(result.json, result.status);
      }

      /* ---- YouTube analytics ---- */
      if (pathname.startsWith('/api/youtube')) {
        if (pathname === '/api/youtube/status' && method === 'GET') {
          const ready = youtubeReady();
          const user = await userFrom(request, url);
          if (!user) return json({ ready, channels: [] });
          return json({ ready, channels: await listYoutubeChannels(user.id) });
        }
        if (pathname === '/api/youtube/connect' && method === 'GET') {
          if (!youtubeReady()) return new Response('YouTube is not configured on the server.', { status: 500 });
          const user = await userFrom(request, url);
          if (!user) return new Response('Not authenticated.', { status: 401 });
          return redirect(youtubeAuthUrl(signYoutubeState(user.id)));
        }
        if (pathname === '/api/youtube/callback' && method === 'GET') {
          const base = frontendBase(url);
          try {
            if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
            const userId = verifyYoutubeState(url.searchParams.get('state'));
            await exchangeYoutubeCode(userId, url.searchParams.get('code'));
            return redirect(`${base}/socials?youtube=connected`);
          } catch (e) {
            return redirect(`${base}/socials?youtube=error&message=${encodeURIComponent(e.message)}`);
          }
        }
        const user = await userFrom(request, url);
        if (!user) return json({ error: 'Not authenticated' }, 401);
        try {
          if (pathname === '/api/youtube/rename' && method === 'POST') {
            const body = await request.json().catch(() => ({}));
            return json(await renameYoutubeChannel(user.id, body.id, body.label));
          }
          if (pathname === '/api/youtube/disconnect' && method === 'POST') {
            const body = await request.json().catch(() => ({}));
            return json(await disconnectYoutubeChannel(user.id, body.id));
          }
          if (pathname === '/api/youtube/analytics' && method === 'GET') {
            return json(await getYoutubeAnalytics(user.id, url.searchParams.get('id'), url.searchParams.get('range') || '28d'));
          }
        } catch (e) {
          return json({ error: e?.message || 'Request failed' }, 502);
        }
      }

      if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);

      // Non-/api paths shouldn't reach the Worker (assets handle them), but
      // fall through gracefully if they do.
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    } catch (e) {
      return json({ error: e?.message || 'Internal error' }, 500);
    }
  },
};
