import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRESETS, clockText, elapsedFraction, freshTimer, isFinished, nextTimer, pauseTimer, presetById, recordSession,
  remainingMs, sanitizeTimer, startTimer,
} from '../src/lib/pomodoro.js';
import { QUOTES, quoteOfDay } from '../src/lib/quotes.js';

const P = presetById('25/5');
const MIN = 60000;

test('a fresh timer shows a full interval and is stopped', () => {
  assert.deepEqual(freshTimer(P), { mode: 'focus', running: false, endsAt: null, remainingMs: 25 * MIN });
  assert.equal(freshTimer(P, 'rest').remainingMs, 5 * MIN);
  assert.equal(freshTimer(P, 'nonsense').mode, 'focus');
  assert.equal(presetById('missing'), PRESETS[0]);
});

test('start → pause keeps the remaining time; start again resumes from it', () => {
  const t0 = 1_000_000;
  const running = startTimer(freshTimer(P), t0);
  assert.equal(running.endsAt, t0 + 25 * MIN);
  assert.equal(remainingMs(running, t0 + 10 * MIN), 15 * MIN);
  const paused = pauseTimer(running, t0 + 10 * MIN);
  assert.deepEqual([paused.running, paused.remainingMs], [false, 15 * MIN]);
  assert.equal(remainingMs(paused, t0 + 99 * MIN), 15 * MIN); // paused time does not tick
  const resumed = startTimer(paused, t0 + 20 * MIN);
  assert.equal(resumed.endsAt, t0 + 35 * MIN);
  assert.equal(startTimer(running, t0 + 5), running); // already running: no change
  assert.equal(pauseTimer(paused, t0), paused);
});

test('finishing: only a running timer past its end is finished; the next interval alternates', () => {
  const t0 = 5_000;
  const running = startTimer(freshTimer(P), t0);
  assert.equal(isFinished(running, t0 + 25 * MIN - 1), false);
  assert.equal(isFinished(running, t0 + 25 * MIN), true);
  assert.equal(isFinished(freshTimer(P), t0 + 99 * MIN), false);
  assert.equal(remainingMs(running, t0 + 99 * MIN), 0);
  assert.deepEqual(nextTimer(running, P), freshTimer(P, 'rest'));
  assert.deepEqual(nextTimer(freshTimer(P, 'rest'), P), freshTimer(P, 'focus'));
});

test('clockText rounds partial seconds up so it never shows 00:00 early', () => {
  assert.equal(clockText(25 * MIN), '25:00');
  assert.equal(clockText(24 * MIN + 7000), '24:07');
  assert.equal(clockText(500), '00:01');
  assert.equal(clockText(-5), '00:00');
  assert.equal(clockText(90 * MIN), '90:00');
});

test('elapsedFraction runs 0 → 1', () => {
  const t0 = 0;
  const running = startTimer(freshTimer(P), t0);
  assert.equal(elapsedFraction(freshTimer(P), P, t0), 0);
  assert.equal(elapsedFraction(running, P, t0 + 5 * MIN), 0.2);
  assert.equal(elapsedFraction(running, P, t0 + 60 * MIN), 1);
});

test('sanitizeTimer turns garbage into a fresh timer and keeps good state', () => {
  assert.deepEqual(sanitizeTimer(null, P), freshTimer(P));
  assert.deepEqual(sanitizeTimer({ mode: 'x', remainingMs: 'abc' }, P), freshTimer(P));
  assert.deepEqual(sanitizeTimer({ mode: 'focus', remainingMs: 99 * MIN }, P), freshTimer(P)); // longer than the preset
  assert.equal(sanitizeTimer({ mode: 'rest', remainingMs: 2 * MIN }, P).remainingMs, 2 * MIN);
  const running = sanitizeTimer({ mode: 'focus', running: true, endsAt: 123456 }, P);
  assert.deepEqual([running.running, running.endsAt], [true, 123456]);
  assert.equal(sanitizeTimer({ running: true, endsAt: 'soon' }, P).running, false);
});

test('recordSession counts per day and keeps only the last 14 days', () => {
  let s = {};
  s = recordSession(s, '2026-10-01');
  s = recordSession(s, '2026-10-01');
  assert.equal(s['2026-10-01'], 2);
  for (let d = 1; d <= 20; d += 1) s = recordSession(s, `2026-09-${String(d).padStart(2, '0')}`);
  assert.equal(Object.keys(s).length, 14);
  assert.equal(s['2026-09-01'], undefined);
  assert.equal(s['2026-10-01'], 2);
});

test('quoteOfDay is stable within a day, steps with the offset and always wraps into range', () => {
  const day = new Date(2026, 9, 1, 8);
  assert.equal(quoteOfDay(day), quoteOfDay(new Date(2026, 9, 1, 23)));
  assert.notEqual(quoteOfDay(day), quoteOfDay(day, 1));
  assert.equal(quoteOfDay(day, QUOTES.length), quoteOfDay(day));
  assert.ok(QUOTES.includes(quoteOfDay(day, -37)));
  assert.ok(QUOTES.every((q) => q.q && q.a));
});
