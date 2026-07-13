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
import { streamChatCore, supplementAnalyze, interactionCheck } from '../backend/claude.js';
import { getPrices } from '../backend/finance.js';
import {
  createBoardShare,
  acceptInvite,
  createFriendInvite,
  getFriends,
  removeFriend,
  getLeaderboard,
  createChallenge,
  listChallenges,
  respondChallenge,
  deleteChallenge,
} from '../backend/social.js';
import { userIdForApiKey, apiKeyFromHeaders, logNutritionEntry } from '../backend/nutritionApi.js';
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
import {
  gmailReady,
  gmailAuthUrl,
  signGmailState,
  verifyGmailState,
  exchangeGmailCode,
  listGmailAccounts,
  disconnectGmailAccount,
  runTriage,
  createDraftForItem,
  runDueTriage,
} from '../backend/gmail.js';

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
      /* ---- health ---- */
      if (pathname === '/api/health') {
        return json({ ok: true, service: 'ctrlpanel-worker', anthropic: Boolean(process.env.ANTHROPIC_API_KEY), email: Boolean(process.env.RESEND_API_KEY), ts: Date.now() });
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

      /* ---- Sharing + social (Supabase session auth) ---- */
      if (
        pathname.startsWith('/api/shares') ||
        pathname.startsWith('/api/invites') ||
        pathname.startsWith('/api/social')
      ) {
        const user = await userFrom(request, url);
        if (!user) return json({ error: 'Not authenticated' }, 401);
        const appUrl = frontendBase(url);
        const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
        try {
          if (pathname === '/api/shares/board' && method === 'POST') {
            return json(await createBoardShare(user, body, appUrl));
          }
          if (pathname === '/api/invites/accept' && method === 'POST') {
            return json(await acceptInvite(user, body.token));
          }
          if (pathname === '/api/social/friends' && method === 'GET') {
            return json(await getFriends(user));
          }
          if (pathname === '/api/social/friends' && method === 'POST') {
            return json(await createFriendInvite(user, body, appUrl));
          }
          const frMatch = pathname.match(/^\/api\/social\/friends\/([^/]+)$/);
          if (frMatch && method === 'DELETE') {
            return json(await removeFriend(user, decodeURIComponent(frMatch[1])));
          }
          if (pathname === '/api/social/leaderboard' && method === 'GET') {
            return json(await getLeaderboard(user, Object.fromEntries(url.searchParams)));
          }
          if (pathname === '/api/social/challenges' && method === 'GET') {
            return json(await listChallenges(user));
          }
          if (pathname === '/api/social/challenges' && method === 'POST') {
            return json(await createChallenge(user, body));
          }
          const chRespond = pathname.match(/^\/api\/social\/challenges\/([^/]+)\/respond$/);
          if (chRespond && method === 'POST') {
            return json(await respondChallenge(user, decodeURIComponent(chRespond[1]), Boolean(body.accept)));
          }
          const chMatch = pathname.match(/^\/api\/social\/challenges\/([^/]+)$/);
          if (chMatch && method === 'DELETE') {
            return json(await deleteChallenge(user, decodeURIComponent(chMatch[1])));
          }
        } catch (e) {
          return json({ error: e?.message || 'Request failed' }, 400);
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

      /* ---- Gmail / Email Triage ---- */
      if (pathname.startsWith('/api/gmail')) {
        if (pathname === '/api/gmail/status' && method === 'GET') {
          const ready = gmailReady();
          const user = await userFrom(request, url);
          if (!user) return json({ ready, accounts: [] });
          return json({ ready, accounts: await listGmailAccounts(user.id) });
        }

        if (pathname === '/api/gmail/connect' && method === 'GET') {
          if (!gmailReady()) return new Response('Gmail triage is not configured on the server.', { status: 500 });
          const user = await userFrom(request, url);
          if (!user) return new Response('Not authenticated.', { status: 401 });
          const alias = String(url.searchParams.get('alias') || '').trim().toLowerCase().slice(0, 24);
          if (!alias) return new Response('An account alias is required.', { status: 400 });
          return redirect(gmailAuthUrl(signGmailState(user.id, alias)));
        }

        if (pathname === '/api/gmail/callback' && method === 'GET') {
          const base = frontendBase(url);
          try {
            if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
            const { userId, alias } = verifyGmailState(url.searchParams.get('state'));
            await exchangeGmailCode(userId, alias, url.searchParams.get('code'));
            return redirect(`${base}/settings?gmail=connected&alias=${encodeURIComponent(alias)}`);
          } catch (e) {
            return redirect(`${base}/settings?gmail=error&message=${encodeURIComponent(e.message)}`);
          }
        }

        // Everything below requires auth
        const user = await userFrom(request, url);
        if (!user) return json({ error: 'Not authenticated' }, 401);
        const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
        try {
          if (pathname === '/api/gmail/disconnect' && method === 'POST') {
            return json(await disconnectGmailAccount(user.id, body.account_id));
          }
          if (pathname === '/api/gmail/run' && method === 'POST') {
            return json(await runTriage(user.id, 'manual'));
          }
          if (pathname === '/api/gmail/draft' && method === 'POST') {
            return json(await createDraftForItem(user.id, body.item_id));
          }
        } catch (e) {
          return json({ error: e?.message || 'Request failed' }, 400);
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

  // Cron trigger (wrangler.jsonc → triggers.crons): every 15 min, run the
  // Email Triage job for every user whose agent is toggled ON and due.
  async scheduled(event, env, ctx) {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
    }
    ctx.waitUntil(runDueTriage().catch((e) => console.error('triage cron:', e?.message)));
  },
};
