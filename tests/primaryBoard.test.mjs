import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryBoard } from '../src/lib/boards.js';

const a = { id: 'a', created_at: '2026-07-10' };
const b = { id: 'b', created_at: '2026-07-13' };
const c = { id: 'c', created_at: '2026-10-08' };

test('no boards → null, one board → that board', () => {
  assert.equal(primaryBoard([]), null);
  assert.equal(primaryBoard([a]), a);
});

test('the board projects link to wins', () => {
  const projects = [{ todo_board_id: 'c' }, { todo_board_id: 'c' }, { todo_board_id: null }];
  const tasks = [1, 2, 3, 4].map((i) => ({ id: i, board_id: 'a', column_name: 'To do' }));
  assert.equal(primaryBoard([a, b, c], { tasks, projects }), c);
});

test('then most open tasks (Done ignored), then newest', () => {
  const tasks = [
    { board_id: 'a', column_name: 'To do' },
    { board_id: 'b', column_name: 'Done' },
    { board_id: 'b', column_name: 'Done' },
  ];
  assert.equal(primaryBoard([a, b, c], { tasks }), a);
  assert.equal(primaryBoard([a, b, c]), c);
});

test('unsaved tmp- boards are skipped', () => {
  assert.equal(primaryBoard([{ id: 'tmp-1', created_at: '2027' }, a]), a);
});
