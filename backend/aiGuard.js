// ============================================================
// CTRLpanel — who may spend the server's Anthropic key, and how much.
//
// Every AI endpoint needs a signed-in user. Calls that would use the *server*
// key are then bounded per user: a burst limit (per minute, held in memory by
// each runtime instance) plus a daily request and dollar cap persisted in
// Supabase (`ai_usage`, written only through the service-role-only RPCs in
// migrations/20261012-ai-usage.sql). Calls that carry the user's own Anthropic
// key (Settings → Connectors) cost the server nothing, so they are
// authenticated but not counted.
//
// A call first *reserves* an estimate, so concurrent calls can't all slip under
// the cap, then settles to the real cost once the API reports usage.
//
// If the migration hasn't been applied yet, the daily caps fall back to
// in-memory counters (per runtime instance, so only approximate in production)
// and getAiUsage() reports `persistent: false`.
//
// Workers-compatible: supabase-js over fetch, process.env read at call time.
// ============================================================
import { createClient } from '@supabase/supabase-js';

export class AiLimitError extends Error {
  constructor(message, status, code, retryAfter) {
    super(message);
    this.name = 'AiLimitError';
    this.status = status;
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

// Reserved up front per call kind (USD); replaced by the real cost on settle.
export const AI_ESTIMATE_USD = { chat: 0.04, supplement: 0.03, interaction: 0.02, nutrition: 0.03, resume: 0.15, agentRun: 1.5 };

const num = (value, fallback) => {
  const n = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// AI_DAILY_USD_LIMIT=0 (or AI_DAILY_REQUEST_LIMIT=0) turns server-key AI off.
export function aiLimits() {
  return {
    daily_usd: num(process.env.AI_DAILY_USD_LIMIT, 10),
    daily_requests: Math.floor(num(process.env.AI_DAILY_REQUEST_LIMIT, 500)),
    per_minute: Math.floor(num(process.env.AI_BURST_PER_MINUTE, 30)),
  };
}

// Optional allowlist (comma-separated emails) for the server key. Unset = any signed-in user.
export function aiAllowedEmails() {
  return String(process.env.AI_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export function mayUseServerKey(user) {
  const allowed = aiAllowedEmails();
  return !allowed.length || allowed.includes(String(user?.email || '').toLowerCase());
}

// Standard Sonnet 4.6 list rates, USD per million tokens (see backend/claude.js).
export function sonnetCostUsd(usage) {
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  return Math.round(((input * 3 + (usage?.output_tokens || 0) * 15) / 1e6) * 10000) / 10000;
}

// Day buckets are UTC so every runtime and the database agree on the boundary.
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

let adminClient = null;
function adminDb() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

/* ---------------- In-memory state (burst limit + migration-less fallback) ---------------- */

const bursts = new Map(); // userId -> request timestamps within the last minute
const memoryDays = new Map(); // `${userId}:${day}` -> { requests, cost, input, output }
let storeMissingUntil = 0; // ai_usage RPCs not found: use memory until this time

export function resetAiGuard() {
  bursts.clear();
  memoryDays.clear();
  storeMissingUntil = 0;
}

function burstWait(userId, perMinute, now) {
  const recent = (bursts.get(userId) || []).filter((t) => now - t < 60000);
  if (recent.length >= perMinute) {
    bursts.set(userId, recent);
    return Math.max(1, Math.ceil((recent[0] + 60000 - now) / 1000));
  }
  recent.push(now);
  bursts.set(userId, recent);
  if (bursts.size > 500) for (const [id, times] of bursts) if (!times.some((t) => now - t < 60000)) bursts.delete(id);
  return 0;
}

const memoryRow = (userId, day) => {
  const key = `${userId}:${day}`;
  if (!memoryDays.has(key)) {
    for (const old of memoryDays.keys()) if (!old.endsWith(`:${day}`)) memoryDays.delete(old);
    memoryDays.set(key, { requests: 0, cost: 0, input: 0, output: 0 });
  }
  return memoryDays.get(key);
};

// Same rule as ai_usage_reserve() in SQL.
function memoryReserve(userId, day, estimate, limits) {
  const row = memoryRow(userId, day);
  if (row.requests >= limits.daily_requests) return { allowed: false, reason: 'requests' };
  if (row.cost + estimate > limits.daily_usd) return { allowed: false, reason: 'spend' };
  row.requests += 1;
  row.cost += estimate;
  return { allowed: true, day };
}

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function|does not exist/i.test(error?.message || '');

const limitMessage = (reason, limits) =>
  reason === 'requests'
    ? `Daily AI request limit reached (${limits.daily_requests}). It resets at 00:00 UTC, or add your own Anthropic key in Settings → Connectors.`
    : `Daily AI spend limit reached ($${limits.daily_usd.toFixed(2)}). It resets at 00:00 UTC, or add your own Anthropic key in Settings → Connectors.`;

/* ---------------- Reservation ---------------- */

const FREE_LEASE = Object.freeze({ billable: false, settle: async () => {}, release: async () => {} });

/**
 * Authorize one AI call and reserve its estimated cost. Throws AiLimitError
 * (401 / 403 / 429 / 503). Returns a lease: `settle({usd, input_tokens, output_tokens})`
 * replaces the estimate with the real cost (no `usd` keeps the estimate);
 * `release()` refunds the reservation after a call that spent nothing.
 * `deps.db` / `deps.now` let tests inject a fake Supabase client and clock.
 */
export async function reserveAi({ user, apiKey, estimateUsd = 0.05 } = {}, deps = {}) {
  if (!user?.id) throw new AiLimitError('Sign in to use AI features.', 401, 'auth');
  // The user's own key, or no server key at all: the server pays nothing.
  if (apiKey || !process.env.ANTHROPIC_API_KEY) return FREE_LEASE;
  if (!mayUseServerKey(user)) {
    throw new AiLimitError('AI on the shared server key is limited to approved accounts. Add your own Anthropic key in Settings → Connectors.', 403, 'forbidden');
  }

  const limits = aiLimits();
  const now = deps.now ? deps.now() : Date.now();
  const estimate = Math.round(Math.max(0, estimateUsd) * 10000) / 10000;

  const wait = burstWait(user.id, limits.per_minute, now);
  if (wait) throw new AiLimitError(`Too many AI requests. Try again in ${wait}s.`, 429, 'rate', wait);

  const db = deps.db === undefined ? adminDb() : deps.db;
  let outcome = null;
  let persistent = false;
  if (db && now >= storeMissingUntil) {
    const { data, error } = await db.rpc('ai_usage_reserve', {
      p_user: user.id, p_est_usd: estimate, p_max_usd: limits.daily_usd, p_max_requests: limits.daily_requests,
    });
    if (error && isMissingFunction(error)) storeMissingUntil = now + 60000; // migration not applied yet
    else if (error) throw new AiLimitError('The AI usage limiter is unavailable. Try again in a moment.', 503, 'limiter');
    else {
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new AiLimitError('The AI usage limiter is unavailable. Try again in a moment.', 503, 'limiter');
      outcome = { allowed: row.allowed === true, reason: row.reason, day: row.out_day };
      persistent = true;
    }
  }
  if (!outcome) outcome = memoryReserve(user.id, utcDay(now), estimate, limits);
  if (!outcome.allowed) throw new AiLimitError(limitMessage(outcome.reason, limits), 429, outcome.reason === 'requests' ? 'requests' : 'spend');

  let settled = false;
  const settle = async ({ usd, input_tokens = 0, output_tokens = 0 } = {}) => {
    if (settled) return;
    settled = true;
    const delta = Number.isFinite(usd) ? usd - estimate : 0;
    const input = Math.max(0, Math.round(Number(input_tokens) || 0));
    const output = Math.max(0, Math.round(Number(output_tokens) || 0));
    if (!delta && !input && !output) return;
    if (persistent) {
      try {
        const { error } = await db.rpc('ai_usage_settle', { p_user: user.id, p_day: outcome.day, p_delta_usd: delta, p_input: input, p_output: output });
        if (error) console.warn('[ai] could not record usage:', error.message);
      } catch (e) {
        console.warn('[ai] could not record usage:', e?.message);
      }
      return;
    }
    const row = memoryRow(user.id, outcome.day);
    row.cost = Math.max(0, row.cost + delta);
    row.input += input;
    row.output += output;
  };
  return { billable: true, settle, release: () => settle({ usd: 0 }) };
}

// Token usage from an Anthropic response → what settle() records.
export const spendFromUsage = (usage) =>
  usage ? { usd: sonnetCostUsd(usage), input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 } : {};

/**
 * Run `fn` under a lease. `fn(track)` calls track(usage) with the Anthropic
 * usage it saw; a thrown error refunds the reservation.
 */
export async function withAiLease({ user, apiKey, estimateUsd }, fn, deps) {
  const lease = await reserveAi({ user, apiKey, estimateUsd }, deps);
  let spend = {};
  try {
    const result = await fn((usage) => { spend = spendFromUsage(usage); });
    await lease.settle(spend);
    return result;
  } catch (e) {
    await lease.release();
    throw e;
  }
}

/**
 * Lease for a long agent run. `wrap(write)` watches the NDJSON stream for the
 * final `done` event, whose cost_usd settles the lease; a run that errors
 * before reporting a cost keeps the reserved estimate.
 */
export async function reserveAgentRun({ user, apiKey }, deps) {
  const lease = await reserveAi({ user, apiKey, estimateUsd: AI_ESTIMATE_USD.agentRun }, deps);
  let cost = null;
  return {
    wrap: (write) => (event) => {
      if (event?.type === 'done' && Number.isFinite(event.cost_usd)) cost = event.cost_usd;
      return write(event);
    },
    settle: () => lease.settle(cost == null ? {} : { usd: cost }),
  };
}

/* ---------------- Usage (Settings) ---------------- */

export async function getAiUsage(user, deps = {}) {
  const limits = aiLimits();
  const now = deps.now ? deps.now() : Date.now();
  const day = utcDay(now);
  const base = {
    day, limits, server_key: Boolean(process.env.ANTHROPIC_API_KEY),
    allowed: mayUseServerKey(user),
  };
  const db = deps.db === undefined ? adminDb() : deps.db;
  if (db && now >= storeMissingUntil) {
    const { data, error } = await db.from('ai_usage').select('requests,input_tokens,output_tokens,cost_usd').eq('user_id', user.id).eq('day', day).maybeSingle();
    if (!error) {
      return {
        ...base, persistent: true,
        requests: Number(data?.requests) || 0, cost_usd: Number(data?.cost_usd) || 0,
        input_tokens: Number(data?.input_tokens) || 0, output_tokens: Number(data?.output_tokens) || 0,
      };
    }
  }
  const row = memoryDays.get(`${user.id}:${day}`);
  return {
    ...base, persistent: false,
    requests: row?.requests || 0, cost_usd: Math.round((row?.cost || 0) * 10000) / 10000,
    input_tokens: row?.input || 0, output_tokens: row?.output || 0,
  };
}

/* ---------------- HTTP helpers ---------------- */

export const aiErrorBody = (e) => ({ error: e.message, code: e.code, ...(e.retryAfter ? { retry_after: e.retryAfter } : {}) });

// A Response for an AiLimitError, or null for any other error.
export function aiErrorResponse(e) {
  if (!(e instanceof AiLimitError)) return null;
  return new Response(JSON.stringify(aiErrorBody(e)), {
    status: e.status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {}) },
  });
}
