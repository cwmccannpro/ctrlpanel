import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  isVerifiedHost,
  collectSourceUrls,
  prepareOpportunities,
  estimateCost,
  runOpportunitiesCore,
} from '../backend/opportunities.js';
import { researchOpportunities } from '../backend/claude.js';
import { normalizeConfig } from '../src/lib/opportunityConfig.js';

const TODAY = '2026-09-13';
const NOW = new Date('2026-09-13T12:00:00Z');

// Chainable Supabase stand-in: records every call's ops, resolves via handler.
function fakeDb(handler = () => ({ data: null, error: null })) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const q = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            const p = Promise.resolve(handler(call));
            return p.then.bind(p);
          }
          return (...args) => {
            call.ops.push([prop, ...args]);
            return q;
          };
        },
      });
      return q;
    },
  };
}
const has = (call, op) => call.ops.some((o) => o[0] === op);
const arg = (call, op) => call.ops.find((o) => o[0] === op)?.[1];

// Anthropic stand-in: one scripted final message per stream() call.
function fakeAnthropic(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const msg = responses[calls.length - 1];
          const handlers = [];
          return {
            on(event, fn) {
              if (event === 'contentBlock') handlers.push(fn);
              return this;
            },
            async finalMessage() {
              for (const b of msg.content) for (const h of handlers) h(b);
              return msg;
            },
          };
        },
      },
    },
  };
}

test('normalizeUrl drops tracking params, www, hash and trailing slash', () => {
  assert.equal(normalizeUrl('https://www.Example.com/jobs/123/?utm_source=x&id=7#apply'), 'example.com/jobs/123?id=7');
  assert.equal(normalizeUrl('ftp://example.com/file'), '');
  assert.equal(normalizeUrl('not a url'), '');
});

test('link verification matches the same host or a parent/sub-domain only', () => {
  const seen = ['example.com', 'jobs.lever.co'];
  assert.equal(isVerifiedHost('https://careers.example.com/a', seen), true);
  assert.equal(isVerifiedHost('https://lever.co/x', seen), true);
  assert.equal(isVerifiedHost('https://notexample.com/a', seen), false);
  assert.equal(isVerifiedHost('garbage', seen), false);
});

test('source URLs come from results and citations, never the model text or submitted payload', () => {
  const urls = collectSourceUrls([
    [
      { type: 'text', text: 'see https://model-text.com/x', citations: [{ type: 'web_search_result_location', url: 'https://cited.com/a' }] },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://found.com/b', title: 'B' }] },
      { type: 'code_execution_tool_result', content: { stdout: 'kept https://stdout.org/c, done' } },
      { type: 'tool_use', name: 'submit_opportunities', input: { opportunities: [{ url: 'https://invented.com/z' }] } },
    ],
  ]);
  assert.deepEqual([...urls].sort(), ['https://cited.com/a', 'https://found.com/b', 'https://stdout.org/c']);
});

test('prepareOpportunities filters past items, clamps, dedupes and verifies links', () => {
  const rows = prepareOpportunities(
    [
      { kind: 'job', title: 'Expired', deadline: '2026-09-01', url: 'https://example.com/old', score: 90 },
      { kind: 'event', title: 'Last week meetup', starts_on: '2026-09-10', url: 'https://meetup.com/e/1', score: 80 },
      { kind: 'event', title: 'Buffalo AI Night', starts_on: '2026-10-02', url: 'https://www.meetup.com/buffalo-ai/events/1/?utm_medium=x', score: 140, mode: 'in_person', reasons: ['Local', ''] },
      { kind: 'job', title: 'Actuarial Analyst', url: 'https://jobs.example.com/a', score: 70, mode: 'remote' },
      { kind: 'job', title: 'Actuarial Analyst (dup)', url: 'https://jobs.example.com/a/', score: 60 },
      { kind: 'webinar', title: 'Unknown kind', url: 'https://example.com/w', score: 99 },
      { kind: 'certification', title: 'Made-up cert', url: 'https://made-up.org/cert', score: 50, deadline: 'soon' },
    ],
    { today: TODAY, seenHosts: ['meetup.com', 'example.com'], runId: 'run-1' }
  );
  assert.deepEqual(rows.map((r) => r.title), ['Buffalo AI Night', 'Actuarial Analyst', 'Made-up cert']);
  assert.equal(rows[0].score, 100);
  assert.equal(rows[0].dedupe_key, 'meetup.com/buffalo-ai/events/1');
  assert.deepEqual(rows[0].reasons, ['Local']);
  assert.equal(rows[1].source_verified, true);
  assert.equal(rows[2].source_verified, false);
  assert.equal(rows[2].deadline, null);
  assert.ok(rows.every((r) => !('status' in r) && r.run_id === 'run-1'));
});

