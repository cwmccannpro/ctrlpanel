import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_COL_W, DIVIDER_W, END_PAD, LAYOUT_VERSION, MAX_COLS, MAX_COL_W, MIN_COL_W,
  addColumn, clampWidth, moveColumn, normalizeWidths, overflowInfo, panPosition,
  removeColumn, scrollStep, serializeLayout, setColumnWidth, widthsFromPercent,
} from '../src/lib/dashboardLayout.js';

const item = (id) => ({ uid: `${id}-u`, id, cfg: {}, h: null });
const cols = () => [[item('a'), item('b')], [item('c')], [item('d')]];

test('widths are clamped to a usable range and bad values fall back to the default', () => {
  assert.equal(clampWidth(100), MIN_COL_W);
  assert.equal(clampWidth(5000), MAX_COL_W);
  assert.equal(clampWidth(412.4), 412);
  for (const bad of [undefined, null, 'x', NaN, 0, -50]) assert.equal(clampWidth(bad), DEFAULT_COL_W, String(bad));
});

test('one width per column: padded, trimmed and clamped', () => {
  assert.deepEqual(normalizeWidths([400], 3), [400, DEFAULT_COL_W, DEFAULT_COL_W]);
  assert.deepEqual(normalizeWidths([400, 500, 600, 700], 2), [400, 500]);
  assert.deepEqual(normalizeWidths(undefined, 2), [DEFAULT_COL_W, DEFAULT_COL_W]);
  assert.deepEqual(normalizeWidths([50, 2000], 2), [MIN_COL_W, MAX_COL_W]);
});

test('the old percentage layout migrates to pixels using the container width', () => {
  // 34% / 33% / remaining 33% of what is left of a 1200px canvas after 2 dividers (32px) and the end pad (6px)
  const w = widthsFromPercent([34, 33], 3, 1200);
  assert.deepEqual(w, [395, 383, 383]);
  // the migrated columns plus their dividers fit the canvas exactly — no stray scrollbar
  assert.ok(w.reduce((a, b) => a + b, 0) + 2 * DIVIDER_W + END_PAD <= 1200);
  // a narrow container never produces unusably thin columns
  assert.deepEqual(widthsFromPercent([34, 33], 3, 600), [MIN_COL_W, MIN_COL_W, MIN_COL_W]);
  // missing / garbage data falls back to equal thirds
  assert.deepEqual(widthsFromPercent(undefined, 3, 900), [287, 287, 287]); // equal thirds of the 862px left after dividers
  assert.deepEqual(widthsFromPercent(['x', null], 3, 900), widthsFromPercent(undefined, 3, 900));
  // no measurable container: the saved proportions over a default-sized base
  assert.deepEqual(widthsFromPercent([34, 33], 3, 0), [286, 277, 277]);
});

test('adding a column appends an empty one, up to the limit', () => {
  const r = addColumn(cols(), [300, 320, 340]);
  assert.equal(r.columns.length, 4);
  assert.deepEqual(r.columns[3], []);
  assert.deepEqual(r.widths, [300, 320, 340, DEFAULT_COL_W]);
  assert.equal(addColumn(r.columns, r.widths, 500).widths[4], 500);

  let state = { columns: [[]], widths: [DEFAULT_COL_W] };
  for (let i = 0; i < MAX_COLS + 5; i++) state = addColumn(state.columns, state.widths);
  assert.equal(state.columns.length, MAX_COLS);
  assert.equal(state.widths.length, MAX_COLS);
});

