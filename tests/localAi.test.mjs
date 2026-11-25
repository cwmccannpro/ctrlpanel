import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { handleNutritionRequest } from '../backend/nutritionApi.js';
import { estimateOnDesktop } from '../backend/localAi.js';
import { mealInstructions, looseMicros } from '../backend/mealPrompt.js';
import { bridgeConfig, hasModel, localMealSchema, ollamaRequest, parseOllamaReply } from '../tools/local-ai-core.mjs';

const realFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]).toString('base64');
const estimate = { food_present: true, food_name: 'Turkey sandwich', calories: 480, protein: 32, carbs: 44, fat: 18, confidence: 'medium', notes: 'Standard deli portion.', assumptions: ['Two slices of bread.'] };
const sha = (v) => createHash('sha256').update(v).digest('hex');
let bridges, jobs, anthropicCalls, rpcCalls, personalKey;

// In-memory stand-in for public.local_ai_relay (migrations/20261121-local-ai.sql).
function relayRpc({ p_action: action, p_user: user, p_hash: hash, p_body: body = {} }) {
  const err = (message, code) => ({ error: { code, message } });
  const bridgeActions = ['poll', 'complete'];
  let b;
  if (bridgeActions.includes(action)) {
    if (!hash || user) return err('Invalid desktop credential.', '42501');
    b = [...bridges.values()].find((x) => x.key_hash === hash);
    if (!b) return err('Invalid desktop credential.', '42501');
  } else {
    if (!user || hash) return err('A user session is required.', '42501');
    b = bridges.get(user);
  }
  const now = Date.now();
  if (b) for (const j of jobs) if (j.bridge_id === b.id && ['queued', 'running'].includes(j.status) && j.expires_at <= now) Object.assign(j, { status: 'expired', input: null });
  const online = Boolean(b?.key_hash && b.ready && b.last_seen > now - 15000);
  const mine = (j) => b && j.bridge_id === b.id;
  if (action === 'status') return { data: { paired: Boolean(b?.key_hash), online, ready: Boolean(b?.ready), model: b?.model ?? null, last_seen: b?.last_seen ?? null } };
  if (action === 'pair' || action === 'revoke') {
    if (!b) { if (action === 'revoke') return { data: { ok: true } }; b = { id: randomUUID(), user_id: user }; bridges.set(user, b); }
    Object.assign(b, { key_hash: action === 'pair' ? body.key_hash : null, ready: false, last_seen: null });
    jobs = jobs.filter((j) => !mine(j));
    return { data: { ok: true } };
  }
  if (action === 'enqueue') {
    if (!online) return { data: { online: false } };
    if (jobs.filter((j) => mine(j) && ['queued', 'running'].includes(j.status)).length >= 2) return { data: { online: true, busy: true } };
    const job = { id: randomUUID(), bridge_id: b.id, input: body.input, status: 'queued', expires_at: now + 45000 };
    jobs.push(job);
    return { data: { online: true, id: job.id } };
  }
  if (action === 'result' || action === 'cancel') {
    const j = jobs.find((x) => mine(x) && x.id === body.id);
    if (!j) return { data: { status: 'expired' } };
    if (action === 'cancel' || ['done', 'failed', 'expired'].includes(j.status)) jobs = jobs.filter((x) => x !== j);
    return { data: { status: action === 'cancel' ? 'expired' : j.status, result: j.result ?? null, error: j.error ?? null, model: j.model ?? null } };
  }
  if (action === 'poll') {
    Object.assign(b, { last_seen: now, ready: body.ready === true, model: body.model || null });
    if (b.ready && !jobs.some((j) => mine(j) && j.status === 'running')) {
      const j = jobs.find((x) => mine(x) && x.status === 'queued');
      if (j) { const input = j.input; Object.assign(j, { status: 'running', input: null }); return { data: { job: { id: j.id, input, expires_at: new Date(j.expires_at).toISOString() } } }; }
    }
    return { data: { job: null } };
  }
  if (action === 'complete') {
    const j = jobs.find((x) => mine(x) && x.id === body.id);
    if (!j || j.status !== 'running') return { data: { ok: true, ignored: true } };
    Object.assign(j, { status: body.ok ? 'done' : 'failed', result: body.ok ? body.result : null, error: body.error ?? null, model: body.model || null });
    return { data: { ok: true } };
  }
  return err('Unknown desktop model action.', '22023');
}

beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'https://local-ai-db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', VITE_SUPABASE_ANON_KEY: 'test-anon', ANTHROPIC_API_KEY: 'test-env-ai' });
  bridges = new Map(); jobs = []; anthropicCalls = 0; rpcCalls = []; personalKey = true;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'api.anthropic.com') {
      anthropicCalls += 1;
      return json({ id: 'msg-1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'tool_use', id: 't1', name: 'meal_estimate', input: estimate }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100 } });
    }
    assert.equal(url.hostname, 'local-ai-db.test', 'no unexpected outbound requests');
    if (url.pathname === '/auth/v1/user') return headers.get('authorization') === 'Bearer owner-session' ? json({ id: 'owner-1' }) : json({ message: 'Unauthorized' }, 401);
    if (url.pathname === '/rest/v1/rpc/local_ai_relay') {
      assert.equal(headers.get('authorization'), 'Bearer test-service', 'relay runs on the service role only');
      rpcCalls.push(body.p_action);
      const { data, error } = relayRpc(body);
      return error ? json(error, 400) : json(data);
    }
    // A personal connector key → free, uncounted lease (no ai_usage traffic).
    if (url.pathname === '/rest/v1/user_settings') return json({ connectors: personalKey ? [{ type: 'anthropic', enabled: true, config: { key: 'test-personal-ai' } }] : [], ui_preferences: {} });
    if (['/rest/v1/api_keys', '/rest/v1/nutrition_logs'].includes(url.pathname)) return json([]);
    throw new Error(`Unhandled ${url.pathname}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'ANTHROPIC_API_KEY']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});
const call = (method, path, body, token = 'owner-session') => handleNutritionRequest(method, new URL(`https://ctrlpanel.example.com/api/nutrition/${path}`), new Headers({ authorization: `Bearer ${token}` }), body);

// Plays the desktop: poll until a job arrives, answer it once.
async function fakeDesktop(key, answer) {
  for (let i = 0; i < 40; i += 1) {
    const { job } = await call('POST', 'local/bridge/poll', { ready: true, model: 'qwen2.5vl:7b' }, key);
    if (job) { await call('POST', 'local/bridge/complete', { id: job.id, model: 'qwen2.5vl:7b', ...answer(job) }, key); return job; }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('desktop never received a job');
}

test('bridge config only talks to CTRLpanel over https and to Ollama on loopback', () => {
  assert.deepEqual(bridgeConfig({}), { origin: 'https://ctrlpanel.cwmccann.pro', ollama: 'http://127.0.0.1:11434', model: 'qwen2.5vl:7b', keepAlive: '15m' });
  assert.equal(bridgeConfig({ origin: 'http://localhost:3001' }).origin, 'http://localhost:3001');
  for (const raw of [{ origin: 'http://ctrlpanel.cwmccann.pro' }, { origin: 'https://u:p@x.example' }, { origin: 'https://x.example/path' },
    { ollama: 'http://192.168.1.5:11434' }, { ollama: 'https://ollama.example.com' }, { model: 'bad model; rm' }]) assert.throws(() => bridgeConfig(raw));
  assert.ok(hasModel({ models: [{ name: 'qwen2.5vl:7b' }] }, 'qwen2.5vl:7b'));
  assert.ok(hasModel({ models: [{ name: 'gemma3:latest' }] }, 'gemma3'));
  assert.ok(!hasModel({ models: [{ name: 'qwen2.5vl:3b' }] }, 'qwen2.5vl:7b'));
});

test('Ollama request carries the shared instructions, schema and image; tampered jobs are refused', () => {
  const cfg = bridgeConfig({});
  const photo = ollamaRequest({ byText: false, imageBase64: jpeg, mediaType: 'image/jpeg', context: 'half eaten' }, cfg);
  assert.ok(photo.messages[0].content.startsWith(mealInstructions('local')));
  assert.ok(photo.messages[0].content.includes('First list every component in items'));
  assert.deepEqual(Object.keys(photo.format.properties).slice(0, 4), ['food_present', 'food_name', 'items', 'calories'], 'items are written before totals');
  assert.ok(localMealSchema().required.includes('items'));
  assert.equal(photo.options.num_ctx, 4096, 'fits an 8 GB GPU');
  assert.ok(photo.options.num_predict <= 1500, 'runaway answers stop quickly');
  assert.ok(!photo.messages[0].content.includes('meal_estimate'));
  assert.deepEqual(photo.messages[1].images, [jpeg]);
  assert.equal(photo.messages[1].content, 'Meal portion details: half eaten');
  assert.equal(photo.format.properties.micros.type, 'object');
  assert.equal(photo.stream, false);
  const text = ollamaRequest({ byText: true, description: 'Two eggs' }, cfg);
  assert.equal(text.messages[1].content, 'Meal description: Two eggs');
  assert.equal(text.messages[1].images, undefined);
  for (const job of [{ byText: true, description: '' }, { imageBase64: 'PHN2Zz4=', mediaType: 'image/svg+xml' }, {}]) assert.throws(() => ollamaRequest(job, cfg));
});

test('model replies parse from plain or fenced JSON and drop unknown fields', () => {
  assert.deepEqual(parseOllamaReply({ message: { content: JSON.stringify({ ...estimate, extra: 'x' }) } }), estimate);
  assert.equal(parseOllamaReply({ message: { content: '```json\n{"food_present":true,"food_name":"Tea"}\n```' } }).food_name, 'Tea');
  for (const content of ['', 'not json', '[1,2]', undefined]) assert.throws(() => parseOllamaReply({ message: { content } }));
  const itemized = parseOllamaReply({ message: { content: JSON.stringify({ ...estimate, calories: 100, notes: 'Two items.', items: [
    { name: 'Rice', grams: 200, calories: 260, protein: 5, carbs: 57, fat: 0.5 }, { name: 'Chicken', grams: 150, calories: 248, protein: 46, carbs: 0, fat: 5.4 }, { name: 'bad', calories: -1 }] }) } });
  assert.deepEqual([itemized.calories, itemized.protein, itemized.carbs, itemized.fat], [508, 51, 57, 5.9], 'totals are summed from items, not the model');
  assert.equal(itemized.notes, 'Two items. Breakdown: Rice (200 g) 260 kcal; Chicken (150 g) 248 kcal.');
  assert.equal(itemized.items, undefined);
  assert.deepEqual(looseMicros({ calcium: 120, iron: '2.5', sodium: -4, made_up: 3, fiber: 'lots', vitamin_c: 1e9 }), { calcium: 120, iron: 2.5 });
});

test('desktop on: the meal is estimated locally, free, without touching Claude or keeping the photo', async () => {
  const { credential } = await call('POST', 'local/pair', {});
  assert.match(credential, /^ctla_[a-f0-9]{64}$/);
  assert.equal(bridges.get('owner-1').key_hash, sha(credential));
  await call('POST', 'local/bridge/poll', { ready: true, model: 'qwen2.5vl:7b' }, credential);
  assert.equal((await call('GET', 'status')).local.online, true);
  let seenInput;
  const [result] = await Promise.all([
    call('POST', 'analyze', { imageBase64: jpeg, mediaType: 'image/jpeg', context: 'large', apiKey: 'untrusted', user_id: 'owner-2' }),
    fakeDesktop(credential, (job) => { seenInput = job.input; return { ok: true, result: { ...estimate, micros: { calcium: 90, bogus: 1 } } }; }),
  ]);
  assert.deepEqual(seenInput, { byText: false, imageBase64: jpeg, mediaType: 'image/jpeg', context: 'large' }, 'only the meal reaches the desktop');
  assert.equal(result.engine.kind, 'desktop');
  assert.equal(result.engine.model, 'qwen2.5vl:7b');
  assert.equal(result.usage.estimated_cost_usd, 0);
  assert.equal(result.estimate.calories, 480);
  assert.deepEqual(result.estimate.micros, { calcium: 90 });
  assert.ok(result.estimate.notes.startsWith('Photo estimate.'));
  assert.equal(anthropicCalls, 0);
  assert.equal(jobs.length, 0, 'job row (and photo) is gone once read');
});

test('desktop off, failing or answering junk: Claude estimates instead', async () => {
  const offline = await call('POST', 'analyze', { description: 'Turkey sandwich' });
  assert.equal(offline.engine.kind, 'claude');
  assert.equal(anthropicCalls, 1);

  const { credential } = await call('POST', 'local/pair', {});
  await call('POST', 'local/bridge/poll', { ready: false, model: 'qwen2.5vl:7b' }, credential);
  assert.equal((await call('POST', 'analyze', { description: 'Turkey sandwich' })).engine.kind, 'claude', 'model not loaded → Claude');
  assert.equal(jobs.length, 0, 'nothing queued for a desktop that is not ready');

  await call('POST', 'local/bridge/poll', { ready: true }, credential);
  const [failed] = await Promise.all([call('POST', 'analyze', { description: 'Turkey sandwich' }), fakeDesktop(credential, () => ({ ok: false, error: 'Ollama HTTP 500' }))]);
  assert.equal(failed.engine.kind, 'claude');
  const [junk] = await Promise.all([call('POST', 'analyze', { description: 'Turkey sandwich' }), fakeDesktop(credential, () => ({ ok: true, result: { ...estimate, calories: -50 } }))]);
  assert.equal(junk.engine.kind, 'claude');
  assert.equal(anthropicCalls, 4);
});

test('no Anthropic key: a failed desktop estimate says so instead of pretending', async () => {
  delete process.env.ANTHROPIC_API_KEY; personalKey = false;
  await assert.rejects(call('POST', 'analyze', { description: 'Tea' }), (e) => e.status === 503 && /Turn on your desktop model/.test(e.message));
  const { credential } = await call('POST', 'local/pair', {});
  await call('POST', 'local/bridge/poll', { ready: true }, credential);
  await assert.rejects(Promise.all([call('POST', 'analyze', { description: 'Tea' }), fakeDesktop(credential, () => ({ ok: true, result: { ...estimate, food_present: false } }))]),
    (e) => e.status === 503 && /desktop model could not/.test(e.message));
  assert.equal(anthropicCalls, 0);
});

test('a slow desktop is cancelled at the deadline so the photo does not linger', async () => {
  const { credential } = await call('POST', 'local/pair', {});
  await call('POST', 'local/bridge/poll', { ready: true }, credential);
  let clock = 0;
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const out = await estimateOnDesktop(db, 'owner-1', { byText: true, description: 'Soup' }, { waitMs: 5000, now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.deepEqual(out, { skipped: 'failed' });
  assert.ok(rpcCalls.includes('cancel'));
  assert.equal(jobs.length, 0);
});

test('keys stay in their lane: bridge keys cannot act as users, sessions cannot poll, revoke cuts the desktop off', async () => {
  const { credential } = await call('POST', 'local/pair', {});
  await assert.rejects(call('POST', 'local/pair', {}, credential), (e) => e.status === 401);
  await assert.rejects(call('POST', 'analyze', { description: 'Tea' }, credential), (e) => e.status === 401);
  await assert.rejects(call('POST', 'local/bridge/poll', { ready: true }, 'owner-session'), (e) => e.status === 401);
  await assert.rejects(call('POST', 'local/bridge/poll', { ready: true }, `ctla_${'0'.repeat(64)}`), (e) => e.status === 401);
  await assert.rejects(call('POST', 'local/bridge/complete', { id: 'nope', ok: true }, credential), (e) => e.status === 400);
  await call('POST', 'local/revoke', {});
  await assert.rejects(call('POST', 'local/bridge/poll', { ready: true }, credential), (e) => e.status === 401);
  assert.equal((await call('GET', 'local/status')).paired, false);
});
