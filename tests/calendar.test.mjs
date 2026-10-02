import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarDays, dateKey, eventsForDay, moveCalendar } from '../src/lib/calendarView.js';
test('month navigation does not skip February from January 31', () => {
  assert.equal(dateKey(moveCalendar(new Date(2026, 0, 31), 1, 'Month')), '2026-02-01');
  assert.equal(dateKey(moveCalendar(new Date(2026, 0, 1), -1, 'Month')), '2025-12-01');
});
test('month grid covers six full weeks and week grid starts Sunday', () => {
  const days = calendarDays(new Date(2026, 8, 7));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 0);
  assert.equal(days[41].getDay(), 6);
  assert.equal(calendarDays(new Date(2026, 8, 7), 'Week').length, 7);
});
test('all-day events respect exclusive end dates without UTC date shifts', () => {
  const e = {
    starts_at: '2026-09-07',
    ends_at: '2026-09-09',
    all_day: true
  };
  assert.equal(eventsForDay([e], new Date(2026, 8, 7)).length, 1);
  assert.equal(eventsForDay([e], new Date(2026, 8, 8)).length, 1);
  assert.equal(eventsForDay([e], new Date(2026, 8, 9)).length, 0);
});
test('overnight events appear on both days but midnight ends are exclusive', () => {
  const e = {
    starts_at: new Date(2026, 8, 7, 23).toISOString(),
    ends_at: new Date(2026, 8, 8, 1).toISOString()
  };
  assert.equal(eventsForDay([e], new Date(2026, 8, 7)).length, 1);
  assert.equal(eventsForDay([e], new Date(2026, 8, 8)).length, 1);
  e.ends_at = new Date(2026, 8, 8, 0).toISOString();
  assert.equal(eventsForDay([e], new Date(2026, 8, 8)).length, 0);
});
