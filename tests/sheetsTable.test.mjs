import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cellLink, distinctValues, filterRows, sortRows, withAppended, withCell, withoutRows,
} from '../src/lib/sheetsTable.js';
import {
  clearSheetCache, getAccess, getCachedMeta, getCachedSheet, setAccess, setCachedMeta, setCachedSheet,
} from '../src/lib/sheetsCache.js';

const rows = [
  { row: 2, cells: ['Ada', 'Lead', '$1,200.50', '03/04/2026'] },
  { row: 3, cells: ['bob', 'Customer', '$900', '12/31/2025'] },
  { row: 4, cells: ['Cy', '', '(50)', ''] },
  { row: 5, cells: ['Dee', 'Lead', '45%', '2026-01-15'] },
  { row: 6, cells: ['Eve', 'Customer', '1,000', 'Dec 1, 2026'] },
];
const names = (list) => list.map((r) => r.cells[0]);

test('search matches any cell, case-insensitively; filters are exact per column', () => {
  assert.deepEqual(names(filterRows(rows, 'LEAD')), ['Ada', 'Dee']);
  assert.deepEqual(names(filterRows(rows, '', { 1: 'Lead' })), ['Ada', 'Dee']);
  assert.deepEqual(names(filterRows(rows, 'ada', { 1: 'Lead' })), ['Ada']);
  assert.deepEqual(names(filterRows(rows, '', { 1: '' })), ['Cy']); // "(Empty)" filter
  assert.equal(filterRows(rows, '', { 9: 'x' }).length, 0);
  assert.equal(filterRows(rows).length, rows.length);
});

test('sorting reads currency, parentheses, percents and thousands separators as numbers', () => {
  // -50, 45, 900, 1000, 1200.50 — as strings these would sort "$1,200.50" < "$900".
  assert.deepEqual(names(sortRows(rows, 2)), ['Cy', 'Dee', 'bob', 'Eve', 'Ada']);
  assert.deepEqual(names(sortRows(rows, 2, 'desc')), ['Ada', 'Eve', 'bob', 'Dee', 'Cy']);
});

test('sorting reads dates in several formats and keeps blanks last in both directions', () => {
  assert.deepEqual(names(sortRows(rows, 3)), ['bob', 'Dee', 'Ada', 'Eve', 'Cy']);
  assert.deepEqual(names(sortRows(rows, 3, 'desc')), ['Eve', 'Ada', 'Dee', 'bob', 'Cy']);
});

test('text sorts case-insensitively and numerically, stably', () => {
  assert.deepEqual(names(sortRows(rows, 0)), ['Ada', 'bob', 'Cy', 'Dee', 'Eve']);
  const tied = [{ row: 2, cells: ['x', 'a'] }, { row: 3, cells: ['y', 'a'] }, { row: 4, cells: ['z', 'a'] }];
  assert.deepEqual(names(sortRows(tied, 1, 'desc')), ['x', 'y', 'z']);
  const nums = ['item 10', 'item 9', 'item 100'].map((c, i) => ({ row: i + 2, cells: [c] }));
  assert.deepEqual(sortRows(nums, 0).map((r) => r.cells[0]), ['item 9', 'item 10', 'item 100']);
  assert.equal(sortRows(rows, null), rows);
});

test('plain small numbers are numbers, not dates', () => {
  const r = ['12', '3', '100'].map((c, i) => ({ row: i + 2, cells: [c] }));
  assert.deepEqual(sortRows(r, 0).map((x) => x.cells[0]), ['3', '12', '100']);
});

test('distinct values are sorted and include the empty one', () => {
  assert.deepEqual(distinctValues(rows, 1), ['', 'Customer', 'Lead']);
});

test('links: web, email and phone are clickable; ordinary text is not', () => {
  assert.deepEqual(cellLink('https://example.com/a?b=1'), { href: 'https://example.com/a?b=1', kind: 'url' });
  assert.deepEqual(cellLink('ada@example.com'), { href: 'mailto:ada@example.com', kind: 'email' });
  assert.deepEqual(cellLink('+1 (555) 123-4567'), { href: 'tel:+15551234567', kind: 'phone' });
  assert.equal(cellLink('555'), null);
  assert.equal(cellLink('call ada@example.com tomorrow'), null);
  assert.equal(cellLink('javascript:alert(1)'), null);
  assert.equal(cellLink('ftp://x.y'), null);
  assert.equal(cellLink(''), null);
  assert.equal(cellLink('2026-10-02'), null);
  assert.equal(cellLink('12/31/2026'), null);
  assert.equal(cellLink('3.14.2026'), null);
});

test('optimistic edits: set a cell, append, and delete with row renumbering', () => {
  assert.equal(withCell(rows, 3, 1, 'Partner').find((r) => r.row === 3).cells[1], 'Partner');
  assert.equal(rows[1].cells[1], 'Customer', 'the original is untouched');

  // Deleting sheet rows 3 and 5 shifts the rows below them up, exactly as Sheets does.
  const after = withoutRows(rows, [3, 5, 3]);
  assert.deepEqual(after.map((r) => [r.cells[0], r.row]), [['Ada', 2], ['Cy', 3], ['Eve', 4]]);

  assert.equal(withAppended(rows, ['Zed'], 12).at(-1).row, 12);
  assert.equal(withAppended(rows, ['Zed']).at(-1).row, 7);
  assert.equal(withAppended([], ['Zed']).at(-1).row, 2);
});

test('the read cache is per spreadsheet + tab, and forgets a spreadsheet on demand', () => {
  setCachedSheet('s1', 'Contacts', { headers: ['A'], rows: [] });
  setCachedSheet('s1', 'Notes', { headers: ['B'], rows: [] });
  setCachedSheet('s2', 'Contacts', { headers: ['C'], rows: [] });
  setCachedMeta('s1', { title: 'One' });
  setAccess('s1', 'view');
  assert.equal(getCachedSheet('s1', 'Notes').headers[0], 'B');
  assert.equal(getAccess('s1'), 'view');
  assert.equal(getAccess('nope'), 'unknown');

  clearSheetCache('s1');
  assert.equal(getCachedSheet('s1', 'Contacts'), null);
  assert.equal(getCachedSheet('s1', 'Notes'), null);
  assert.equal(getCachedMeta('s1'), null);
  assert.equal(getAccess('s1'), 'unknown');
  assert.equal(getCachedSheet('s2', 'Contacts').headers[0], 'C', 'other spreadsheets are untouched');
});

import { rowSignature, staleSelection } from '../src/lib/sheetsTable.js';

test('a selection is stale when the live sheet no longer has that content at that row', () => {
  const selection = new Map([[3, rowSignature(rows[1].cells)], [5, rowSignature(rows[3].cells)]]);
  assert.deepEqual(staleSelection(rows, selection), []);

  // Someone inserted a row above in Sheets: everything below moves down one.
  const shifted = rows.map((r) => (r.row >= 3 ? { ...r, row: r.row + 1 } : r));
  assert.deepEqual(staleSelection(shifted, selection), [3, 5]);

  // Same row number, edited content.
  const edited = withCell(rows, 3, 0, 'Robert');
  assert.deepEqual(staleSelection(edited, selection), [3]);

  // A selected row that no longer exists at all (row 3 still matches; row 5 is gone).
  assert.deepEqual(staleSelection(rows.slice(0, 2), selection), [5]);
});
