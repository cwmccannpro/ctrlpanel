import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import express from 'express';
import { createHash } from 'node:crypto';
import { nutritionDay, nutritionDayRange, nutritionTimestamp, nutritionEntry } from '../src/lib/nutrition.js';
import { nutritionOpenApi, publicNutritionOrigin } from '../src/lib/nutritionIntegration.js';
import { analyzeNutritionMeal, analyzeNutritionPhoto } from '../backend/claude.js';
import { handleNutritionRequest, hashKey } from '../backend/nutritionApi.js';
import router from '../backend/routes/nutrition.js';
import worker from '../worker/index.js';

const realFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const rawKey = `ctp_${'1'.repeat(48)}`;
const otherKey = `ctp_${'2'.repeat(48)}`;
const meal = { food_name: 'Rice bowl', calories: 620, protein: 42, carbs: 68, fat: 18, notes: 'Estimated serving', timestamp: '2026-10-09T21:30:00-04:00', request_id: 'meal-one-unique' };
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]).toString('base64');
const estimate = { food_present: true, food_name: 'Chicken bowl', calories: 600, protein: 45, carbs: 60, fat: 20, confidence: 'medium', notes: 'One visible serving.', assumptions: ['About one cup of rice.'] };
let rows, calls, keys, databaseDown, totalsDown, aiInput;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://nutrition-db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon';
  process.env.FRONTEND_URL = 'https://ctrlpanel.example.com';
  process.env.ANTHROPIC_API_KEY = 'test-env-ai';
  rows = []; calls = []; keys = new Map([[hashKey(rawKey), 'owner-1'], [hashKey(otherKey), 'owner-2']]);
  databaseDown = false; totalsDown = false; aiInput = null;
  globalThis.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || input);
    const method = init.method || request?.method || 'GET';
    const headers = new Headers(init.headers || request?.headers);
    const raw = typeof init.body === 'string' ? init.body : request && method !== 'GET' ? await request.text() : '';
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ url, method, body, headers });
    const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'api.anthropic.com') {
      aiInput = body;
      return json({ id: 'msg-1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'tool_use', id: 'tool-1', name: 'meal_estimate', input: estimate }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100 } });
    }
    assert.equal(url.hostname, 'nutrition-db.test', 'No unexpected outbound requests');
    if (url.pathname === '/auth/v1/user') return headers.get('authorization') === 'Bearer test-session' ? json({ id: 'owner-1' }) : json({ message: 'Unauthorized' }, 401);
    if (databaseDown) return json({ code: '42P01', message: 'private database error' }, 500);
    const table = url.pathname.split('/').at(-1);
    const owner = url.searchParams.get('user_id')?.replace('eq.', '') || 'owner-1';
    if (table === 'api_keys') {
      if (method === 'PATCH') return json(null, 204);
      const hash = url.searchParams.get('key_hash')?.replace('eq.', '');
      if (!hash) return json([{ id: 'key-1' }]);
      const user = keys.get(hash);
      return json(user ? { id: `key-${user}`, user_id: user } : null);
    }
    if (table === 'user_settings') return json({ connectors: [{ type: 'anthropic', enabled: true, config: { key: 'test-personal-ai' } }], ui_preferences: { nutrition: { timeZone: 'America/New_York' } } });
    if (table === 'user_goals') return json([{ calories: 2200, protein: 160, carbs: 240, fat: 70 }]);
    if (table === 'nutrition_logs') {
      if (method === 'POST') {
        const entry = { ...body, id: body.id || 'generated-id' };
        if (rows.some((r) => r.id === entry.id)) return json({ code: '23505', message: 'duplicate' }, 409);
        rows.push(entry); return json(entry);
      }
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id) return json(rows.find((r) => r.id === id && r.user_id === owner) || null);
      if (totalsDown) return json({ message: 'totals unavailable' }, 503);
      const start = url.searchParams.get('logged_at');
      const bounds = url.searchParams.getAll('logged_at');
      return json(rows.filter((r) => r.user_id === owner && (!start || bounds.every((bound) => bound.startsWith('gte.') ? r.logged_at >= bound.slice(4) : r.logged_at < bound.slice(3)))));
    }
    throw new Error(`Unhandled table ${table}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'FRONTEND_URL', 'ANTHROPIC_API_KEY']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});
const request = (method, path, body, key = rawKey) => handleNutritionRequest(method, new URL(`https://ctrlpanel.example.com/api/nutrition/${path}`), new Headers({ authorization: `Bearer ${key}` }), body);

test('meal days stay local after UTC midnight; DST days are 23 and 25 hours', () => {
  assert.equal(nutritionDay('2026-10-10T01:30:00Z', 'America/New_York'), '2026-10-09');
  for (const [day, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
    const range = nutritionDayRange(nutritionTimestamp(day, 'America/New_York'), 'America/New_York');
    assert.equal(range.day, day);
    assert.equal((Date.parse(range.end) - Date.parse(range.start)) / 3600000, hours);
  }
  assert.throws(() => nutritionTimestamp('2026-02-30', 'UTC'), /valid meal date/);
});
test('invalid values, missing macros, implicit timezone, and non-HTTPS photos are rejected', () => {
  for (const value of [-1, Infinity, NaN, true, null, '', '  ', 'twenty', 50001]) assert.throws(() => nutritionEntry({ ...meal, calories: value }));
  for (const timestamp of ['2026-10-09', '2026-10-09T12:00:00', '2026-02-30T12:00:00Z', 'bad']) assert.throws(() => nutritionEntry({ ...meal, timestamp }));
  assert.throws(() => nutritionEntry({ ...meal, image_url: 'javascript:alert(1)' }), /HTTPS/);
  assert.equal(nutritionEntry({ ...meal, calories: '620.555' }).calories, 620.56);
});
test('OpenAPI is a public HTTPS action with Bearer auth and retry ids', () => {
  for (const origin of ['http://localhost:5173', 'https://127.0.0.1', 'https://app.local', 'https://user:pass@ctrlpanel.example.com', 'https://ctrlpanel.example.com/path']) assert.throws(() => publicNutritionOrigin(origin));
  const schema = nutritionOpenApi('https://ctrlpanel.example.com/');
  assert.equal(schema.servers[0].url, 'https://ctrlpanel.example.com');
  assert.equal(schema.components.securitySchemes.bearerAuth.scheme, 'bearer');
  assert.ok(schema.components.schemas.NutritionEntry.required.includes('request_id'));
  assert.equal(schema.paths['/api/nutrition/log'].post['x-openai-isConsequential'], false);
  assert.equal(schema.paths['/api/nutrition/check'].get.operationId, 'checkNutritionConnection');
});
test('external ownership comes from the key and daily totals exclude other users and neighbouring days', async () => {
  rows.push({ ...nutritionEntry(meal), id: 'other-user', user_id: 'owner-2', calories: 9999 }, { ...nutritionEntry(meal), id: 'next-day', user_id: 'owner-1', logged_at: '2026-10-10T04:00:00Z', calories: 8888 });
  const result = await request('POST', 'log', { ...meal, user_id: 'owner-2', id: 'malicious-id' });
  assert.equal(result.ok, true); assert.equal(result.day, '2026-10-09');
  assert.equal(result.day_totals.calories, 620); assert.equal(result.goals.calories, 2200);
  const inserted = rows.find((r) => r.id === result.entry.id);
  assert.equal(inserted.user_id, 'owner-1'); assert.notEqual(inserted.id, 'malicious-id');
});
test('retry is idempotent, changed retries conflict, and same request id is scoped to each user', async () => {
  const first = await request('POST', 'log', meal);
  const retry = await request('POST', 'log', meal);
  assert.equal(retry.replayed, true); assert.equal(first.entry.id, retry.entry.id); assert.equal(rows.length, 1);
  await assert.rejects(request('POST', 'log', { ...meal, calories: 700 }), (e) => e.status === 409);
  await request('POST', 'log', meal, otherKey);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].id, rows[1].id);
});
test('a retried current-time meal retains its original timestamp', async () => {
  const payload = { ...meal }; delete payload.timestamp;
  const first = await request('POST', 'log', payload);
  const retry = await request('POST', 'log', payload);
  assert.equal(retry.entry.logged_at, first.entry.logged_at);
  assert.equal(rows.length, 1);
});
test('invalid/revoked keys never write and service errors do not masquerade as invalid keys', async () => {
  for (const key of ['wrong', 'test-session']) await assert.rejects(request('POST', 'log', meal, key), (e) => e.status === 401);
  keys.delete(hashKey(rawKey));
  await assert.rejects(request('POST', 'log', meal), (e) => e.status === 401);
  assert.equal(rows.length, 0);
  keys.set(hashKey(rawKey), 'owner-1'); databaseDown = true;
  await assert.rejects(request('POST', 'log', meal), (e) => e.status === 503 && !e.message.includes('private database error'));
});
test('connection check reads without logging, and a saved meal remains successful if totals fail', async () => {
  const check = await request('GET', 'check');
  assert.equal(check.ok, true); assert.equal(check.timezone, 'America/New_York'); assert.equal(rows.length, 0);
  totalsDown = true;
  const saved = await request('POST', 'log', meal);
  assert.equal(saved.ok, true); assert.equal(saved.day_totals, null); assert.equal(rows.length, 1);
  await assert.rejects(request('GET', 'check'), (e) => e.status === 503);
});
test('photo/status require a session; status never exposes connector keys or service credentials', async () => {
  await assert.rejects(request('GET', 'status'), (e) => e.status === 401);
  const status = await request('GET', 'status', null, 'test-session');
  assert.equal(status.ready, true); assert.equal(status.photoReady, true);
  assert.ok(!JSON.stringify(status).includes('test-personal-ai'));
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const noService = await request('GET', 'status', null, 'test-session');
  assert.equal(noService.ready, false); assert.equal(noService.photoReady, true);
});
test('session photo uses the saved personal connector, ignores caller keys and does not log', async () => {
  const result = await request('POST', 'analyze', { imageBase64: jpeg, mediaType: 'image/jpeg', apiKey: 'untrusted-key', context: 'One serving' }, 'test-session');
  assert.equal(result.estimate.meal_name, 'Chicken bowl');
  assert.ok(result.estimate.notes.includes('Photo estimate'));
  const aiCall = calls.find((c) => c.url.hostname === 'api.anthropic.com');
  assert.equal(aiCall.headers.get('x-api-key'), 'test-personal-ai');
  assert.equal(aiInput.model, 'claude-sonnet-4-6'); assert.equal(rows.length, 0);
});
test('photo rejects non-images, large images, no food and invalid model output before saving', async () => {
  let used = false;
  const anthropic = { messages: { create: async () => { used = true; return { content: [{ type: 'tool_use', name: 'meal_estimate', input: { ...estimate, food_present: false } }] }; } } };
  for (const input of [{ mediaType: 'image/svg+xml', imageBase64: jpeg }, { mediaType: 'image/jpeg', imageBase64: 'aaaa' }, { mediaType: 'image/jpeg', imageBase64: 'a'.repeat(900000) }]) await assert.rejects(analyzeNutritionPhoto(input, { anthropic }));
  assert.equal(used, false);
  await assert.rejects(analyzeNutritionPhoto({ mediaType: 'image/jpeg', imageBase64: jpeg }, { anthropic }), /No clear meal/);
});

test('description estimates use the saved connector and report token-based cost without logging', async () => {
  const result = await request('POST', 'analyze', { description: 'Dunkin bacon egg and cheese', apiKey: 'untrusted-key', user_id: 'owner-2' }, 'test-session');
  assert.ok(result.estimate.notes.startsWith('Description estimate.'));
  assert.equal(aiInput.messages[0].content.length, 1);
  assert.equal(aiInput.messages[0].content[0].text, 'Meal description: Dunkin bacon egg and cheese');
  assert.equal(aiInput.tools.length, 1);
  assert.equal(calls.find((c) => c.url.hostname === 'api.anthropic.com').headers.get('x-api-key'), 'test-personal-ai');
  assert.equal(result.usage.estimated_cost_usd, 0.0018);
  assert.equal(rows.length, 0);
  await assert.rejects(request('POST', 'analyze', { description: 'Sandwich' }), (e) => e.status === 401);
});

test('empty, invalid and ambiguous descriptions fail before any AI call; non-food and invalid estimates cannot be saved', async () => {
  let used = false;
  let output = { ...estimate, food_present: false };
  const anthropic = { messages: { create: async () => { used = true; return { content: [{ type: 'tool_use', name: 'meal_estimate', input: output }] }; } } };
  for (const description of ['', '  ', null, 42, 'x'.repeat(2001)]) await assert.rejects(analyzeNutritionMeal({ description }, { anthropic }), /Describe your meal/);
  await assert.rejects(analyzeNutritionMeal({ description: 'Rice', imageBase64: jpeg }, { anthropic }), /Choose a photo or/);
  assert.equal(used, false);
  await assert.rejects(analyzeNutritionMeal({ description: 'Hello' }, { anthropic }), /No clear meal/);
  output = { ...estimate, calories: -1 };
  await assert.rejects(analyzeNutritionMeal({ description: 'Rice' }, { anthropic }), /Calories/);
  assert.equal(rows.length, 0);
});

test('description estimation has matching Express and Worker results', async () => {
  const app = express(); app.use(express.json()); app.use('/api/nutrition', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const options = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-session' }, body: JSON.stringify({ description: 'Dunkin bacon egg and cheese' }) };
    const local = await realFetch(`http://127.0.0.1:${server.address().port}/api/nutrition/analyze`, options);
    const production = await worker.fetch(new Request('https://ctrlpanel.example.com/api/nutrition/analyze', options), {}, {});
    assert.equal(local.status, 200); assert.equal(production.status, 200);
    assert.deepEqual(await local.json(), await production.json());
    assert.equal(rows.length, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test('public schema contains no credentials', async () => {
  const schema = await request('GET', 'openapi.json', undefined, '');
  assert.equal(schema.servers[0].url, 'https://ctrlpanel.example.com');
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(schema).includes(rawKey), false);
});
test('Express and Worker both accept the same action and return matching errors', async () => {
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api/nutrition', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/nutrition/log`;
    const options = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${rawKey}` }, body: JSON.stringify(meal) };
    const local = await realFetch(endpoint, options);
    assert.equal(local.status, 200);
    const production = await worker.fetch(new Request('https://ctrlpanel.example.com/api/nutrition/log', options), {}, { waitUntil() {} });
    assert.equal(production.status, 200); assert.equal((await production.json()).replayed, true); assert.equal(rows.length, 1);
    const bad = { ...options, body: JSON.stringify({ ...meal, calories: -10 }) };
    const expressError = await realFetch(endpoint, bad);
    const workerError = await worker.fetch(new Request('https://ctrlpanel.example.com/api/nutrition/log', bad), {}, {});
    assert.equal(expressError.status, 400); assert.equal(workerError.status, 400);
    assert.deepEqual(await expressError.json(), await workerError.json());
    const oversized = await worker.fetch(new Request('https://ctrlpanel.example.com/api/nutrition/analyze', { ...options, body: 'x'.repeat(950001) }), {}, {});
    assert.equal(oversized.status, 413);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
