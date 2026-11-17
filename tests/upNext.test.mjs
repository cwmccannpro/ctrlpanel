import test from 'node:test';
import assert from 'node:assert/strict';
import { upNext } from '../src/lib/upNext.js';

const at = (h, m = 0) => new Date(2026, 10, 16, h, m).toISOString();
const now = new Date(2026, 10, 16, 10, 30);

test('an item in progress is "now", with progress through it', () => {
  const r = upNext([{ id: 'a', title: 'Standup', starts_at: at(10), ends_at: at(11) }, { id: 'b', starts_at: at(12), ends_at: at(13) }], { now });
  assert.equal(r.current.id, 'a');
  assert.equal(r.hero.id, 'a');
  assert.equal(r.next.id, 'b');
  assert.equal(r.progress, 0.5);
});

test('with nothing in progress the soonest later item is "next", in time order', () => {
  const r = upNext([{ id: 'late', starts_at: at(15) }, { id: 'soon', starts_at: at(11) }, { id: 'past', starts_at: at(8), ends_at: at(9) }], { now });
  assert.equal(r.current, null);
  assert.equal(r.hero.id, 'soon');
  assert.equal(r.progress, 0);
});

test('all-day, date-only, finished and unparseable items never count', () => {
  const r = upNext([
    { id: 'allday', all_day: true, starts_at: at(11) },
    { id: 'dateonly', starts_at: '2026-11-16' },
    { id: 'done', done: true, starts_at: at(11) },
    { id: 'bad', starts_at: 'not a date' },
  ], { now });
  assert.equal(r.hero, null);
});

test('another day has no "now": its first timed item is next', () => {
  const r = upNext([{ id: 'b', starts_at: at(9) }, { id: 'a', starts_at: at(7) }], { now, isToday: false });
  assert.equal(r.current, null);
  assert.equal(r.hero.id, 'a');
});

test('mixed timezone offsets sort by the actual instant', () => {
  const r = upNext([{ id: 'utc', starts_at: '2026-11-16T23:00:00Z' }, { id: 'offset', starts_at: '2026-11-16T22:00:00-05:00' }], { now: new Date('2026-11-16T20:00:00Z') });
  assert.equal(r.hero.id, 'utc');
});
