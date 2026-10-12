import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareProblems, runIndustryCore } from '../backend/industry.js';
import { researchIndustry } from '../backend/claude.js';
import {
  normalizeIndustryConfig,
  isIndustryConfigReady,
  cleanIndustry,
  industrySlug,
  SCORE_PARTS,
} from '../src/lib/industryConfig.js';
import {
  industriesFromRuns,
  problemsFor,
  problemsByMapKey,
  problemToMarkdown,
  projectFromProblem,
  STATUS_FILTERS,
} from '../src/lib/industryProblems.js';

const TODAY = '2026-10-05';
const NOW = new Date('2026-10-05T12:00:00Z');

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

const scores = (o = {}) => ({ pain: 25, attainable: 20, demand: 15, reach: 10, gap: 7, ...o });
const problem = (o = {}) => ({
  key: 'no-shows',
  title: 'Appointment no-shows',
  problem: 'Patients miss visits and the chair sits empty.',
  who: 'Office manager',
  stage: 'Getting patients',
  solution: 'Two-way SMS reminders with one-tap rebooking',
  mvp: 'Reminders from a CSV export',
  solution_type: 'automation',
  build_weeks: 3,
  pricing: '$79/mo',
  reach: 'Local dental study clubs',
  competition: 'Practice suites bundle it but charge extra',
  evidence: [{ source: 'G2', kind: 'review', url: 'https://www.g2.com/products/x/reviews', note: 'Reviewers say reminders cost extra and are rigid' }],
  scores: scores(),
  risk: 'Practice-management vendors can ship it',
  ...o,
});

/* ---------------- config + page helpers ---------------- */

test('config merges over defaults, bounds numbers and needs a builder description', () => {
  const c = normalizeIndustryConfig({ builder: 'React + Node', solution_types: ['automation', 'nonsense'], buyers: [], build_weeks: 400, max_searches: 1, target_results: 'x' });
  assert.deepEqual(c.solution_types, ['automation']);
  assert.deepEqual(c.buyers, ['smb']);
  assert.equal(c.build_weeks, 26);
  assert.equal(c.max_searches, 5);
  assert.equal(c.target_results, 10);
  assert.equal(c.avoid_regulated, true);
  assert.equal(isIndustryConfigReady(c), true);
  assert.equal(isIndustryConfigReady(normalizeIndustryConfig({})), false);
  assert.equal(isIndustryConfigReady(normalizeIndustryConfig({ builder: '   ' })), false);
  assert.equal(cleanIndustry('  Dental \n  practices '), 'Dental practices');
  assert.equal(industrySlug('Dental Practices!'), 'dental-practices');
  assert.equal(SCORE_PARTS.reduce((s, p) => s + p.max, 0), 100);
});

test('industries group completed runs newest first; problems rank by score', () => {
  const runs = [
    { id: 'r1', status: 'complete', industry: 'Dental practices', industry_key: 'dental-practices', run_at: '2026-10-01T10:00:00Z' },
    { id: 'r2', status: 'complete', industry: 'HVAC', industry_key: 'hvac', run_at: '2026-10-02T10:00:00Z' },
    { id: 'r3', status: 'complete', industry: 'Dental Practices', industry_key: 'dental-practices', run_at: '2026-10-03T10:00:00Z' },
    { id: 'r4', status: 'error', industry: 'Law firms', industry_key: 'law-firms', run_at: '2026-10-04T10:00:00Z' },
    { id: 'r5', status: 'running', industry: 'Salons', industry_key: 'salons', run_at: '2026-10-05T10:00:00Z' },
  ];
  const inds = industriesFromRuns(runs);
  assert.deepEqual(inds.map((i) => [i.key, i.name, i.run.id]), [['dental-practices', 'Dental Practices', 'r3'], ['hvac', 'HVAC', 'r2']]);

  const rows = [
    { id: 'a', industry_key: 'hvac', score: 50, run_id: 'r2', map_key: 'k1' },
    { id: 'b', industry_key: 'hvac', score: 80, run_id: 'r2', map_key: 'k2', last_seen_at: '2026-10-02' },
    { id: 'c', industry_key: 'hvac', score: 80, run_id: 'old', map_key: 'k2', last_seen_at: '2026-01-01' },
    { id: 'd', industry_key: 'dental-practices', score: 99, run_id: 'r3', map_key: 'k9' },
  ];
  assert.deepEqual(problemsFor(rows, 'hvac').map((p) => p.id), ['b', 'c', 'a']);
  const byKey = problemsByMapKey(problemsFor(rows, 'hvac'), 'r2');
  assert.deepEqual([...byKey].map(([k, p]) => [k, p.id]), [['k2', 'b'], ['k1', 'a']]);
  assert.equal(STATUS_FILTERS.find((f) => f.id === 'active').test('exploring'), true);
  assert.equal(STATUS_FILTERS.find((f) => f.id === 'active').test('dismissed'), false);
});

