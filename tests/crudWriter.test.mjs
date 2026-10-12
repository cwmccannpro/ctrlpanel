import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { createCrudWriter, isTempId } from '../src/lib/crudWriter.js';
import { failureMessage, tableLabel } from '../src/lib/writeStatus.js';

console.warn = () => {}; // the writer logs failures; keep test output readable

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const ok = (data) => ({ data, error: null });
const rejected = (message = 'row violates row-level security policy') => ({ data: null, error: { message } });

let rows, api, calls, failures, reloads, writer;
const setRows = (updater) => { rows = updater(rows); };
const make = () => createCrudWriter({
  table: 'tasks', api, setRows, onFailure: (f) => failures.push(f), reload: () => { reloads += 1; },
});

beforeEach(() => {
  rows = [{ id: 'a', title: 'First', done: false }, { id: 'b', title: 'Second', done: false }, { id: 'c', title: 'Third', done: false }];
  calls = []; failures = []; reloads = 0;
  api = {
    insert: async (table, input) => { calls.push(['insert', input]); return ok([{ ...input[0], id: 'real-1', user_id: 'me' }]); },
    update: async (table, id, changes) => { calls.push(['update', id, changes]); return ok([{ id, ...changes }]); },
    remove: async (table, id) => { calls.push(['remove', id]); return ok(null); },
  };
  writer = make();
});

test('add shows the row at once, then swaps in the saved row', async () => {
  const pending = deferred();
  api.insert = async (t, input) => { await pending.promise; return ok([{ ...input[0], id: 'real-1' }]); };
  const added = writer.add({ title: 'New' });
  assert.equal(rows.length, 4);
  assert.ok(isTempId(rows[3].id), 'optimistic row carries a placeholder id');
  pending.resolve();
  assert.deepEqual(await added, { title: 'New', id: 'real-1' });
  assert.deepEqual(rows[3], { title: 'New', id: 'real-1' });
  assert.equal(failures.length, 0);
});

test('a rejected add leaves no phantom row, returns null, and offers a working retry', async () => {
  api.insert = async () => rejected();
  assert.equal(await writer.add({ title: 'Nope' }), null);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].key, 'tasks:add');
  assert.match(failures[0].message, /Couldn’t save that new item to tasks/);

  api.insert = async (t, input) => ok([{ ...input[0], id: 'real-2' }]);
  await failures[0].retry();
  assert.equal(rows.at(-1).id, 'real-2');
});

test('an insert that throws, or returns no row, is also a failed add', async () => {
  api.insert = async () => { throw new Error('Failed to fetch'); };
  assert.equal(await writer.add({ title: 'Offline' }), null);
  assert.equal(rows.length, 3);
  api.insert = async () => ok([]);
  assert.equal(await writer.add({ title: 'Blocked' }), null);
  assert.equal(rows.length, 3);
  assert.equal(failures.length, 2);
});

test('patch applies instantly and keeps the change when the save succeeds', async () => {
  const pending = deferred();
  api.update = async (t, id, changes) => { await pending.promise; return ok([{ id, ...changes }]); };
  const saving = writer.patch('b', { done: true });
  assert.equal(rows[1].done, true, 'shown before the database answers');
  pending.resolve();
  assert.equal((await saving).error, null);
  assert.equal(rows[1].done, true);
  assert.equal(failures.length, 0);
});

test('a rejected patch is rolled back, reported, and retryable', async () => {
  api.update = async () => rejected();
  const result = await writer.patch('b', { title: 'Changed', done: true });
  assert.ok(result.error);
  assert.deepEqual(rows[1], { id: 'b', title: 'Second', done: false });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].key, 'tasks:update');

  api.update = async (t, id, changes) => ok([{ id, ...changes }]);
  await failures[0].retry();
  assert.deepEqual(rows[1], { id: 'b', title: 'Changed', done: true });
});

test('a patch that matches no row (deleted elsewhere or not permitted) counts as failed and re-syncs', async () => {
  api.update = async () => ok([]);
  const result = await writer.patch('b', { done: true });
  assert.match(result.error.message, /no longer exists/);
  assert.equal(rows[1].done, false);
  assert.equal(reloads, 1);
  assert.equal(failures.length, 1);
});

test('rollback only undoes keys still holding the failed value, so a newer edit survives', async () => {
  const first = deferred();
  api.update = async (t, id, changes) => {
    if (changes.title === 'First edit') { await first.promise; return rejected(); }
    return ok([{ id, ...changes }]);
  };
  const a = writer.patch('a', { title: 'First edit', done: true });
  await writer.patch('a', { title: 'Second edit' });
  first.resolve();
  await a;
  assert.equal(rows[0].title, 'Second edit', 'the newer title stays');
  assert.equal(rows[0].done, false, 'the untouched failed key is undone');
});