test('removing a column keeps its panels: they join the previous column (or the next, for the first)', () => {
  const mid = removeColumn(cols(), [300, 320, 340], 1);
  assert.deepEqual(mid.columns.map((c) => c.map((i) => i.id)), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(mid.widths, [300, 340]);

  const first = removeColumn(cols(), [300, 320, 340], 0);
  assert.deepEqual(first.columns.map((c) => c.map((i) => i.id)), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(first.widths, [320, 340]);

  const last = removeColumn(cols(), [300, 320, 340], 2);
  assert.deepEqual(last.columns.map((c) => c.map((i) => i.id)), [['a', 'b'], ['c', 'd']]);
});

test('the last column can never be removed, and bad indexes change nothing', () => {
  const one = { columns: [[item('a')]], widths: [320] };
  assert.deepEqual(removeColumn(one.columns, one.widths, 0), one);
  assert.equal(removeColumn(cols(), [300, 320, 340], 9).columns.length, 3);
  assert.equal(removeColumn(cols(), [300, 320, 340], -1).columns.length, 3);
});

test('removing and adding never lose or duplicate a panel', () => {
  const all = (columns) => columns.flat().map((i) => i.id).sort().join(',');
  let s = { columns: cols(), widths: [300, 320, 340] };
  s = addColumn(s.columns, s.widths);
  s = removeColumn(s.columns, s.widths, 1);
  s = moveColumn(s.columns, s.widths, 0, 1);
  s = removeColumn(s.columns, s.widths, 0);
  assert.equal(all(s.columns), 'a,b,c,d');
});

test('moving a column carries its width; edges are no-ops', () => {
  const r = moveColumn(cols(), [300, 320, 340], 0, 1);
  assert.deepEqual(r.columns.map((c) => c.map((i) => i.id)), [['c'], ['a', 'b'], ['d']]);
  assert.deepEqual(r.widths, [320, 300, 340]);
  assert.deepEqual(moveColumn(cols(), [300, 320, 340], 0, -1).widths, [300, 320, 340]);
  assert.deepEqual(moveColumn(cols(), [300, 320, 340], 2, 1).widths, [300, 320, 340]);
});

test('resizing one column leaves the others alone', () => {
  assert.deepEqual(setColumnWidth([300, 320, 340], 1, 450), [300, 450, 340]);
  assert.deepEqual(setColumnWidth([300, 320, 340], 1, 10), [300, MIN_COL_W, 340]);
  // dragging a divider past the left edge gives a negative width: pin to the minimum, not the default
  assert.deepEqual(setColumnWidth([300, 320, 340], 0, -180), [MIN_COL_W, 320, 340]);
  assert.deepEqual(setColumnWidth([300, 320, 340], 0, 0), [MIN_COL_W, 320, 340]);
  assert.deepEqual(setColumnWidth([300, 320, 340], 2, 99999), [300, 320, MAX_COL_W]);
  assert.deepEqual(setColumnWidth([300, 320, 340], 1, NaN), [300, 320, 340], 'garbage leaves it unchanged');
});

test('the saved payload is v7 with exactly the fields that matter', () => {
  const noisy = [[{ uid: 'x', id: 'a', cfg: { days: 7 }, h: 200, extra: 'dropped', Component: () => null }]];
  const out = serializeLayout(noisy, [400, 500]);
  assert.equal(out.v, LAYOUT_VERSION);
  assert.deepEqual(out.widths, [400], 'trimmed to the column count');
  assert.deepEqual(out.columns, [[{ uid: 'x', id: 'a', cfg: { days: 7 }, h: 200 }]]);
  assert.doesNotThrow(() => JSON.stringify(out));
});

test('panning: the content follows the pointer in either direction', () => {
  assert.equal(panPosition(500, 300, 250), 550); // dragged left by 50 → view moves right
  assert.equal(panPosition(500, 300, 360), 440); // dragged right by 60 → view moves left
  assert.equal(panPosition(500, 300, 300), 500);
});

test('arrow buttons know when there is more canvas and step one column at a time', () => {
  assert.deepEqual(overflowInfo(0, 1000, 1000), { overflowing: false, canLeft: false, canRight: false });
  assert.deepEqual(overflowInfo(0, 1000, 2000), { overflowing: true, canLeft: false, canRight: true });
  assert.deepEqual(overflowInfo(500, 1000, 2000), { overflowing: true, canLeft: true, canRight: true });
  assert.deepEqual(overflowInfo(1000, 1000, 2000), { overflowing: true, canLeft: true, canRight: false });
  assert.deepEqual(overflowInfo(0, 1000, 1001), { overflowing: false, canLeft: false, canRight: false }, 'sub-pixel overflow is ignored');

  assert.equal(scrollStep(0, 1000, 2000, 1, 340), 340);
  assert.equal(scrollStep(900, 1000, 2000, 1, 340), 1000, 'clamped to the end');
  assert.equal(scrollStep(100, 1000, 2000, -1, 340), 0, 'clamped to the start');
  assert.equal(scrollStep(0, 1000, 800, 1, 340), 0, 'nothing to scroll');
});
