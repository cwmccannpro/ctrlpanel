import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayKey, formatDue, parseCapture, rankItems, scoreMatch, PAGES } from '../src/lib/commandPalette.js';

// Thursday 1 Oct 2026, local time.
const NOW = new Date(2026, 9, 1, 9, 30);

test('dayKey uses local calendar days', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('capture pulls priority and due date out of the title', () => {
  const r = parseCapture('Call dentist @fri !high', NOW);
  assert.deepEqual(r, { title: 'Call dentist', priority: 'High', due: '2026-10-02' });
});

test('capture tokens can sit anywhere in the line', () => {
  const r = parseCapture('!urgent Renew passport @tomorrow now', NOW);
  assert.deepEqual(r, { title: 'Renew passport now', priority: 'Urgent', due: '2026-10-02' });
});

test('a weekday means the next one, never today', () => {
  assert.equal(parseCapture('x @thu', NOW).due, '2026-10-08');
  assert.equal(parseCapture('x @mon', NOW).due, '2026-10-05');
});

test('relative offsets, numeric dates and ISO dates', () => {
  assert.equal(parseCapture('x @3d', NOW).due, '2026-10-04');
  assert.equal(parseCapture('x @+2w', NOW).due, '2026-10-15');
  assert.equal(parseCapture('x @12/25', NOW).due, '2026-12-25');
  assert.equal(parseCapture('x @2027-03-09', NOW).due, '2027-03-09');
});

test('a month/day that already passed rolls to next year', () => {
  assert.equal(parseCapture('x @1/15', NOW).due, '2027-01-15');
});

test('invalid dates and unknown tokens stay in the title', () => {
  const r = parseCapture('Pay rent @2026-02-31 !whenever', NOW);
  assert.equal(r.due, null);
  assert.equal(r.priority, null);
  assert.equal(r.title, 'Pay rent @2026-02-31 !whenever');
});

test('tokens glued to other text are not captures', () => {
  const r = parseCapture('Email bob@fri.com about 50%!high', NOW);
  assert.equal(r.due, null);
  assert.equal(r.priority, null);
  assert.equal(r.title, 'Email bob@fri.com about 50%!high');
});

test('a capture that is only tokens has an empty title', () => {
  assert.equal(parseCapture('@fri !low', NOW).title, '');
});

test('formatDue reads the key as a local day, whatever the timezone', () => {
  assert.equal(formatDue('2026-10-01', NOW), 'Today');
  assert.equal(formatDue('2026-10-02', NOW), 'Tomorrow');
  assert.equal(formatDue('2026-09-30', NOW), 'Yesterday');
  assert.equal(formatDue('2026-10-09', NOW), 'Fri, Oct 9');
  assert.equal(formatDue('', NOW), '');
  assert.equal(formatDue('nonsense', NOW), '');
});

test('scoreMatch orders exact > prefix > word start > inside > loose', () => {
  const exact = scoreMatch('budget', 'Budget');
  const prefix = scoreMatch('bud', 'Budget');
  const word = scoreMatch('worth', 'Net Worth');
  const inside = scoreMatch('dge', 'Budget');
  const loose = scoreMatch('ntwrth', 'Net Worth');
  assert.ok(exact > prefix && prefix > word && word > inside && inside > loose && loose > 0);
  assert.equal(scoreMatch('zzz', 'Budget'), 0);
});

test('every term must match', () => {
  assert.ok(scoreMatch('net wor', 'Net Worth') > 0);
  assert.equal(scoreMatch('net budget', 'Net Worth'), 0);
});

test('rankItems sorts by score, falls back to keywords, keeps order on ties', () => {
  const ranked = rankItems(PAGES, 'portfolio').map((r) => r.item.label);
  assert.deepEqual(ranked, ['Investing']);
  const hab = rankItems(PAGES, 'hab').map((r) => r.item.label);
  assert.equal(hab[0], 'Habits');
  assert.equal(rankItems(PAGES, '').length, PAGES.length);
  assert.equal(rankItems(PAGES, 'qqqq').length, 0);
});

test('fuzzy subsequence matching applies to labels, not keyword text', () => {
  const items = [{ label: 'Opportunities Agent', keywords: 'Finds jobs within reach of home' }];
  assert.equal(rankItems(items, 'read').length, 0);
  assert.equal(rankItems([{ label: 'Net Worth' }], 'ntwrth').length, 1);
});

import { doneColumn, taskRowFromCapture } from '../src/lib/commandPalette.js';

test("captured tasks land in the board's first column with sensible defaults", () => {
  const board = { id: 'b1', columns: ['Inbox', 'Doing', 'Done'] };
  assert.deepEqual(taskRowFromCapture({ title: 'x', priority: null, due: null }, board), {
    title: 'x', board_id: 'b1', column_name: 'Inbox', priority: 'Medium', due_date: null,
  });
  // The Today panel passes today as the default due date; an explicit @date wins.
  assert.equal(taskRowFromCapture({ title: 'x', priority: 'High', due: null }, board, '2026-10-01').due_date, '2026-10-01');
  assert.equal(taskRowFromCapture({ title: 'x', priority: null, due: '2026-10-09' }, board, '2026-10-01').due_date, '2026-10-09');
  assert.equal(taskRowFromCapture({ title: 'x', priority: null, due: null }, null).board_id, null);
  assert.equal(taskRowFromCapture({ title: 'x', priority: null, due: null }, null).column_name, 'Backlog');
});

test('doneColumn prefers a column named Done, else the last one', () => {
  assert.equal(doneColumn({ columns: ['Inbox', 'done', 'Archive'] }), 'done');
  assert.equal(doneColumn({ columns: ['Todo', 'Shipped'] }), 'Shipped');
  assert.equal(doneColumn({ columns: [] }), 'Done');
  assert.equal(doneColumn(null), 'Done');
});
