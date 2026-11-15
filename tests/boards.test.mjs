import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allBoardsColumns, canDropInColumn, columnsOf } from '../src/lib/boards.js';

const DEFAULTS = ['Backlog', 'In Progress', 'Review', 'Done'];
const boards = [
  { id: 'b1', columns: ['Backlog', 'In Progress', 'Done'] },
  { id: 'b2', columns: ['Inbox', 'Doing', 'Done'] },
  { id: 'b3', columns: [] },
];

test('a board with no columns falls back to the defaults', () => {
  assert.deepEqual(columnsOf(boards[2], DEFAULTS), DEFAULTS);
  assert.deepEqual(columnsOf(null, DEFAULTS), DEFAULTS);
  assert.deepEqual(columnsOf(boards[1], DEFAULTS), ['Inbox', 'Doing', 'Done']);
});

test('All Boards shows the defaults plus every custom column, so no task is hidden', () => {
  const cols = allBoardsColumns(DEFAULTS, boards, [{ column_name: 'Waiting on' }, { column_name: 'Doing' }]);
  assert.deepEqual(cols, ['Backlog', 'In Progress', 'Review', 'Done', 'Inbox', 'Doing', 'Waiting on']);
  assert.deepEqual(allBoardsColumns(DEFAULTS, [], []), DEFAULTS);
  assert.equal(new Set(cols).size, cols.length, 'no duplicates');
});

test('a card can only be dropped in a column its own board has', () => {
  assert.equal(canDropInColumn({ board_id: 'b2' }, boards, DEFAULTS, 'Doing'), true);
  assert.equal(canDropInColumn({ board_id: 'b2' }, boards, DEFAULTS, 'Review'), false);
  assert.equal(canDropInColumn({ board_id: 'b3' }, boards, DEFAULTS, 'Review'), true, 'column-less boards use the defaults');
  assert.equal(canDropInColumn({ board_id: 'gone' }, boards, DEFAULTS, 'Backlog'), true, 'unknown board → defaults');
  assert.equal(canDropInColumn({ board_id: null }, boards, DEFAULTS, 'Inbox'), false);
});