test('a problem exports as a Markdown brief and starts a project', () => {
  const row = { ...prepareProblems([problem()], { industry: 'Dental practices', seenHosts: ['g2.com'] })[0], id: 'p1' };
  const md = problemToMarkdown(row);
  assert.match(md, /^## Appointment no-shows/);
  assert.match(md, /\*\*What to build:\*\* Two-way SMS reminders/);
  assert.match(md, /Pain 25\/30 · Attainable 20\/25 · Demand 15\/20 · Reach 10\/15 · Gap 7\/10/);
  assert.match(md, /\[G2 — Software review\]\(https:\/\/www\.g2\.com\/products\/x\/reviews\)/);
  assert.doesNotMatch(md, /unverified/);
  const proj = projectFromProblem(row);
  assert.equal(proj.name, 'Appointment no-shows');
  assert.equal(proj.status, 'Active');
  assert.match(proj.description, /Buyer: Office manager/);
  assert.match(proj.goal, /Reminders from a CSV export/);
  assert.ok(!('color' in proj) && !('user_id' in proj));
});

/* ---------------- result shaping ---------------- */

test('prepareProblems clamps and sums the score parts, verifies evidence, dedupes and never sets status', () => {
  const rows = prepareProblems(
    [
      problem(),
      problem({ key: 'dup', title: 'Appointment  no-shows', scores: scores({ pain: 5 }) }), // same slug, lower score
      problem({ key: 'wild', title: 'Wild scores', scores: { pain: 99, attainable: -4, demand: 'x', reach: 15.6, gap: 10 }, solution_type: 'teleporter', build_weeks: 900, evidence: [{ source: 'G2', kind: 'nope', url: 'https://www.g2.com/a', note: 'ok' }] }),
      problem({ key: 'bad', title: '', problem: 'no title' }),
      problem({ key: 'bad2', title: 'No problem text', problem: '' }),
    ],
    { industry: 'Dental practices', seenHosts: ['g2.com'], runId: 'run-1' }
  );
  assert.deepEqual(rows.map((r) => r.title), ['Appointment no-shows', 'Wild scores']);
  const [a, w] = rows;
  assert.equal(a.score, 77);
  assert.equal(a.dedupe_key, 'dental-practices::appointment-no-shows');
  assert.equal(a.industry_key, 'dental-practices');
  assert.equal(a.evidence_verified, 1);
  assert.deepEqual(w.scores, { pain: 30, attainable: 0, demand: 0, reach: 15, gap: 10 });
  assert.equal(w.score, 55);
  assert.equal(w.solution_type, null);
  assert.equal(w.build_weeks, 52);
  assert.equal(w.evidence[0].kind, 'other');
  assert.ok(rows.every((r) => !('status' in r) && !('first_seen_at' in r) && r.run_id === 'run-1'));
});

test('a problem with no verified source earns no demand credit and capped pain', () => {
  const [unsupported] = prepareProblems([problem({ evidence: [{ source: 'Made up', kind: 'forum', url: 'https://invented.example/post', note: 'Everyone hates it' }] })], {
    industry: 'Dental practices',
    seenHosts: ['g2.com'],
  });
  assert.equal(unsupported.evidence_verified, 0);
  assert.equal(unsupported.evidence[0].verified, false);
  assert.deepEqual({ pain: unsupported.scores.pain, demand: unsupported.scores.demand }, { pain: 15, demand: 0 });
  assert.equal(unsupported.score, 15 + 20 + 0 + 10 + 7);

  const [none] = prepareProblems([problem({ evidence: [] })], { industry: 'Dental practices', seenHosts: ['g2.com'] });
  assert.equal(none.evidence_verified, 0);
  assert.ok(none.score <= 65);
});

/* ---------------- research ---------------- */

test('research puts the industry, builder and constraints in the brief and uses the industry tool', async () => {
  const submitted = { map: { stages: [] }, problems: [], summary: { headline: 'h', where_to_start: 'w', market_notes: 'm' } };
  const anthropic = fakeAnthropic([
    { stop_reason: 'tool_use', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'submit_industry_problems', input: submitted }] },
  ]);
  const config = normalizeIndustryConfig({ builder: 'React + Supabase, solo', buyers: ['solo'], build_weeks: 2, home_base: 'Buffalo, NY', local_first: true, avoid: 'crypto' });
  const out = await researchIndustry(
    { config, industry: 'Dental practices', focus: 'independent offices', known: [{ title: 'Old idea', status: 'dismissed' }], today: TODAY },
    () => {},
    { anthropic }
  );
  assert.deepEqual(out.result, submitted);
  const call = anthropic.calls[0];
  const brief = call.messages[0].content;
  assert.match(brief, /Today is 2026-10-05/);
  assert.match(brief, /## Industry\nDental practices/);
  assert.match(brief, /independent offices/);
  assert.match(brief, /React \+ Supabase, solo/);
  assert.match(brief, /Maximum build time for a first version: 2 weeks/);
  assert.match(brief, /Solo operators/);
  assert.match(brief, /- Old idea \[dismissed\]/);
  assert.match(brief, /prefer problems whose buyers are reachable in person nearby/);
  assert.deepEqual(call.tools.map((t) => t.name), ['web_search', 'submit_industry_problems']);
  assert.equal(call.tools[1].strict, true);
  assert.deepEqual(call.tools[0].user_location, { type: 'approximate', city: 'Buffalo', region: 'NY', country: 'US' });
  assert.match(call.system, /Industry Problems Agent/);

  // Without local_first the search is not skewed to the home base.
  const anthropic2 = fakeAnthropic([
    { stop_reason: 'tool_use', model: 'm', usage: {}, content: [{ type: 'tool_use', id: 't', name: 'submit_industry_problems', input: submitted }] },
  ]);
  await researchIndustry({ config: normalizeIndustryConfig({ builder: 'x', home_base: 'Buffalo, NY' }), industry: 'HVAC', today: TODAY }, () => {}, { anthropic: anthropic2 });
  assert.equal(anthropic2.calls[0].tools[0].user_location, undefined);
});

