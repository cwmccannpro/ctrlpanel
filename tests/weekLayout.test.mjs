import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDay } from '../src/lib/weekLayout.js';

const day = new Date(2026, 9, 6); // Tue Oct 6 2026, local
const at = (h, m = 0, d = 6) => new Date(2026, 9, d, h, m).toISOString();
const ev = (id, sh, sm, eh, em, extra = {}) => ({ id, title: id, starts_at: at(sh, sm), ends_at: at(eh, em), ...extra });

test('a timed event is placed by minutes from midnight', () => {
  const { blocks } = layoutDay([ev('a', 9, 30, 10, 45)], day);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].top, 9 * 60 + 30);
  assert.equal(blocks[0].bottom, 10 * 60 + 45);
  assert.deepEqual([blocks[0].col, blocks[0].cols], [0, 1]);
});

test('overlapping events sit side by side; later non-overlapping ones reset to full width', () => {
  const { blocks } = layoutDay([ev('a', 9, 0, 11, 0), ev('b', 10, 0, 12, 0), ev('c', 10, 30, 11, 30), ev('d', 14, 0, 15, 0)], day);
  const by = Object.fromEntries(blocks.map((b) => [b.event.id, b]));
  assert.equal(by.a.cols, 3);
  assert.deepEqual([by.a.col, by.b.col, by.c.col], [0, 1, 2]);
  assert.deepEqual([by.d.col, by.d.cols], [0, 1]);
});

test('back-to-back events do not count as overlapping', () => {
  const { blocks } = layoutDay([ev('a', 9, 0, 10, 0), ev('b', 10, 0, 11, 0)], day);
  assert.deepEqual(blocks.map((b) => [b.col, b.cols]), [[0, 1], [0, 1]]);
});

test('very short events get a readable minimum height', () => {
  const { blocks } = layoutDay([{ id: 'p', starts_at: at(8, 0), ends_at: at(8, 5) }, { id: 'q', starts_at: at(12, 0) }], day);
  assert.equal(blocks[0].bottom - blocks[0].top, 30);
  assert.equal(blocks[1].bottom - blocks[1].top, 30);
});

test('events are clipped to 6 AM–midnight; fully outside ones are counted', () => {
  const early = { id: 'e', starts_at: at(4, 0), ends_at: at(5, 0) };
  const crossing = { id: 'x', starts_at: at(5, 0), ends_at: at(7, 30) };
  const late = { id: 'l', starts_at: at(22, 30), ends_at: at(2, 0, 7) };
  const { blocks, before, after } = layoutDay([early, crossing, late], day);
  assert.equal(before, 1);
  assert.equal(after, 0);
  const by = Object.fromEntries(blocks.map((b) => [b.event.id, b]));
  assert.deepEqual([by.x.top, by.x.bottom, by.x.clipTop], [360, 450, true]);
  assert.deepEqual([by.l.top, by.l.bottom, by.l.clipBottom], [22 * 60 + 30, 1440, true]);
  const night = layoutDay([{ id: 'n', starts_at: at(1, 0, 7), ends_at: at(2, 0, 7) }], new Date(2026, 9, 7));
  assert.equal(night.before, 1);
});

test('all-day and day-filling events go to the all-day row', () => {
  const { allDay, blocks } = layoutDay([
    { id: 'd', all_day: true, starts_at: '2026-10-06', ends_at: '2026-10-07' },
    { id: 'long', starts_at: at(0, 0), ends_at: at(0, 0, 8) },
    ev('t', 9, 0, 10, 0),
  ], day);
  assert.deepEqual(allDay.map((e) => e.id), ['d', 'long']);
  assert.deepEqual(blocks.map((b) => b.event.id), ['t']);
});

test('an event at 11:50 PM stays inside the grid', () => {
  const { blocks } = layoutDay([{ id: 'z', starts_at: at(23, 50), ends_at: at(23, 55) }], day);
  assert.equal(blocks[0].bottom, 1440);
  assert.equal(blocks[0].top, 1410);
});