test('estimateCost prices tokens and searches at Opus 5 list rates', () => {
  const cost = estimateCost({
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1_000_000,
    web_search_requests: 20,
  });
  assert.equal(cost, 8.2); // $5 + $2.50 + $0.50 cache reads + $0.20 searches
});

test('research resumes pause_turn, nudges once, and returns the submitted payload', async () => {
  const submitted = { opportunities: [], summary: { headline: 'h', skill_gaps: [], market_notes: '' } };
  const anthropic = fakeAnthropic([
    {
      stop_reason: 'pause_turn',
      model: 'claude-opus-5',
      usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 3 } },
      content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'actuarial analyst remote' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://soa.org/exams' }] },
      ],
    },
    { stop_reason: 'end_turn', model: 'claude-opus-5', usage: { input_tokens: 50, output_tokens: 20 }, content: [{ type: 'text', text: 'Here is what I found…' }] },
    {
      stop_reason: 'tool_use',
      model: 'claude-opus-5',
      usage: { input_tokens: 40, output_tokens: 30 },
      content: [{ type: 'tool_use', id: 't1', name: 'submit_opportunities', input: submitted }],
    },
  ]);
  const events = [];
  const config = normalizeConfig({ profile: 'Math grad', home_base: 'Buffalo, NY' });
  const out = await researchOpportunities({ config, known: [], today: TODAY }, (e) => events.push(e), { anthropic });

  assert.deepEqual(out.result, submitted);
  assert.equal(anthropic.calls.length, 3);
  assert.match(anthropic.calls[0].messages[0].content, /Today is 2026-09-13/);
  assert.equal(anthropic.calls[0].tools[0].max_uses, 20);
  assert.equal(anthropic.calls[1].tools[0].max_uses, 17); // only the remaining budget on resume
  assert.deepEqual(anthropic.calls[0].tools[0].user_location, { type: 'approximate', city: 'Buffalo', region: 'NY', country: 'US' });
  assert.equal(anthropic.calls[1].messages.at(-1).role, 'assistant'); // resumed with no extra user turn
  assert.equal(anthropic.calls[2].messages.at(-1).role, 'user'); // exactly one nudge
  assert.equal(out.usage.web_search_requests, 3);
  assert.equal(out.usage.input_tokens, 190);
  assert.equal(out.transcript.length, 3);
  assert.ok(events.some((e) => e.type === 'search' && e.query === 'actuarial analyst remote'));
});

test('research gives up after one unanswered nudge', async () => {
  const idle = { stop_reason: 'end_turn', model: 'm', usage: {}, content: [{ type: 'text', text: 'done' }] };
  const anthropic = fakeAnthropic([idle, idle]);
  await assert.rejects(
    researchOpportunities({ config: normalizeConfig({ focus: 'x' }), today: TODAY }, () => {}, { anthropic }),
    /without submitting/
  );
  assert.equal(anthropic.calls.length, 2);
});