/* ---------------- the run ---------------- */

function runDb({ config = { builder: 'React + Node' }, active = [], existing = [] } = {}) {
  return fakeDb((call) => {
    if (call.table === 'agent_configs') return { data: { config }, error: null };
    if (call.table === 'industry_runs' && has(call, 'insert')) return { data: { id: 'run-1' }, error: null };
    if (call.table === 'industry_runs' && has(call, 'select')) return { data: active, error: null };
    if (call.table === 'industry_problems' && has(call, 'in')) return { data: existing, error: null };
    if (call.table === 'industry_problems' && has(call, 'select')) return { data: [{ title: 'Old idea', status: 'dismissed' }], error: null };
    return { data: null, error: null };
  });
}

test('a run upserts problems without touching status and stores the map with the run', async () => {
  const db = runDb({ existing: [{ dedupe_key: 'dental-practices::appointment-no-shows' }] });
  let seen = null;
  const research = async ({ config, industry, focus, known, today }, emit) => {
    seen = { builder: config.builder, industry, focus, known, today };
    emit({ type: 'search', query: 'dental practice software complaints' });
    return {
      result: {
        map: {
          stages: [
            {
              name: 'Getting patients',
              summary: 'Booking',
              steps: [
                { name: 'Online booking', pain: 'Empty chairs from no-shows', problem_key: 'no-shows' },
                { name: 'Referrals', pain: 'Untracked', problem_key: 'not-a-real-key' },
              ],
            },
          ],
        },
        problems: [problem(), problem({ key: 'recalls', title: 'Hygiene recall follow-up', scores: scores({ pain: 10 }) })],
        summary: { headline: 'Scheduling gaps', where_to_start: 'Validate reminders', market_notes: 'Owners buy on word of mouth' },
      },
      usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, web_search_requests: 5 },
      model: 'claude-opus-5',
      transcript: [[{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.g2.com/products/x/reviews' }] }]],
    };
  };
  const events = [];
  await runIndustryCore({ userId: 'user-a', apiKey: 'k', today: TODAY, industry: '  Dental   practices ', focus: 'independent offices' }, (e) => events.push(e), { client: db, research, now: NOW });

  assert.deepEqual(seen, { builder: 'React + Node', industry: 'Dental practices', focus: 'independent offices', known: [{ title: 'Old idea', status: 'dismissed' }], today: TODAY });

  const [, rows, opts] = db.calls.find((c) => c.table === 'industry_problems' && has(c, 'upsert')).ops.find((o) => o[0] === 'upsert');
  assert.equal(opts.onConflict, 'user_id,dedupe_key');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.user_id === 'user-a' && r.run_id === 'run-1' && r.industry === 'Dental practices' && !('status' in r) && !('first_seen_at' in r)));
  assert.equal(rows.find((r) => r.map_key === 'no-shows').evidence_verified, 1);

  // Every read is scoped to the session's user, and the known list to this industry.
  for (const c of db.calls.filter((c) => has(c, 'select') && !has(c, 'insert'))) {
    assert.ok(c.ops.some((o) => o[0] === 'eq' && o[1] === 'user_id' && o[2] === 'user-a'), `${c.table} read not scoped`);
  }
  const knownCall = db.calls.find((c) => c.table === 'industry_problems' && has(c, 'limit'));
  assert.ok(knownCall.ops.some((o) => o[0] === 'eq' && o[1] === 'industry_key' && o[2] === 'dental-practices'));

  const insert = arg(db.calls.find((c) => c.table === 'industry_runs' && has(c, 'insert')), 'insert');
  assert.deepEqual({ industry: insert.industry, key: insert.industry_key, focus: insert.focus, user: insert.user_id }, { industry: 'Dental practices', key: 'dental-practices', focus: 'independent offices', user: 'user-a' });

  const patch = arg(db.calls.filter((c) => c.table === 'industry_runs' && has(c, 'update')).at(-1), 'update');
  assert.equal(patch.status, 'complete');
  assert.equal(patch.found, 2);
  assert.equal(patch.added, 1);
  assert.equal(patch.searches, 5);
  assert.equal(patch.summary.headline, 'Scheduling gaps');
  assert.equal(patch.summary.where_to_start, 'Validate reminders');
  const step = patch.summary.map.stages[0].steps;
  assert.equal(step[0].problem_key, 'no-shows');
  assert.equal(step[1].problem_key, null, 'a map link to a problem that was not saved is dropped');
  const done = events.find((e) => e.type === 'done');
  assert.deepEqual({ found: done.found, added: done.added, updated: done.updated }, { found: 2, added: 1, updated: 1 });
});

