// ============================================================
// CTRLpanel — /api/ai/* dispatcher shared by Express (backend/routes/ai.js)
// and the Worker, so both enforce the same rules: a signed-in user (Bearer
// token only — never ?token=), per-user limits on the server's Anthropic key
// (backend/aiGuard.js), and bounded request bodies.
//
//   GET  /api/ai/usage                 today's usage + limits (Settings)
//   POST /api/ai/chat                  Master Controller turn, NDJSON stream
//   POST /api/ai/supplement-analyze    AI Stack Evaluator
//   POST /api/ai/interaction-check     Quick Interaction Checker
//
// Returns a Response, or null when the path isn't an AI route.
// ============================================================
import { verifyUserToken } from './google.js';
import { streamChatCore, supplementAnalyze, interactionCheck } from './claude.js';
import {
  AI_ESTIMATE_USD,
  aiErrorResponse,
  getAiUsage,
  reserveAi,
  spendFromUsage,
  withAiLease,
} from './aiGuard.js';

const MAX_BODY_BYTES = 1048576;
const MAX_CHAT_MESSAGES = 200;
const MAX_SUPPLEMENTS = 200;
const MAX_NAME_CHARS = 200;
const CHAT_MAX_OUTPUT_TOKENS = 2048; // keep in step with streamChatCore

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

class BadRequest extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readBody(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new BadRequest('Request too large.', 413);
  if (!raw) return {};
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    /* fall through */
  }
  throw new BadRequest('Invalid JSON.');
}

// The user's own key (Settings → Connectors) bills them, not the server.
const ownKey = (body) => (typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined);

// A chat turn is billed on its prompt size plus the longest reply it may write.
export function estimateChatUsd(body) {
  const prompt = JSON.stringify({ messages: body.messages, context: body.context }).length;
  const usd = (prompt / 3.5) * (3 / 1e6) + CHAT_MAX_OUTPUT_TOKENS * (15 / 1e6);
  return Math.max(AI_ESTIMATE_USD.chat, Math.ceil(usd * 10000) / 10000);
}

async function chat(user, body, waitUntil) {
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_CHAT_MESSAGES) {
    throw new BadRequest('Send between 1 and 200 messages.');
  }
  const apiKey = ownKey(body);
  const lease = await reserveAi({ user, apiKey, estimateUsd: estimateChatUsd(body) });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n')).catch(() => {});
  let usage = null;
  const work = streamChatCore({ messages, context: body.context || {}, apiKey }, write, { onUsage: (u) => { usage = u; } })
    .catch((e) => write({ type: 'error', message: e?.message || 'Claude API error' }))
    .finally(async () => {
      await lease.settle(spendFromUsage(usage)); // no usage (the turn failed) keeps the estimate
      writer.close().catch(() => {});
    });
  if (waitUntil) waitUntil(work);
  return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' } });
}

async function supplements(user, body) {
  const list = body.supplements;
  if (!Array.isArray(list) || list.length > MAX_SUPPLEMENTS) throw new BadRequest('Send your supplement stack as a list of up to 200 items.');
  const apiKey = ownKey(body);
  return reply(
    await withAiLease({ user, apiKey, estimateUsd: AI_ESTIMATE_USD.supplement }, (track) =>
      supplementAnalyze({ supplements: list, apiKey }, { onUsage: track })),
  );
}

async function interactions(user, body) {
  const names = [body.a, body.b].map((v) => (typeof v === 'string' ? v.trim() : ''));
  if (names.some((v) => !v || v.length > MAX_NAME_CHARS)) throw new BadRequest('Name both supplements or drugs (up to 200 characters each).');
  const apiKey = ownKey(body);
  return reply(
    await withAiLease({ user, apiKey, estimateUsd: AI_ESTIMATE_USD.interaction }, (track) =>
      interactionCheck({ a: names[0], b: names[1], apiKey }, { onUsage: track })),
  );
}

export async function handleAiRequest(request, { waitUntil } = {}) {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  const method = request.method;
  const routes = {
    'GET /api/ai/usage': null,
    'POST /api/ai/chat': chat,
    'POST /api/ai/supplement-analyze': supplements,
    'POST /api/ai/interaction-check': interactions,
  };
  const key = `${method} ${path}`;
  if (!(key in routes)) return null;

  const header = request.headers.get('authorization') || '';
  const user = await verifyUserToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!user) return reply({ error: 'Sign in to use AI features.', code: 'auth' }, 401);

  try {
    if (method === 'GET') return reply(await getAiUsage(user));
    return await routes[key](user, await readBody(request), waitUntil);
  } catch (e) {
    const limited = aiErrorResponse(e);
    if (limited) return limited;
    if (e instanceof BadRequest) return reply({ error: e.message }, e.status);
    return reply({ error: e?.message || 'AI request failed.' }, 500);
  }
}
