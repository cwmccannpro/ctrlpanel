import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clampDuration, dayLoad, durationLabel, edgesOnDay, findFreeSlot, sanitizeBlocks, snapToSlot, taskItems,
} from '../src/lib/taskBlocks.js';

const day = new Date(2026, 9, 6);
const at = (h, m = 0, d = 6) => new Date(2026, 9, d, h, m).toISOString();
const ev = (sh, sm, eh, em, extra = {}) => ({ id: `${sh}${sm}`, starts_at: at(sh, sm), ends_at: at(eh, em), ...extra });

test('snaps to the 15-minute grid and clamps to the visible window', () => {
  assert.equal(snapToSlot({ rawMin: 9 * 60 + 7, mins: 30 }).start, 9 * 60);
  assert.equal(snapToSlot({ rawMin: 9 * 60 + 8, mins: 30 }).start, 9 * 60 + 15);
  assert.equal(snapToSlot({ rawMin: 4 * 60, mins: 30 }).start, 6 * 60);
  assert.equal(snapToSlot({ rawMin: 23 * 60 + 50, mins: 60 }).start, 23 * 60); // must finish by midnight
});

test('magnets to the end of the previous event and the start of the next', () => {
  // Meeting 9:00–10:10: a 30m block dropped near 10:15 should start exactly at 10:10.
  const edges = [9 * 60, 10 * 60 + 10];
  assert.deepEqual(snapToSlot({ rawMin: 10 * 60 + 17, mins: 30, edges }), { start: 10 * 60 + 10, edge: 10 * 60 + 10 });
  // Meeting at 14:00: a 45m block dropped near 13:10 should end at 14:00 → start 13:15.
  assert.deepEqual(snapToSlot({ rawMin: 13 * 60 + 12, mins: 45, edges: [14 * 60] }), { start: 13 * 60 + 15, edge: 14 * 60 });
  // Far from any edge: plain grid.
  assert.equal(snapToSlot({ rawMin: 12 * 60 + 40, mins: 30, edges }).edge, null);
});

test('edgesOnDay ignores all-day items and the dragged task itself', () => {
  const items = [ev(9, 0, 10, 0), { id: 'ad', all_day: true, starts_at: '2026-10-06' }, { ...ev(11, 0, 12, 0), task_id: 't1' }];
  assert.deepEqual(edgesOnDay(items, day, { skipTaskId: 't1' }), [540, 600]);
});

test('findFreeSlot finds the first gap that fits, after "now" today', () => {
  const items = [ev(9, 0, 10, 0), ev(10, 30, 12, 0), ev(12, 0, 13, 0)];
  const early = new Date(2026, 9, 6, 8, 40);
  // 30m fits before 9:00? 8:45 → 9:15 overlaps, so no; the first gap is 10:00–10:30.
  assert.equal(findFreeSlot({ items, from: early, mins: 30 }).getHours() * 60 + findFreeSlot({ items, from: early, mins: 30 }).getMinutes(), 10 * 60);
  // 60m doesn't fit in 10:00–10:30 → after 13:00.
  const s = findFreeSlot({ items, from: early, mins: 60 });
  assert.equal(s.getHours() * 60 + s.getMinutes(), 13 * 60);
});

test('findFreeSlot rolls to tomorrow when today is full, and honours 6 AM', () => {
  const items = [ev(6, 0, 23, 59)];
  const s = findFreeSlot({ items, from: new Date(2026, 9, 6, 7, 0), mins: 30 });
  assert.equal(s.getDate(), 7);
  assert.equal(s.getHours(), 6);
  assert.equal(findFreeSlot({ items: [], from: new Date(2026, 9, 6, 3, 0), mins: 30 }).getHours(), 6);
});

test('findFreeSlot ignores the task being rescheduled', () => {
  const items = [{ ...ev(9, 0, 10, 0), task_id: 'me' }];
  const s = findFreeSlot({ items, from: new Date(2026, 9, 6, 8, 0), mins: 60, skipTaskId: 'me' });
  assert.equal(s.getHours(), 8);
});

test('sanitizeBlocks drops junk and normalises durations', () => {
  const out = sanitizeBlocks({ a: { start: at(9), mins: 47 }, b: { start: 'nope', mins: 30 }, c: { start: at(10) }, d: null });
  assert.deepEqual(Object.keys(out).sort(), ['a', 'c']);
  assert.equal(out.a.mins, 45);
  assert.equal(out.c.mins, 30);
  assert.equal(clampDuration(1), 15);
  assert.equal(clampDuration(9999), 480);
});

test('taskItems maps blocks to calendar items and skips deleted tasks', () => {
  const blocks = { t1: { start: at(9), mins: 45 }, gone: { start: at(11), mins: 30 } };
  const items = taskItems(blocks, [{ id: 't1', title: 'Write', priority: 'High', column_name: 'Done' }], (t) => t.column_name === 'Done');
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'task');
  assert.equal(items[0].ends_at, at(9, 45));
  assert.equal(items[0].done, true);
  assert.equal(items[0].color, '#fb923c');
});

test('dayLoad merges overlaps inside the 6 AM–midnight window', () => {
  const load = dayLoad([ev(9, 0, 11, 0), ev(10, 0, 12, 0), ev(4, 0, 7, 0)], day);
  assert.equal(load.busy, 3 * 60 + 60); // 6–7 (clipped) + 9–12
  assert.equal(load.free, 18 * 60 - 4 * 60);
});

test('durationLabel', () => {
  assert.deepEqual([15, 60, 90, 120].map(durationLabel), ['15m', '1h', '1h 30m', '2h']);
});
