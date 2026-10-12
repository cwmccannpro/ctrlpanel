import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quickTaskRow, saveQuickTask } from '../src/lib/taskQuickAdd.js';

const NOW = new Date(2026, 9, 10, 23, 30);
const board = { id: 'board-1', user_id: 'owner', name: 'Work', columns: ['Inbox', 'Doing', 'Waiting', 'Finished'] };

test('quick tasks land in each selected custom category and never supply ownership', () => {
  for (const column of board.columns) {
    const row = quickTaskRow('  Call dentist  ', board, column, NOW);
    assert.deepEqual(row, { title: 'Call dentist', board_id: board.id, column_name: column, priority: 'Medium', due_date: null });
    assert.equal('user_id' in row, false);
  }
});

test('category quick add understands priority and local-day date shortcuts', () => {
  const row = quickTaskRow('Send brief @tomorrow !urgent', board, 'Waiting', NOW);
  assert.equal(row.title, 'Send brief');
  assert.equal(row.due_date, '2026-10-11');
  assert.equal(row.priority, 'Urgent');
  assert.equal(row.column_name, 'Waiting');
});

test('boards with default columns can capture directly into Review or Done', () => {
  assert.equal(quickTaskRow('Review proposal', { id: 'board-2' }, 'Review', NOW).column_name, 'Review');
  assert.equal(quickTaskRow('Already finished', { id: 'board-2', columns: [] }, 'Done', NOW).column_name, 'Done');
});

test('missing/unsaved boards, removed categories and token-only titles cannot create tasks', async () => {
  let writes = 0;
  const insert = async () => { writes++; return { data: [{ id: 'task' }] }; };
  await assert.rejects(saveQuickTask('Task', null, 'Inbox', insert), /saved board/);
  await assert.rejects(saveQuickTask('Task', { ...board, id: 'tmp-1' }, 'Inbox', insert), /saved board/);
  await assert.rejects(saveQuickTask('Task', board, 'Removed category', insert), /category has changed/);
  await assert.rejects(saveQuickTask('@tomorrow !high', board, 'Inbox', insert), /task name/);
  assert.equal(writes, 0);
});

test('a successful save returns the actual persisted row', async () => {
  const task = await saveQuickTask('Email buyer !high', board, 'Doing', async (table, rows) => {
    assert.equal(table, 'tasks');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].column_name, 'Doing');
    assert.equal('user_id' in rows[0], false);
    return { data: [{ ...rows[0], id: 'saved-task', user_id: 'owner' }], error: null };
  }, NOW);
  assert.equal(task.id, 'saved-task');
  assert.equal(task.priority, 'High');
});

test('rejected and empty database responses report failure', async () => {
  await assert.rejects(saveQuickTask('Task', board, 'Inbox', async () => ({ data: null, error: { message: 'Access denied' } })), /Access denied/);
  await assert.rejects(saveQuickTask('Task', board, 'Inbox', async () => ({ data: [], error: null })), /wasn’t saved/);
  await assert.rejects(saveQuickTask('Task', board, 'Inbox', async () => { throw new Error('Offline'); }), /Offline/);
});
