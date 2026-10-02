import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReview, delta, habitStats, isoWeek, nutritionStats, noteStats, reviewNoteTemplate, reviewNoteTitle,
  reviewWindows, rowDay, spendStats, taskStats, upcomingEvents, weekLabel, weightStats, workoutStats,
} from '../src/lib/review.js';
import { eventsMentioning, notesOfProject, projectDigest, projectForBoard, projectForTask, tasksOfProject } from '../src/lib/links.js';
import { AI_ACTIONS, overduePrompt, planMyDayPrompt, weeklyReviewPrompt } from '../src/lib/prompts.js';

// Thursday 1 Oct 2026, 9pm local — the evening case that breaks UTC-based days.
const TODAY = new Date(2026, 9, 1, 21, 0);
const W = reviewWindows(TODAY);

/* ---------------- calendar math ---------------- */

test('ISO weeks: year boundaries and the current week', () => {
  assert.deepEqual(isoWeek(new Date(2026, 0, 1)), { year: 2026, week: 1 }); // Thu
  assert.deepEqual(isoWeek(new Date(2025, 11, 29)), { year: 2026, week: 1 }); // Mon of that week
  assert.deepEqual(isoWeek(new Date(2024, 11, 30)), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek(new Date(2021, 0, 3)), { year: 2020, week: 53 }); // Sun
  assert.deepEqual(isoWeek(new Date(2026, 8, 28)), { year: 2026, week: 40 }); // Mon
  assert.equal(weekLabel(TODAY), '2026-W40');
  assert.equal(weekLabel(new Date(2026, 0, 5)), '2026-W02');
});

