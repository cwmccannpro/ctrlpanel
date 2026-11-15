import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import express from 'express';

Object.assign(process.env, {
  VITE_SUPABASE_URL: 'https://ai-db.test', VITE_SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  ANTHROPIC_API_KEY: 'server-anthropic-key', FRONTEND_URL: 'https://ctrl.test',
});
const realFetch = globalThis.fetch;
const users = { 'token-one': { id: 'user-one', email: 'owner@example.test' }, 'token-two': { id: 'user-two', email: 'other@example.test' } };
const today = () => new Date().toISOString().slice(0, 10);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const USAGE = { input_tokens: 1000, output_tokens: 200 }; // 1000*3 + 200*15 = $0.006
const REAL_COST = 0.006;
let ledger, calls, rpcMode, gate, pending;

const sse = (events) => new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const anthropicReply = async (body) => {
  if (gate) await gate;
  if (body?.stream) {
    return sse([
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: USAGE.input_tokens, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello there' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } }],
      ['message_stop', { type: 'message_stop' }],
    ]);
  }
  return json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Looks fine.' }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE });
};

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url || input);
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  const method = init.method || request?.method || 'GET';
  const headers = new Headers(init.headers || request?.headers);
  const raw = typeof init.body === 'string' ? init.body : request && method !== 'GET' ? await request.text() : '';
  const body = raw ? JSON.parse(raw) : null;
  calls.push({ url, method, headers, body });
  if (url.hostname === 'api.anthropic.com') return anthropicReply(body);
  assert.equal(url.hostname, 'ai-db.test', 'No unexpected outbound requests');
  if (url.pathname === '/auth/v1/user') {
    const user = users[(headers.get('authorization') || '').replace('Bearer ', '')];
    return user ? json(user) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/ai_usage_')) {
    if (rpcMode === 'missing') return json({ code: 'PGRST202', message: 'Could not find the function public.ai_usage_reserve in the schema cache' }, 404);
    if (rpcMode === 'down') return json({ code: 'XX000', message: 'database exploded' }, 500);
    const key = `${body.p_user}:${today()}`;
    const row = (ledger[key] ||= { requests: 0, cost: 0, input: 0, output: 0 });
    if (url.pathname.endsWith('reserve')) { // same rule as ai_usage_reserve() in migrations/20261012-ai-usage.sql
      const refuse = (reason) => json([{ allowed: false, reason, out_day: today(), out_requests: row.requests, out_cost_usd: row.cost }]);
      if (row.requests >= body.p_max_requests) return refuse('requests');
      if (row.cost + body.p_est_usd > body.p_max_usd) return refuse('spend');
      row.requests += 1; row.cost += body.p_est_usd;
      return json([{ allowed: true, reason: '', out_day: today(), out_requests: row.requests, out_cost_usd: row.cost }]);
    }
    assert.equal(body.p_day, today());
    row.cost = Math.max(0, row.cost + body.p_delta_usd); row.input += body.p_input; row.output += body.p_output;
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/rest/v1/ai_usage') {
    const row = ledger[`${url.searchParams.get('user_id').replace('eq.', '')}:${url.searchParams.get('day').replace('eq.', '')}`];
    const out = row ? { requests: row.requests, input_tokens: row.input, output_tokens: row.output, cost_usd: row.cost } : null;
    return headers.get('accept')?.includes('vnd.pgrst.object') ? json(out) : json(out ? [out] : []);
  }
  throw new Error(`Unexpected request ${method} ${url}`);
};

const worker = (await import('../worker/index.js')).default;
const { handleAiRequest, estimateChatUsd } = await import('../backend/ai.js');
const { reserveAi, reserveAgentRun, resetAiGuard, getAiUsage, sonnetCostUsd, AI_ESTIMATE_USD } = await import('../backend/aiGuard.js');
const aiRouter = (await import('../backend/routes/ai.js')).default;

const LIMIT_ENV = ['AI_DAILY_USD_LIMIT', 'AI_DAILY_REQUEST_LIMIT', 'AI_BURST_PER_MINUTE', 'AI_ALLOWED_EMAILS'];
beforeEach(() => {
  ledger = {}; calls = []; rpcMode = ''; gate = null; pending = [];
  for (const name of LIMIT_ENV) delete process.env[name];
  process.env.ANTHROPIC_API_KEY = 'server-anthropic-key';
  resetAiGuard();
});
after(() => { globalThis.fetch = realFetch; });