test('a run upserts results without touching status and completes the run row', async () => {
  const db = fakeDb((call) => {
    if (call.table === 'agent_configs') return { data: { config: { profile: 'Math grad', kinds: ['job', 'event'] } }, error: null };
    if (call.table === 'opportunity_runs' && has(call, 'insert')) return { data: { id: 'run-1' }, error: null };
    if (call.table === 'opportunity_runs' && has(call, 'select')) return { data: [], error: null };
    if (call.table === 'opportunities' && has(call, 'in')) return { data: [{ dedupe_key: 'example.com/jobs/1' }], error: null };
    if (call.table === 'opportunities' && has(call, 'select')) return { data: [{ title: 'Old pick', org: 'Acme', status: 'dismissed' }], error: null };
    return { data: null, error: null };
  });
  let seen = null;
  const research = async ({ config, known, today }, emit) => {
    seen = { known, today, kinds: config.kinds };
    emit({ type: 'search', query: 'q' });
    return {
      result: {
        opportunities: [
          { kind: 'job', title: 'Existing job', url: 'https://example.com/jobs/1', score: 72 },
          { kind: 'event', title: 'New event', url: 'https://meetup.com/e/2', starts_on: '2026-10-01', score: 81 },
        ],
        summary: { headline: 'Go', skill_gaps: [{ skill: 'Exam FM', why: 'Gatekeeper', how_to_learn: 'SOA FM', url: 'https://soa.org/fm' }], market_notes: '' },
      },
      usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, web_search_requests: 4 },
      model: 'claude-opus-5',
      transcript: [[{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/jobs/1' }] }]],
    };
  };
  const events = [];
  await runOpportunitiesCore({ userId: 'user-a', apiKey: 'k', today: TODAY }, (e) => events.push(e), { client: db, research, now: NOW });

  assert.deepEqual(seen.known, [{ title: 'Old pick', org: 'Acme', status: 'dismissed' }]);
  assert.equal(seen.today, TODAY);
  assert.deepEqual(seen.kinds, ['job', 'event']);

  const [, rows, opts] = db.calls.find((c) => has(c, 'upsert')).ops.find((o) => o[0] === 'upsert');
  assert.equal(opts.onConflict, 'user_id,dedupe_key');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.user_id === 'user-a' && !('status' in r) && !('first_seen_at' in r)));
  assert.equal(rows.find((r) => r.title === 'Existing job').source_verified, true);
  assert.equal(rows.find((r) => r.title === 'New event').source_verified, false);

  // Reads are always scoped to the session's user.
  for (const c of db.calls.filter((c) => has(c, 'select') && !has(c, 'insert'))) {
    assert.ok(c.ops.some((o) => o[0] === 'eq' && o[1] === 'user_id' && o[2] === 'user-a'), `${c.table} read not scoped`);
  }

  const patch = arg(db.calls.filter((c) => c.table === 'opportunity_runs' && has(c, 'update')).at(-1), 'update');
  assert.equal(patch.status, 'complete');
  assert.equal(patch.found, 2);
  assert.equal(patch.added, 1);
  assert.equal(patch.searches, 4);
  assert.equal(patch.summary.skill_gaps[0].skill, 'Exam FM');
  const done = events.find((e) => e.type === 'done');
  assert.deepEqual({ added: done.added, updated: done.updated }, { added: 1, updated: 1 });
});

test('a run retires stale runs and refuses to start while another is in progress', async () => {
  const db = fakeDb((call) =>
    call.table === 'opportunity_runs' && has(call, 'select') ? { data: [{ id: 'busy' }], error: null } : { data: null, error: null }
  );
  const events = [];
  let researched = false;
  await runOpportunitiesCore({ userId: 'user-a', today: TODAY }, (e) => events.push(e), {
    client: db,
    research: async () => {
      researched = true;
    },
    now: NOW,
  });
  assert.equal(researched, false);
  assert.match(events.at(-1).message, /already in progress/);
  const stale = db.calls[0];
  assert.equal(arg(stale, 'update').status, 'error');
  assert.ok(stale.ops.some((o) => o[0] === 'lt' && o[1] === 'run_at' && o[2] === '2026-09-13T11:40:00.000Z'));
});

test('a run needs a profile or focus, and a signed-in user', async () => {
  const db = fakeDb((call) => {
    if (call.table === 'agent_configs') return { data: { config: { industries: ['Finance'] } }, error: null };
    if (call.table === 'opportunity_runs' && has(call, 'select')) return { data: [], error: null };
    return { data: null, error: null };
  });
  const events = [];
  await runOpportunitiesCore({ userId: 'user-a', today: TODAY }, (e) => events.push(e), { client: db, now: NOW });
  assert.match(events.at(-1).message, /profile or current focus/);
  assert.ok(!db.calls.some((c) => has(c, 'insert')));

  const anon = [];
  await runOpportunitiesCore({}, (e) => anon.push(e), { client: fakeDb() });
  assert.deepEqual(anon, [{ type: 'error', message: 'Not authenticated' }]);
});