test('windows are local days: last 7, the 7 before, the 7 after', () => {
  assert.equal(W.today, '2026-10-01');
  assert.deepEqual(W.current, ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
  assert.equal(W.previous[0], '2026-09-18');
  assert.equal(W.previous[6], '2026-09-24');
  assert.deepEqual([W.next[0], W.next[6]], ['2026-10-02', '2026-10-08']);
  assert.equal(W.from, '2026-09-25');
  assert.equal(W.to, '2026-10-01');
});

test('rowDay reads date-only strings as-is and timestamps in local time', () => {
  assert.equal(rowDay('2026-10-01'), '2026-10-01');
  assert.equal(rowDay(new Date(2026, 9, 1, 23, 30).toISOString()), '2026-10-01'); // late evening stays that day
  assert.equal(rowDay(''), '');
  assert.equal(rowDay('garbage'), '');
});

test('delta reports direction and percentage', () => {
  assert.deepEqual(delta(8, 5), { diff: 3, pct: 60, dir: 'up' });
  assert.deepEqual(delta(2, 4), { diff: -2, pct: -50, dir: 'down' });
  assert.deepEqual(delta(3, 3), { diff: 0, pct: 0, dir: 'flat' });
  assert.equal(delta(3, 0).pct, null);
});

/* ---------------- sections ---------------- */

const done = (habit, ...days) => days.map((d) => ({ habit_id: habit, log_date: d, completed: true }));

test('habit stats: rate, previous rate, streaks, best and weakest', () => {
  const habits = [
    { id: 'a', name: 'Read', created_at: '2026-01-01' },
    { id: 'b', name: 'Run', created_at: '2026-01-01' },
    { id: 'c', name: 'Retired', active: false, created_at: '2026-01-01' },
  ];
  const logs = [
    ...done('a', ...W.current), // 7/7, streak 7
    ...done('b', '2026-09-30', '2026-10-01', '2026-09-27'), // 3/7, streak 2
    ...done('a', ...W.previous.slice(0, 3)), // prev 3/7
    ...done('c', ...W.current),
  ];
  const s = habitStats({ habits, logs, windows: W });
  assert.equal(s.count, 2, 'retired habits are ignored');
  assert.equal(s.rate, Math.round((10 / 14) * 100));
  assert.equal(s.prevRate, Math.round((3 / 14) * 100));
  assert.equal(s.best.name, 'Read');
  assert.equal(s.needsWork.name, 'Run');
  assert.equal(s.habits.find((h) => h.id === 'a').streak, 7);
  assert.equal(s.habits.find((h) => h.id === 'b').streak, 2);
  assert.equal(s.longestStreak.name, 'Read');
});

test('a new habit is not penalised for days before it existed', () => {
  const habits = [{ id: 'n', name: 'New', created_at: '2026-09-30' }];
  const s = habitStats({ habits, logs: done('n', '2026-10-01'), windows: W });
  assert.equal(s.habits[0].possible, 2); // Sep 30 and Oct 1 only
  assert.equal(s.habits[0].rate, 50);
  assert.equal(s.prevRate, null, 'nothing was possible last week');
});

test('task stats: due this week vs done, overdue now, what is coming', () => {
  const boards = [{ id: 'b1', columns: ['Todo', 'Doing', 'Done'] }, { id: 'b2', columns: ['Inbox', 'Shipped'] }];
  const tasks = [
    { id: 1, title: 'Late', board_id: 'b1', column_name: 'Todo', due_date: '2026-09-28', created_at: '2026-09-01T10:00:00Z' },
    { id: 2, title: 'Done in week', board_id: 'b1', column_name: 'Done', due_date: '2026-09-29' },
    { id: 3, title: 'Shipped', board_id: 'b2', column_name: 'Shipped', due_date: '2026-09-30' }, // custom done column
    { id: 4, title: 'Today', board_id: 'b1', column_name: 'Doing', due_date: '2026-10-01' },
    { id: 5, title: 'Tomorrow', board_id: 'b1', column_name: 'Todo', due_date: '2026-10-02', priority: 'High' },
    { id: 6, title: 'Next week', board_id: 'b1', column_name: 'Todo', due_date: '2026-10-08' },
    { id: 7, title: 'Far', board_id: 'b1', column_name: 'Todo', due_date: '2026-10-20' },
    { id: 8, title: 'Last week', board_id: 'b1', column_name: 'Done', due_date: '2026-09-20' },
    { id: 9, title: 'No date', board_id: 'b1', column_name: 'Todo', due_date: null, created_at: new Date(2026, 8, 30, 12).toISOString() },
  ];
  const s = taskStats({ tasks, boards, windows: W });
  assert.deepEqual(s.overdue.map((t) => t.title), ['Late']);
  assert.deepEqual(s.dueThisWeek, { total: 4, done: 2 });
  assert.deepEqual(s.dueLastWeek, { total: 1, done: 1 });
  assert.deepEqual(s.upcoming.map((t) => t.title), ['Today', 'Tomorrow', 'Next week']);
  assert.equal(s.createdThisWeek, 1);
  assert.equal(s.openCount, 6);
});

test('workouts, nutrition, weight, spending and notes', () => {
  const at = (n, h = 12) => new Date(2026, 9, 1 + n, h).toISOString();
  const w = workoutStats({ logs: [{ workout_type: 'Push', completed_at: at(-1) }, { workout_type: 'Push', completed_at: at(-2) }, { workout_type: 'Legs', completed_at: at(-9) }], windows: W });
  assert.deepEqual([w.count, w.prevCount, w.activeDays, w.types.Push], [2, 1, 2, 2]);

  const n = nutritionStats({
    logs: [{ logged_at: at(0, 8), calories: 500, protein: 30 }, { logged_at: at(0, 13), calories: 700, protein: 40 }, { logged_at: at(-1), calories: 1000, protein: 50 }, { logged_at: at(-9), calories: 2000, protein: 100 }],
    goals: [{ calories: 2400, protein: 160 }],
    windows: W,
  });
  assert.deepEqual([n.loggedDays, n.avgCalories, n.avgProtein, n.goalCalories, n.prev.avgCalories], [2, 1100, 60, 2400, 2000]);

  const wt = weightStats({ logs: [{ weight: 182, logged_at: at(-5) }, { weight: 181, logged_at: at(-1) }, { weight: 184, logged_at: at(-9) }], windows: W });
  assert.deepEqual([wt.entries, wt.first, wt.last, wt.change, wt.prevAvg], [2, 182, 181, -1, 184]);

  // Float noise from computed weights must not leak into the UI or the note.
  const noisy = weightStats({ logs: [{ weight: 180.14000000000001, logged_at: at(-3) }, { weight: 178.82000000000002, logged_at: at(-1) }], windows: W });
  assert.deepEqual([noisy.first, noisy.last, noisy.change], [180.14, 178.82, -1.32]);

  const sp = spendStats({
    transactions: [{ amount: 100, category_id: 'c1', date: '2026-09-30' }, { amount: 50.5, category_id: 'c2', date: '2026-10-01' }, { amount: 30, category_id: 'c1', date: '2026-09-20' }],
    categories: [{ id: 'c1', name: 'Rent', budgeted: 400 }, { id: 'c2', name: 'Food', budgeted: 200 }],
    windows: W,
  });
  assert.deepEqual([sp.total, sp.prevTotal, sp.count, sp.top[0].name, sp.weeklyBudget], [150.5, 30, 2, 'Rent', 138.46]);

  const nt = noteStats({ notes: [{ title: 'A', created_at: at(-2) }, { title: 'B', created_at: at(-20) }], windows: W });
  assert.deepEqual([nt.count, nt.titles], [1, ['A']]);
});

test('upcoming events: today through next week, soonest first', () => {
  const events = [
    { title: 'Later', starts_at: new Date(2026, 9, 6, 9).toISOString() },
    { title: 'Tonight', starts_at: new Date(2026, 9, 1, 23).toISOString() },
    { title: 'Past', starts_at: new Date(2026, 8, 20, 9).toISOString() },
    { title: 'Too far', starts_at: new Date(2026, 9, 20, 9).toISOString() },
  ];
  assert.deepEqual(upcomingEvents(events, W).map((e) => e.title), ['Tonight', 'Later']);
});

test('empty data never crashes and rates are null, not NaN', () => {
  const r = buildReview({ today: TODAY });
  assert.equal(r.habits.rate, null);
  assert.equal(r.nutrition.avgCalories, null);
  assert.equal(r.weight.change, null);
  assert.equal(r.spend.weeklyBudget, null);
  assert.equal(r.label, '2026-W40');
  assert.ok(reviewNoteTemplate(r).includes('## Wins'));
});

/* ---------------- the note ---------------- */

test('the review note carries the numbers and leaves reflection blank', () => {
  const r = buildReview({
    today: TODAY,
    habits: [{ id: 'a', name: 'Read', created_at: '2026-01-01' }],
    habitLogs: done('a', ...W.current),
    tasks: [{ id: 1, title: 'Pay card', board_id: 'b', column_name: 'Todo', due_date: '2026-09-28' }, { id: 2, title: 'Book flights', board_id: 'b', column_name: 'Todo', due_date: '2026-10-03', priority: 'High' }],
    boards: [{ id: 'b', columns: ['Todo', 'Done'] }],
    workouts: [{ workout_type: 'Push', completed_at: new Date(2026, 8, 30, 12).toISOString() }],
    nutrition: [], goals: [], weights: [], transactions: [], categories: [], notes: [],
    events: [{ title: 'Dentist', starts_at: new Date(2026, 9, 2, 15).toISOString() }],
  });
  assert.equal(reviewNoteTitle(r), 'Weekly review 2026-W40');
  const md = reviewNoteTemplate(r);
  assert.match(md, /^# Weekly review 2026-W40/);
  assert.match(md, /Sep 25 – Oct 1/);
  assert.match(md, /\*\*Habits:\*\* 100% completed/);
  assert.match(md, /longest streak: Read \(7 days\)/);
  assert.match(md, /\*\*Tasks:\*\* 1 due this week, 0 done · 1 overdue now/);
  assert.match(md, /\*\*Training:\*\* 1 workout \(last week 0\)/);
  assert.match(md, /- \[ \] \*\*Overdue\*\* · Pay card/);
  assert.match(md, /- \[ \] Book flights — Sat, Oct 3 \(High\)/);
  assert.match(md, /Dentist/);
  for (const heading of ['## Wins', '## Lessons', "## Next week's focus"]) assert.ok(md.includes(heading));
  assert.ok(!md.includes('Nutrition'), 'sections with no data are left out');
});

/* ---------------- project links ---------------- */

const projects = [
  { id: 'p1', name: 'Website Redesign', todo_board_id: 'b1' },
  { id: 'p2', name: 'Thesis', todo_board_id: null },
  { id: 'p3', name: 'Q4', todo_board_id: 'b3' },
];

test('a task finds its project through its board', () => {
  assert.equal(projectForBoard(projects, 'b1').id, 'p1');
  assert.equal(projectForBoard(projects, 'nope'), null);
  assert.equal(projectForBoard(projects, 'tmp-123'), null);
  assert.equal(projectForBoard(projects, null), null);
  assert.equal(projectForTask({ board_id: 'b1' }, projects).name, 'Website Redesign');
  assert.equal(projectForTask({ board_id: null }, projects), null);
  assert.equal(tasksOfProject([{ id: 1, board_id: 'b1' }, { id: 2, board_id: 'b9' }], projects[0]).length, 1);
  assert.equal(tasksOfProject([{ id: 1, board_id: 'b1' }], projects[1]).length, 0);
  assert.equal(notesOfProject([{ id: 'n1', project_id: 'p1' }, { id: 'n2', project_id: null }], 'p1').length, 1);
});

test('events match a project by name, ignoring case, vague names and past events', () => {
  const events = [
    { title: 'website redesign kickoff', starts_at: '2026-10-05T10:00:00Z' },
    { title: 'Lunch', starts_at: '2026-10-05T12:00:00Z' },
    { title: 'Website Redesign review', starts_at: '2026-09-01T10:00:00Z' }, // past
    { title: 'Q4 planning', starts_at: '2026-10-06T10:00:00Z' },
  ];
  assert.deepEqual(eventsMentioning(events, projects[0], { fromKey: '2026-10-01' }).map((e) => e.title), ['website redesign kickoff']);
  assert.deepEqual(eventsMentioning(events, projects[2], { fromKey: '2026-10-01' }), [], 'a 2-character name is too vague');
  assert.deepEqual(eventsMentioning(events, { name: '' }), []);
});

test('project digest: open work, overdue, due soon, notes and events', () => {
  const boards = [{ id: 'b1', columns: ['Todo', 'Done'] }];
  const tasks = [
    { id: 1, board_id: 'b1', column_name: 'Todo', due_date: '2026-09-29', title: 'late' },
    { id: 2, board_id: 'b1', column_name: 'Todo', due_date: '2026-10-05', title: 'soon' },
    { id: 3, board_id: 'b1', column_name: 'Todo', due_date: '2026-12-25', title: 'far' },
    { id: 4, board_id: 'b1', column_name: 'Done', due_date: '2026-09-29', title: 'finished' },
    { id: 5, board_id: 'other', column_name: 'Todo', due_date: '2026-10-02', title: 'elsewhere' },
  ];
  const d = projectDigest({
    project: { ...projects[0], id: 'p1' }, tasks, boards,
    notes: [{ id: 'n1', project_id: 'p1' }, { id: 'n2', project_id: 'p9' }],
    events: [{ title: 'Website Redesign sync', starts_at: '2026-10-03T10:00:00Z' }],
    today: '2026-10-01',
  });
  assert.deepEqual([d.total, d.open], [4, 3]);
  assert.deepEqual(d.overdue.map((t) => t.title), ['late']);
  assert.deepEqual(d.dueSoon.map((t) => t.title), ['soon']);
  assert.equal(d.notes.length, 1);
  assert.equal(d.events.length, 1);
});

/* ---------------- AI prompts ---------------- */

test('prompts carry the date and tell the model to use real data and not change anything unasked', () => {
  const now = new Date(2026, 9, 1, 14, 5);
  const plan = planMyDayPrompt(now);
  assert.match(plan, /Thursday, October 1, 2026, 2:05 PM/);
  assert.match(plan, /calendar/i);
  assert.match(plan, /Overdue tasks/);
  assert.match(plan, /habits/i);
  assert.match(plan, /Do not create or change anything yet/);
  const review = weeklyReviewPrompt(now);
  assert.match(review, /last 7 days compared with the 7 before/);
  assert.match(review, /3 wins/);
  assert.match(overduePrompt(now), /Do not change anything/);
  assert.deepEqual(AI_ACTIONS.map((a) => a.id), ['plan-day', 'weekly-review', 'overdue']);
  for (const a of AI_ACTIONS) assert.ok(a.prompt(now).length > 50);
});