const ctx = { waitUntil: (p) => pending.push(p) };
const call = async (path, { method = 'POST', token = 'token-one', body, raw } = {}) => {
  const response = await worker.fetch(new Request(`https://ctrl.test${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(raw !== undefined ? { body: raw } : method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  }), {}, ctx);
  return response;
};
const anthropicCalls = () => calls.filter((c) => c.url.hostname === 'api.anthropic.com');
const supplement = { supplements: [{ name: 'Creatine', dose: '5g', timing: 'Morning' }] };
const chatBody = { messages: [{ role: 'user', content: 'hi' }], context: { user: 'Cameron' } };

test('every AI route needs a signed-in user, and a token in the URL does not count', async () => {
  for (const [path, body] of [['/api/ai/chat', chatBody], ['/api/ai/supplement-analyze', supplement], ['/api/ai/interaction-check', { a: 'x', b: 'y' }]]) {
    assert.equal((await call(path, { token: null, body })).status, 401, path);
    assert.equal((await call(path, { token: 'forged', body })).status, 401, path);
    assert.equal((await call(`${path}?token=token-one`, { token: null, body })).status, 401, `${path}?token=`);
  }
  const usage = await call('/api/ai/usage', { method: 'GET', token: null });
  assert.equal(usage.status, 401);
  assert.equal(anthropicCalls().length, 0, 'nothing reached Anthropic');
  assert.equal(calls.some((c) => c.url.pathname.includes('/rpc/')), false, 'nothing was reserved');
});

test('unknown AI paths 404 and the public health check no longer advertises the key', async () => {
  assert.equal((await call('/api/ai/nope', { token: null })).status, 404);
  const health = await (await call('/api/health', { method: 'GET', token: null })).json();
  assert.equal(health.ok, true);
  assert.equal('anthropic' in health, false);
});

test('bad input is rejected before anything is reserved or spent', async () => {
  const cases = [
    ['/api/ai/chat', { body: {} }, 400], ['/api/ai/chat', { body: { messages: [] } }, 400],
    ['/api/ai/chat', { body: { messages: 'hello' } }, 400], ['/api/ai/chat', { raw: '{not json' }, 400],
    ['/api/ai/chat', { raw: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(1100000) }] }) }, 413],
    ['/api/ai/supplement-analyze', { body: { supplements: 'creatine' } }, 400],
    ['/api/ai/interaction-check', { body: { a: 'caffeine' } }, 400],
    ['/api/ai/interaction-check', { body: { a: 'x'.repeat(201), b: 'y' } }, 400],
  ];
  for (const [path, options, status] of cases) assert.equal((await call(path, options)).status, status, `${path} ${JSON.stringify(options).slice(0, 60)}`);
  assert.equal(anthropicCalls().length, 0);
  assert.equal(Object.keys(ledger).length, 0);
});

test('a call on the server key is recorded at its real cost, not the reserved estimate', async () => {
  const res = await call('/api/ai/supplement-analyze', { body: supplement });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: 'Looks fine.' });
  assert.equal(anthropicCalls()[0].headers.get('x-api-key'), 'server-anthropic-key');
  const row = ledger[`user-one:${today()}`];
  assert.equal(row.requests, 1);
  assert.ok(Math.abs(row.cost - REAL_COST) < 1e-9, `settled to ${row.cost}`);
  assert.deepEqual([row.input, row.output], [1000, 200]);

  const usage = await (await call('/api/ai/usage', { method: 'GET' })).json();
  assert.equal(usage.persistent, true);
  assert.equal(usage.requests, 1);
  assert.ok(Math.abs(usage.cost_usd - REAL_COST) < 1e-9);
  assert.deepEqual(usage.limits, { daily_usd: 10, daily_requests: 500, per_minute: 30 });
  const other = await (await call('/api/ai/usage', { method: 'GET', token: 'token-two' })).json();
  assert.equal(other.requests, 0, 'usage is per user');
});

test('a Master Controller chat turn streams, and its usage settles after the stream', async () => {
  const res = await call('/api/ai/chat', { body: chatBody });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /x-ndjson/);
  const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((e) => e.type), ['text', 'done']);
  assert.equal(events[0].text, 'Hello there');
  await Promise.all(pending);
  const row = ledger[`user-one:${today()}`];
  assert.equal(row.requests, 1);
  assert.ok(Math.abs(row.cost - REAL_COST) < 1e-9, `settled to ${row.cost}`);
});

test("the user's own Anthropic key is authenticated but not counted against the server", async () => {
  const res = await call('/api/ai/supplement-analyze', { body: { ...supplement, apiKey: 'sk-ant-personal' } });
  assert.equal(res.status, 200);
  assert.equal(anthropicCalls()[0].headers.get('x-api-key'), 'sk-ant-personal');
  assert.equal(Object.keys(ledger).length, 0);
  process.env.AI_DAILY_USD_LIMIT = '0'; // even with the server key switched off
  assert.equal((await call('/api/ai/supplement-analyze', { body: { ...supplement, apiKey: 'sk-ant-personal' } })).status, 200);
});

test('the daily request cap and spend cap stop calls before they reach Anthropic', async () => {
  process.env.AI_DAILY_REQUEST_LIMIT = '2';
  assert.equal((await call('/api/ai/supplement-analyze', { body: supplement })).status, 200);
  assert.equal((await call('/api/ai/supplement-analyze', { body: supplement })).status, 200);
  const blocked = await call('/api/ai/supplement-analyze', { body: supplement });
  assert.equal(blocked.status, 429);
  const error = await blocked.json();
  assert.equal(error.code, 'requests');
  assert.match(error.error, /Daily AI request limit reached \(2\)/);
  assert.equal(anthropicCalls().length, 2);
  assert.equal((await call('/api/ai/supplement-analyze', { token: 'token-two', body: supplement })).status, 200, 'another user is unaffected');

  process.env.AI_DAILY_REQUEST_LIMIT = '500';
  process.env.AI_DAILY_USD_LIMIT = '0'; // kill switch for the server key
  const off = await call('/api/ai/interaction-check', { body: { a: 'iron', b: 'zinc' } });
  assert.equal(off.status, 429);
  assert.equal((await off.json()).code, 'spend');
});

test('concurrent calls cannot all slip under the cap: the estimate is held while a call is in flight', async () => {
  process.env.AI_DAILY_USD_LIMIT = '0.05'; // room for one 0.03 reservation, not two
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const first = call('/api/ai/supplement-analyze', { body: supplement });
  while (!anthropicCalls().length) await new Promise((r) => setTimeout(r, 5)); // first is now in flight
  const second = await call('/api/ai/supplement-analyze', { body: supplement });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).code, 'spend');
  release();
  assert.equal((await first).status, 200);
  assert.equal(anthropicCalls().length, 1);
  // Settled to the real cost, the next call fits again.
  gate = null;
  assert.equal((await call('/api/ai/supplement-analyze', { body: supplement })).status, 200);
});

test('a burst limit slows a runaway client and says when to retry', async () => {
  process.env.AI_BURST_PER_MINUTE = '2';
  assert.equal((await call('/api/ai/interaction-check', { body: { a: 'a', b: 'b' } })).status, 200);
  assert.equal((await call('/api/ai/interaction-check', { body: { a: 'a', b: 'b' } })).status, 200);
  const slow = await call('/api/ai/interaction-check', { body: { a: 'a', b: 'b' } });
  assert.equal(slow.status, 429);
  assert.ok(Number(slow.headers.get('retry-after')) >= 1);
  assert.equal((await slow.json()).code, 'rate');
  assert.equal(anthropicCalls().length, 2);
});

test('AI_ALLOWED_EMAILS limits the server key to approved accounts', async () => {
  process.env.AI_ALLOWED_EMAILS = ' Owner@Example.test ';
  assert.equal((await call('/api/ai/supplement-analyze', { body: supplement })).status, 200);
  const denied = await call('/api/ai/supplement-analyze', { token: 'token-two', body: supplement });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'forbidden');
  assert.equal((await call('/api/ai/supplement-analyze', { token: 'token-two', body: { ...supplement, apiKey: 'sk-ant-theirs' } })).status, 200);
  const usage = await (await call('/api/ai/usage', { method: 'GET', token: 'token-two' })).json();
  assert.equal(usage.allowed, false);
});

test('before the migration is applied the caps still hold in memory; a failing limiter fails closed', async () => {
  rpcMode = 'missing';
  process.env.AI_DAILY_REQUEST_LIMIT = '1';
  assert.equal((await call('/api/ai/supplement-analyze', { body: supplement })).status, 200);
  assert.equal((await call('/api/ai/supplement-analyze', { body: supplement })).status, 429);
  const usage = await (await call('/api/ai/usage', { method: 'GET' })).json();
  assert.equal(usage.persistent, false);
  assert.equal(usage.requests, 1);
  assert.ok(Math.abs(usage.cost_usd - REAL_COST) < 1e-9);

  resetAiGuard(); rpcMode = 'down'; calls = [];
  const down = await call('/api/ai/supplement-analyze', { body: supplement });
  assert.equal(down.status, 503);
  assert.equal(anthropicCalls().length, 0, 'no spend while the limiter is unavailable');
});

test('a failed call refunds its reservation but still counts as a request', async () => {
  const lease = await reserveAi({ user: users['token-one'], estimateUsd: 0.5 }, { db: undefined });
  assert.ok(Math.abs(ledger[`user-one:${today()}`].cost - 0.5) < 1e-9);
  await lease.release();
  await lease.settle({ usd: 99 }); // settling twice is a no-op
  const row = ledger[`user-one:${today()}`];
  assert.equal(row.requests, 1);
  assert.equal(row.cost, 0);
});

test('agent runs reserve before streaming and settle to the run\'s reported cost', async () => {
  const run = await reserveAgentRun({ user: users['token-one'] });
  assert.ok(Math.abs(ledger[`user-one:${today()}`].cost - AI_ESTIMATE_USD.agentRun) < 1e-9);
  const seen = [];
  const write = run.wrap((event) => { seen.push(event.type); });
  write({ type: 'start' }); write({ type: 'done', cost_usd: 0.42 });
  await run.settle();
  assert.deepEqual(seen, ['start', 'done']);
  assert.ok(Math.abs(ledger[`user-one:${today()}`].cost - 0.42) < 1e-9);

  const crashed = await reserveAgentRun({ user: users['token-one'] });
  crashed.wrap(() => {})({ type: 'search' });
  await crashed.settle(); // no cost reported: the estimate stays
  assert.ok(Math.abs(ledger[`user-one:${today()}`].cost - (0.42 + AI_ESTIMATE_USD.agentRun)) < 1e-9);
});

test('the Worker refuses an agent run over the cap before it starts', async () => {
  process.env.AI_DAILY_USD_LIMIT = '1'; // below one run's 1.50 estimate
  for (const path of ['/api/agents/opportunities/run', '/api/agents/industry/run']) {
    const res = await call(path, { body: { today: '2026-10-12', industry: 'HVAC' } });
    assert.equal(res.status, 429, path);
    assert.equal((await res.json()).code, 'spend');
  }
  assert.equal(anthropicCalls().length, 0);
  assert.equal((await call('/api/agents/opportunities/run', { token: null })).status, 401);
});

test('the Express route is the same guarded dispatcher, streaming included', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/ai', aiRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/ai`;
    const post = (path, token, body) => realFetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    assert.equal((await post('/chat', null, chatBody)).status, 401);
    assert.equal((await post('/supplement-analyze', null, supplement)).status, 401);
    assert.equal(anthropicCalls().length, 0);

    const stream = await post('/chat', 'token-one', chatBody);
    assert.equal(stream.status, 200);
    assert.deepEqual((await stream.text()).trim().split('\n').map((l) => JSON.parse(l).type), ['text', 'done']);
    const ok = await post('/supplement-analyze', 'token-one', supplement);
    assert.deepEqual(await ok.json(), { result: 'Looks fine.' });
    assert.equal((await realFetch(`${base}/usage`, { headers: { Authorization: 'Bearer token-one' } })).status, 200);
    assert.equal((await realFetch(`${base}/missing`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('chat reservations scale with the prompt, and costs use Sonnet list rates', () => {
  assert.equal(estimateChatUsd(chatBody), AI_ESTIMATE_USD.chat);
  const big = estimateChatUsd({ messages: [{ role: 'user', content: 'x'.repeat(200000) }], context: {} });
  assert.ok(big > 0.17 && big < 0.25, `big prompt reserves ${big}`);
  assert.equal(sonnetCostUsd({ input_tokens: 1000000, output_tokens: 1000000 }), 18);
  assert.equal(sonnetCostUsd(undefined), 0);
});

test('usage reads fall back to memory when the table is unreadable', async () => {
  const usage = await getAiUsage(users['token-one'], { db: null });
  assert.equal(usage.persistent, false);
  assert.equal(usage.requests, 0);
});

test('direct dispatcher calls enforce the same sign-in rule', async () => {
  const res = await handleAiRequest(new Request('https://ctrl.test/api/ai/chat', { method: 'POST', body: JSON.stringify(chatBody) }));
  assert.equal(res.status, 401);
  assert.equal(await handleAiRequest(new Request('https://ctrl.test/api/other')), null);
});
