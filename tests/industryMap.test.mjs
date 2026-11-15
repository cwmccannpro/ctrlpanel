import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap, mapProblemKeys, buildTree, layoutTree, wrapLabel, mapToMarkdown, MAX_STAGES, MAX_STEPS } from '../src/lib/industryMap.js';

const RAW = {
  stages: [
    {
      name: 'Getting patients',
      summary: 'Marketing and booking',
      steps: [
        { name: 'Online booking', pain: 'Patients no-show and the chair sits empty', problem_key: 'no-shows' },
        { name: 'Referrals', pain: null, problem_key: 'ignored-without-pain' },
      ],
    },
    {
      name: 'Getting paid',
      summary: '',
      steps: [
        { name: 'Insurance claims', pain: 'Claims bounce for missing codes', problem_key: 'ghost' },
        { name: 'Patient statements', pain: 'Chasing balances by hand', problem_key: 'collections' },
      ],
    },
    { name: '', steps: [{ name: 'dropped: no stage name' }] },
    { name: 'Empty stage', steps: [{ name: '   ' }] },
  ],
};

test('normalizeMap drops empty stages/steps and nulls keys that point at nothing', () => {
  const map = normalizeMap(RAW, ['no-shows', 'collections']);
  assert.deepEqual(map.stages.map((s) => s.name), ['Getting patients', 'Getting paid']);
  const [booking, referrals] = map.stages[0].steps;
  assert.equal(booking.problem_key, 'no-shows');
  assert.equal(referrals.problem_key, null, 'a step without a pain cannot link to a problem');
  const [claims, statements] = map.stages[1].steps;
  assert.equal(claims.problem_key, null, 'unknown key is removed');
  assert.equal(claims.pain, 'Claims bounce for missing codes', 'the pain text itself is kept');
  assert.equal(statements.problem_key, 'collections');
  assert.deepEqual(mapProblemKeys(map), ['no-shows', 'collections']);
});

test('normalizeMap bounds the size and survives garbage', () => {
  const big = {
    stages: Array.from({ length: 20 }, (_, i) => ({
      name: `Stage ${i}`,
      steps: Array.from({ length: 20 }, (_, j) => ({ name: `Step ${j}`, pain: null })),
    })),
  };
  const map = normalizeMap(big);
  assert.equal(map.stages.length, MAX_STAGES);
  assert.ok(map.stages.every((s) => s.steps.length === MAX_STEPS));
  assert.deepEqual(normalizeMap(null), { stages: [] });
  assert.deepEqual(normalizeMap({ stages: 'nope' }), { stages: [] });
  assert.equal(normalizeMap({ stages: [{ name: 'x'.repeat(500), steps: [{ name: 's' }] }] }).stages[0].name.length, 80);
});

test('buildTree nests industry → stage → step → pain with stable ids', () => {
  const tree = buildTree('Dental practices', normalizeMap(RAW, ['no-shows']));
  assert.equal(tree.label, 'Dental practices');
  assert.deepEqual(tree.children.map((c) => c.id), ['s0', 's1']);
  const booking = tree.children[0].children[0];
  assert.equal(booking.id, 's0-0');
  assert.equal(booking.hot, true);
  assert.deepEqual(booking.children.map((c) => [c.id, c.kind, c.problemKey]), [['s0-0-p', 'pain', 'no-shows']]);
  assert.equal(tree.children[0].children[1].children.length, 0);
});

test('wrapLabel wraps on words, splits long tokens and ellipsizes overflow', () => {
  assert.deepEqual(wrapLabel('Online booking and reminders', 14, 3), ['Online booking', 'and reminders']);
  assert.deepEqual(wrapLabel('', 10, 2), ['']);
  assert.deepEqual(wrapLabel('Supercalifragilistic', 8, 3), ['Supercal', 'ifragili', 'stic']);
  const clipped = wrapLabel('one two three four five six seven eight nine ten', 10, 2);
  assert.equal(clipped.length, 2);
  assert.ok(clipped[1].endsWith('…'));
  assert.ok(clipped.every((l) => l.length <= 10));
});

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('layout places every node without overlaps and centres parents on their children', () => {
  const tree = buildTree('Dental practices', normalizeMap(RAW, ['no-shows', 'collections']));
  const { nodes, links, width, height } = layoutTree(tree);
  assert.equal(nodes.length, 1 + 2 + 4 + 3); // root, stages, steps, pains
  assert.equal(links.length, nodes.length - 1);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.equal(overlaps(nodes[i], nodes[j]), false, `${nodes[i].id} overlaps ${nodes[j].id}`);
  for (const n of nodes) {
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= width && n.y + n.h <= height, `${n.id} outside the canvas`);
  }
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const stage = byId.s1;
  const kids = [byId['s1-0'], byId['s1-1']];
  const mid = (kids[0].y + kids[0].h / 2 + kids[1].y + kids[1].h / 2) / 2;
  assert.ok(Math.abs(stage.y + stage.h / 2 - mid) < 0.001, 'stage is centred on its steps');
  assert.ok(byId.root.x < byId.s0.x && byId.s0.x < byId['s0-0'].x && byId['s0-0'].x < byId['s0-0-p'].x, 'depth runs left to right');
  assert.ok(links.every((l) => /^M[\d.]+ [\d.]+ C/.test(l.d)));
});

test('a tall parent over a single short child never overlaps the row above', () => {
  const map = { stages: [{ name: 'First stage with a long enough name to wrap over lines', summary: '', steps: [{ name: 'A', pain: null, problem_key: null }] }, { name: 'B', summary: '', steps: [{ name: 'C', pain: null, problem_key: null }] }] };
  const { nodes } = layoutTree(buildTree('I', map));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.equal(overlaps(nodes[i], nodes[j]), false);
  assert.ok(nodes.every((n) => n.y >= 0));
});

test('collapsing a stage hides its descendants and flags the stage', () => {
  const tree = buildTree('Dental practices', normalizeMap(RAW, ['no-shows', 'collections']));
  const open = layoutTree(tree);
  const folded = layoutTree(tree, { collapsed: new Set(['s0']) });
  const ids = folded.nodes.map((n) => n.id);
  assert.ok(!ids.includes('s0-0') && !ids.includes('s0-0-p'));
  assert.ok(ids.includes('s1-0'));
  const s0 = folded.nodes.find((n) => n.id === 's0');
  assert.equal(s0.collapsed, true);
  assert.equal(s0.hasChildren, true);
  assert.ok(folded.height < open.height);
  assert.equal(folded.links.length, folded.nodes.length - 1);
});

test('mapToMarkdown is a nested list Markmap can render, with pains marked', () => {
  const md = mapToMarkdown('Dental practices', normalizeMap(RAW));
  assert.equal(
    md,
    [
      '# Dental practices',
      '',
      '## Getting patients',
      '- Online booking',
      '  - ⚠ Patients no-show and the chair sits empty',
      '- Referrals',
      '',
      '## Getting paid',
      '- Insurance claims',
      '  - ⚠ Claims bounce for missing codes',
      '- Patient statements',
      '  - ⚠ Chasing balances by hand',
      '',
    ].join('\n')
  );
});
