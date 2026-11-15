// Date-only strings must read as local calendar days. Pin a US zone, where the
// old `new Date('YYYY-MM-DD')` (UTC midnight) landed on the previous evening.
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLocalDate, relativeDay, formatDate } from '../src/lib/helpers.js';

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const offsetKey = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return key(d);
};

test('a date-only string is local midnight of that same day', () => {
  const d = parseLocalDate('2026-10-01');
  assert.equal(key(d), '2026-10-01');
  assert.equal(d.getHours(), 0);
});

test('timestamps and Date objects pass through unchanged', () => {
  assert.equal(parseLocalDate('2026-10-01T15:30:00Z').toISOString(), '2026-10-01T15:30:00.000Z');
  const now = new Date();
  assert.equal(parseLocalDate(now).getTime(), now.getTime());
});

test('relativeDay labels today / tomorrow / yesterday correctly in a US timezone', () => {
  assert.equal(relativeDay(offsetKey(0)), 'Today');
  assert.equal(relativeDay(offsetKey(1)), 'Tomorrow');
  assert.equal(relativeDay(offsetKey(-1)), 'Yesterday');
  assert.equal(relativeDay(offsetKey(3)), 'In 3 days');
  assert.equal(relativeDay(offsetKey(-3)), '3d overdue');
});

test('formatDate shows the stored day, not the previous evening', () => {
  assert.equal(formatDate('2026-10-01'), 'Oct 1');
  assert.equal(formatDate('2026-03-01'), 'Mar 1');
});

test('the first of a month stays in that month', () => {
  assert.equal(parseLocalDate('2026-10-01').getMonth(), 9);
  assert.equal(parseLocalDate('2026-01-01').getFullYear(), 2026);
});

import { dayKey } from '../src/lib/helpers.js';

test('dayKey names the local day, even late in the evening', () => {
  // 11:30pm on Oct 1 in New York is already Oct 2 in UTC.
  assert.equal(dayKey(new Date(2026, 9, 1, 23, 30)), '2026-10-01');
  assert.equal(dayKey(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
  assert.equal(new Date(2026, 9, 1, 23, 30).toISOString().slice(0, 10), '2026-10-02'); // the old bug
});
