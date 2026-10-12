import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanExercises, cloneExercises, dayKeyFor, dayPlan, isRest, moveItem, nextDayKey, planByDay, setsReps, typeColor,
} from '../src/lib/fitnessPlan.js';

test('dayKeyFor maps JS weekdays to plan keys', () => {
  assert.equal(dayKeyFor(new Date(2026, 9, 11)), 'Sun'); // Oct 11 2026 is a Sunday
  assert.equal(dayKeyFor(new Date(2026, 9, 12)), 'Mon');
  assert.equal(nextDayKey('Sun'), 'Mon');
  assert.equal(nextDayKey('Mon'), 'Tue');
});

test('cleanExercises tolerates bad input and drops unnamed rows', () => {
  assert.deepEqual(cleanExercises(null), []);
  assert.deepEqual(cleanExercises('nope'), []);
  const out = cleanExercises([{ name: ' Bench Press ', sets: 4, reps: '8-10' }, { name: '  ' }, null, { name: 'Dips', id: 'x' }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Bench Press');
  assert.equal(out[0].sets, '4');
  assert.equal(out[0].reps, '8-10');
  assert.ok(out[0].id);
  assert.equal(out[1].id, 'x');
});

test('setsReps formats whatever was filled in', () => {
  assert.equal(setsReps({ sets: '4', reps: '8–10' }), '4 × 8–10');
  assert.equal(setsReps({ sets: '3' }), '3 sets');
  assert.equal(setsReps({ sets: '1' }), '1 set');
  assert.equal(setsReps({ reps: 'AMRAP' }), 'AMRAP reps');
  assert.equal(setsReps({}), '');
});

test('planByDay keeps the first row per day; dayPlan reads a row safely', () => {
  const map = planByDay([
    { day_of_week: 'Mon', workout_type: 'Push', id: 1 },
    { day_of_week: 'Mon', workout_type: 'Pull', id: 2 },
    { day_of_week: 'Tue', workout_type: 'Rest', id: 3 },
  ]);
  assert.equal(map.Mon.id, 1);
  assert.equal(dayPlan(map.Tue).rest, true);
  const empty = dayPlan(undefined);
  assert.equal(empty.planned, false);
  assert.deepEqual(empty.exercises, []);
  // A legacy row (workout_type only, exercises null) still reads as planned.
  assert.equal(dayPlan({ day_of_week: 'Wed', workout_type: 'Legs', exercises: null }).planned, true);
});

test('rest detection and colours', () => {
  assert.equal(isRest(' rest '), true);
  assert.equal(isRest('Push'), false);
  assert.equal(typeColor('push'), 'var(--accent)');
  assert.equal(typeColor('Arms & Abs'), 'var(--accent)');
});

test('moveItem reorders without mutating', () => {
  const a = ['x', 'y', 'z'];
  assert.deepEqual(moveItem(a, 0, 1), ['y', 'x', 'z']);
  assert.deepEqual(moveItem(a, 2, 0), ['z', 'x', 'y']);
  assert.deepEqual(moveItem(a, 0, -1), a);
  assert.deepEqual(a, ['x', 'y', 'z']);
});

test('cloneExercises gives fresh ids', () => {
  const src = [{ id: 'a', name: 'Squat', sets: '5', reps: '5' }];
  const copy = cloneExercises(src);
  assert.equal(copy[0].name, 'Squat');
  assert.notEqual(copy[0].id, 'a');
});

test('a rest label never hides saved recovery exercises', () => {
  const plan = dayPlan({ workout_type: 'Rest', exercises: [{ name: 'Mobility', reps: '10 minutes' }] });
  assert.equal(plan.rest, false);
  assert.equal(plan.exercises[0].reps, '10 minutes');
  assert.equal(dayPlan({ workout_type: 'Rest', exercises: [] }).rest, true);
});

test('unplanned days and notes-only days retain their meaning', () => {
  assert.equal(dayPlan({ workout_type: '', exercises: [], notes: null }).planned, false);
  assert.equal(dayPlan({ notes: 'Easy walk if time allows' }).planned, true);
  assert.equal(dayPlan({ workout_type: 'My custom split' }).type, 'My custom split');
});
