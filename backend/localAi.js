// Desktop model relay for meal estimates (Express + Worker, via nutritionApi.js).
// The owner's Windows desktop polls outbound with a ctla_ key; no inbound port,
// tunnel or public model endpoint exists. Storage is service-role only and every
// action goes through the local_ai_relay RPC (migrations/20261121-local-ai.sql).
import { createHash, randomBytes } from 'node:crypto';
import { finishMealEstimate, looseMicros } from './mealPrompt.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const BRIDGE_KEY = /^ctla_[a-f0-9]{64}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOCAL_WAIT_MS = 42000;

async function relay(db, action, { user = null, key = null, body = {} } = {}) {
  const { data, error } = await db.rpc('local_ai_relay', { p_action: action, p_user: user, p_hash: key ? hash(key) : null, p_body: body });
  if (error) {
    const statuses = { '42501': 401, '22023': 400 };
    throw fail(statuses[error.code] ? error.message : 'Desktop model storage is unavailable. Apply migrations/20261121-local-ai.sql.', statuses[error.code] || 503);
  }
  return data;
}

// Signed-in owner: status / pair / revoke.
export async function handleLocalAiUser(db, userId, path, method) {
  if (path === 'status' && method === 'GET') return relay(db, 'status', { user: userId });
  if (path === 'pair' && method === 'POST') {
    const credential = `ctla_${randomBytes(32).toString('hex')}`;
    await relay(db, 'pair', { user: userId, body: { key_hash: hash(credential) } });
    return { credential }; // shown once; only the hash is stored
  }
  if (path === 'revoke' && method === 'POST') return relay(db, 'revoke', { user: userId });
  throw fail('Desktop model endpoint not found.', 404);
}

// Desktop bridge: poll (heartbeat + claim one job) / complete (one result).
export async function handleLocalAiBridge(db, key, path, body = {}) {
  if (!BRIDGE_KEY.test(key || '')) throw fail('Invalid desktop credential.', 401);
  if (path === 'bridge/poll') {
    return relay(db, 'poll', { key, body: { ready: body.ready === true, model: typeof body.model === 'string' ? body.model.slice(0, 100) : '' } });
  }
  if (path === 'bridge/complete') {
    if (typeof body.id !== 'string' || !JOB_ID.test(body.id) || typeof body.ok !== 'boolean') throw fail('Invalid desktop result.');
    if (body.error !== undefined && (typeof body.error !== 'string' || body.error.length > 240)) throw fail('Invalid desktop result.');
    return relay(db, 'complete', { key, body: { id: body.id, ok: body.ok, result: body.ok ? body.result : null, error: body.error, model: typeof body.model === 'string' ? body.model.slice(0, 100) : '' } });
  }
  throw fail('Desktop model endpoint not found.', 404);
}

export async function localAiStatus(db, userId) {
  try { return await relay(db, 'status', { user: userId }); } catch { return { paired: false, online: false, unavailable: true }; }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Try the owner's desktop model. Resolves to { result } (an /analyze response), or
 * { skipped: 'offline' } / { skipped: 'failed' } so the caller can fall back to
 * Claude. `input` is already validated (validateMealInput).
 */
export async function estimateOnDesktop(db, userId, input, { waitMs = LOCAL_WAIT_MS, sleep = pause, now = Date.now } = {}) {
  let job;
  try {
    job = await relay(db, 'enqueue', { user: userId, body: { input } });
  } catch { return { skipped: 'offline' }; } // migration missing / storage down: Claude still works
  if (!job?.online || !job.id) return { skipped: 'offline' };
  const deadline = now() + waitMs;
  // ~1.5 s cadence keeps a Worker well inside its per-request subrequest budget.
  for (let wait = 1200; now() < deadline; wait = 1500) {
    await sleep(Math.min(wait, Math.max(0, deadline - now())));
    let state;
    try { state = await relay(db, 'result', { user: userId, body: { id: job.id } }); } catch { break; }
    if (state.status === 'done') {
      try {
        const raw = state.result || {};
        const micros = looseMicros(raw.micros);
        return { result: { estimate: finishMealEstimate({ ...raw, ...(micros ? { micros } : { micros: undefined }) }, input.byText),
          usage: { estimated_cost_usd: 0 }, engine: { kind: 'desktop', model: state.model || null } } };
      } catch { return { skipped: 'failed' }; } // e.g. food_present false or impossible macros → let Claude decide
    }
    if (state.status === 'failed' || state.status === 'expired') return { skipped: 'failed' };
  }
  await relay(db, 'cancel', { user: userId, body: { id: job.id } }).catch(() => {});
  return { skipped: 'failed' };
}