test('a run needs an industry, a builder description and a signed-in user, and writes nothing otherwise', async () => {
  const missing = [];
  await runIndustryCore({ userId: 'user-a', industry: '   ' }, (e) => missing.push(e), { client: runDb(), now: NOW });
  assert.match(missing.at(-1).message, /Enter an industry/);

  const db = runDb({ config: { solution_types: ['automation'] } });
  const events = [];
  await runIndustryCore({ userId: 'user-a', industry: 'HVAC', today: TODAY }, (e) => events.push(e), { client: db, now: NOW });
  assert.match(events.at(-1).message, /what you can build/);
  assert.ok(!db.calls.some((c) => has(c, 'insert')));

  const anon = [];
  await runIndustryCore({ industry: 'HVAC' }, (e) => anon.push(e), { client: fakeDb() });
  assert.deepEqual(anon, [{ type: 'error', message: 'Not authenticated' }]);
});

test('a run retires stale runs and refuses to start while another is in progress', async () => {
  const db = runDb({ active: [{ id: 'busy' }] });
  const events = [];
  let researched = false;
  await runIndustryCore({ userId: 'user-a', industry: 'HVAC', today: TODAY }, (e) => events.push(e), {
    client: db,
    research: async () => {
      researched = true;
    },
    now: NOW,
  });
  assert.equal(researched, false);
  assert.match(events.at(-1).message, /already in progress/);
  const stale = db.calls[0];
  assert.equal(stale.table, 'industry_runs');
  assert.equal(arg(stale, 'update').status, 'error');
  assert.ok(stale.ops.some((o) => o[0] === 'lt' && o[1] === 'run_at' && o[2] === '2026-10-05T11:40:00.000Z'));
});

test('a failed research step marks the run as an error', async () => {
  const db = runDb();
  const events = [];
  await runIndustryCore({ userId: 'user-a', industry: 'HVAC', today: TODAY }, (e) => events.push(e), {
    client: db,
    research: async () => {
      throw new Error('Anthropic rate limit reached');
    },
    now: NOW,
  });
  assert.equal(events.at(-1).message, 'Anthropic rate limit reached');
  const patch = arg(db.calls.filter((c) => c.table === 'industry_runs' && has(c, 'update')).at(-1), 'update');
  assert.equal(patch.status, 'error');
  assert.equal(patch.error, 'Anthropic rate limit reached');
  assert.ok(!db.calls.some((c) => c.table === 'industry_problems' && has(c, 'upsert')));
});
