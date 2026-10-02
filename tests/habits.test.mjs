import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentStreak } from '../src/lib/habits.js';
import { dayKey } from '../src/lib/helpers.js';

const TODAY = new Date(2026, 9, 1, 21, 0); // Oct 1, 9pm local
const done = (...days) => {
  const set = new Set(days);
  return (dk) => set.has(dk);
};

test('streak counts consecutive days ending today', () => {
  assert.equal(currentStreak(done('2026-10-01', '2026-09-30', '2026-09-29'), TODAY), 3);
});

test('an unticked today does not zero a running streak', () => {
  assert.equal(currentStreak(done('2026-09-30', '2026-09-29'), TODAY), 2);
});

test('a gap ends the streak; nothing done is zero', () => {
  assert.equal(currentStreak(done('2026-10-01', '2026-09-29'), TODAY), 1);
  assert.equal(currentStreak(done(), TODAY), 0);
  assert.equal(currentStreak(done('2026-09-28'), TODAY), 0);
});

test('streaks cross month and year boundaries', () => {
  const jan = new Date(2026, 0, 2);
  assert.equal(currentStreak(done('2026-01-02', '2026-01-01', '2025-12-31'), jan), 3);
});

test('always-true input cannot loop forever', () => {
  assert.equal(currentStreak(() => true, TODAY), 3650);
  assert.equal(dayKey(TODAY), '2026-10-01');
});