test('editing a row whose insert is still saving waits for the real id', async () => {
  const pending = deferred();
  api.insert = async (t, input) => { calls.push(['insert', input]); await pending.promise; return ok([{ ...input[0], id: 'real-9' }]); };
  const added = writer.add({ title: 'Quick', column_name: 'Backlog' });
  const tempId = rows.at(-1).id;
  const moved = writer.patch(tempId, { column_name: 'Done' });
  assert.equal(rows.at(-1).column_name, 'Done', 'shown immediately');
  assert.equal(calls.filter((c) => c[0] === 'update').length, 0, 'nothing sent with a placeholder id');
  pending.resolve();
  await added;
  assert.equal((await moved).error, null);
  assert.deepEqual(calls.filter((c) => c[0] === 'update'), [['update', 'real-9', { column_name: 'Done' }]]);
  assert.deepEqual(rows.at(-1), { title: 'Quick', column_name: 'Done', id: 'real-9' });
});

test('a queued edit that the database rejects is rolled back onto the saved row', async () => {
  const pending = deferred();
  api.insert = async (t, input) => { await pending.promise; return ok([{ ...input[0], id: 'real-9' }]); };
  api.update = async () => rejected();
  const added = writer.add({ title: 'Quick', column_name: 'Backlog' });
  writer.patch(rows.at(-1).id, { column_name: 'Done' });
  pending.resolve();
  await added;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(rows.at(-1).column_name, 'Backlog');
  assert.equal(failures.filter((f) => f.key === 'tasks:update').length, 1);
});

test('editing a placeholder whose insert failed, or never existed, sends nothing', async () => {
  api.insert = async () => rejected();
  const added = writer.add({ title: 'Doomed' });
  const edited = writer.patch(rows.at(-1).id, { title: 'Still doomed' });
  assert.equal(await added, null);
  assert.ok((await edited).error);
  assert.equal(rows.length, 3);
  assert.ok((await writer.patch('tmp-unknown', { title: 'x' })).error);
  assert.equal(calls.filter((c) => c[0] === 'update').length, 0);
});

test('remove deletes, and a failed delete puts the row back where it was', async () => {
  await writer.remove('b');
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(calls.at(-1), ['remove', 'b']);

  rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  api.remove = async () => rejected();
  const result = await writer.remove('b');
  assert.ok(result.error);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(failures.at(-1).key, 'tasks:remove');
  assert.match(failures.at(-1).message, /Couldn’t delete that from tasks/);
});

test('deleting a row that is already gone is not an error', async () => {
  await writer.remove('missing');
  assert.equal(failures.length, 0);
  assert.equal(rows.length, 3);
});

test('deleting a row whose insert is still saving deletes the saved row once it exists', async () => {
  const pending = deferred();
  api.insert = async (t, input) => { await pending.promise; return ok([{ ...input[0], id: 'real-5' }]); };
  const added = writer.add({ title: 'Oops' });
  const removed = writer.remove(rows.at(-1).id);
  assert.equal(rows.length, 3, 'gone from the screen at once');
  pending.resolve();
  await added; await removed;
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c'], 'the saved row does not reappear');
  assert.deepEqual(calls.at(-1), ['remove', 'real-5']);
});

test('deleting a placeholder whose insert failed sends no delete', async () => {
  api.insert = async () => rejected();
  const added = writer.add({ title: 'Doomed' });
  const removed = writer.remove(rows.at(-1).id);
  await added; await removed;
  assert.equal(calls.filter((c) => c[0] === 'remove').length, 0);
  assert.equal(rows.length, 3);
});

test('mock mode (no Supabase) keeps changes local without reporting failures', async () => {
  const none = async () => ({ data: null, error: { message: 'supabase-not-configured' } });
  api = { insert: none, update: none, remove: none };
  writer = make();
  const added = await writer.add({ title: 'Local' });
  assert.ok(isTempId(added.id));
  assert.equal(rows.length, 4);
  await writer.patch('a', { title: 'Edited' });
  await writer.remove('b');
  assert.equal(rows.find((r) => r.id === 'a').title, 'Edited');
  assert.equal(rows.some((r) => r.id === 'b'), false);
  assert.equal(failures.length, 0);
});

test('failure messages name the table and say whether the network is the problem', () => {
  assert.equal(tableLabel('habit_logs'), 'habit logs');
  assert.equal(failureMessage('update', 'habit_logs', { message: 'x' }), 'Couldn’t save your change to habit logs. Please try again.');
  assert.match(failureMessage('add', 'tasks', { message: 'TypeError: Failed to fetch' }), /offline/);
  assert.match(failureMessage('load', 'tasks'), /^Couldn’t load tasks\./);
});
