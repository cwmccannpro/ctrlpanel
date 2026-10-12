import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agendaDays, categorySpend, countdowns, crmFollowups, daysBetween, deltaTone, dividendStats, financeKpis,
  focusTasks, formatCountdown, habitHeatmap, healthKpis, holdingMovers, isTaskDone, longestRun, nextEvent,
  normalizeLink, opportunityStats, projectProgress, recentTransactions, streakBoard, supplementChecklist,
  taskKpis, timeProgress, weekKpis, weekTraining,
} from '../src/lib/dashboardStats.js';

// Thursday 1 Oct 2026, midday local time (ISO week 40; Mon 28 Sep – Sun 4 Oct).
const NOW = new Date(2026, 9, 1, 12, 0, 0);
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const boards = [{ id: 'b1', name: 'Work', columns: ['To Do', 'Doing', 'Done'] }];
const task = (id, extra = {}) => ({ id, board_id: 'b1', column_name: 'To Do', title: id, priority: 'Medium', created_at: '2026-09-01T00:00:00Z', ...extra });

/* ---------------- days ---------------- */
test('daysBetween counts calendar days across month ends and DST changes', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-04'), 3);
  assert.equal(daysBetween('2026-10-04', '2026-10-01'), -3);
  assert.equal(daysBetween('2026-02-27', '2026-03-02'), 3);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2); // US spring-forward weekend
});

/* ---------------- tasks ---------------- */
const tasks = [
  task('overdue', { due_date: '2026-09-29', priority: 'High' }),
  task('today', { due_date: '2026-10-01' }),
  task('inbox', { priority: 'Urgent' }),
  task('finished', { due_date: '2026-09-30', column_name: 'Done' }),
  task('later', { due_date: '2026-10-03', priority: 'Low' }),
];

test('isTaskDone: the Done column or the board’s last column', () => {
  assert.equal(isTaskDone(task('x', { column_name: 'Done' }), { b1: boards[0] }), true);
  assert.equal(isTaskDone(task('x'), { b1: boards[0] }), false);
  const custom = { b2: { id: 'b2', columns: ['Backlog', 'Shipped'] } };
  assert.equal(isTaskDone({ board_id: 'b2', column_name: 'Shipped' }, custom), true);
  assert.equal(isTaskDone({ board_id: 'b2', column_name: 'Backlog' }, custom), false);
});

test('taskKpis counts open / due today / overdue / undated / high priority and the week’s completion', () => {
  const k = taskKpis({ tasks, boards, today: NOW });
  assert.deepEqual(
    { open: k.open, dueToday: k.dueToday, overdue: k.overdue, noDate: k.noDate, highPriority: k.highPriority, dueWeek: k.dueWeek, doneWeek: k.doneWeek, rate: k.rate },
    { open: 4, dueToday: 1, overdue: 1, noDate: 1, highPriority: 2, dueWeek: 3, doneWeek: 1, rate: 33 }
  );
  assert.equal(taskKpis({ today: NOW }).rate, null);
});

test('focusTasks filters: overdue, high priority, next 7 days, no date', () => {
  const ids = (filter) => focusTasks({ tasks, boards, filter, today: NOW }).items.map((t) => t.id);
  assert.deepEqual(ids('overdue'), ['overdue']);
  assert.deepEqual(ids('priority'), ['inbox', 'overdue']); // Urgent before High
  assert.deepEqual(ids('week'), ['today', 'later']);
  assert.deepEqual(ids('inbox'), ['inbox']);
  assert.equal(focusTasks({ tasks, boards, filter: 'week', today: NOW, limit: 1 }).total, 2);
  assert.equal(focusTasks({ tasks, boards, filter: 'week', today: NOW, limit: 1 }).items.length, 1);
});

/* ---------------- time ---------------- */
test('timeProgress: day, week (Mon–Sun), month, quarter and year', () => {
  const p = timeProgress(NOW);
  const row = (id) => p.rows.find((r) => r.id === id);
  assert.equal(row('day').pct, 50);
  assert.equal(row('week').pct, 50); // Thursday noon = 3.5 of 7 days
  assert.equal(row('month').pct, 2);
  assert.equal(row('quarter').label, 'Q4');
  assert.equal(row('year').pct, Math.round(((273.5) / 365) * 100));
  assert.equal(p.week, 40);
  assert.equal(p.dayOfYear, 274);
  assert.equal(row('year').left, '91d left');
  assert.equal(row('quarter').left, '91d left');
  assert.equal(row('week').left, '3d left');
});

test('formatCountdown reads naturally', () => {
  assert.equal(formatCountdown(20000), 'under a minute');
  assert.equal(formatCountdown(12 * 60000), '12m');
  assert.equal(formatCountdown(135 * 60000), '2h 15m');
  assert.equal(formatCountdown(120 * 60000), '2h');
  assert.equal(formatCountdown(28 * 3600000), '1d 4h');
  assert.equal(formatCountdown(48 * 3600000), '2d');
});

/* ---------------- calendar ---------------- */
const events = [
  { id: 'past', title: 'Past', starts_at: at(2026, 10, 1, 9), ends_at: at(2026, 10, 1, 10) },
  { id: 'now', title: 'Now', starts_at: at(2026, 10, 1, 11, 30), ends_at: at(2026, 10, 1, 13) },
  { id: 'soon', title: 'Soon', starts_at: at(2026, 10, 1, 14), ends_at: at(2026, 10, 1, 15) },
  { id: 'allday', title: 'All day', starts_at: '2026-10-01', ends_at: '2026-10-02', all_day: true },
  { id: 'tomorrow', title: 'Tomorrow', starts_at: at(2026, 10, 2, 9), ends_at: at(2026, 10, 2, 10) },
];

test('nextEvent: what is on now, what is next, how long, and ignores all-day events', () => {
  const n = nextEvent({ events, now: NOW });
  assert.equal(n.current.id, 'now');
  assert.equal(n.endsInMs, 60 * 60000);
  assert.equal(n.next.id, 'soon');
  assert.equal(n.startsInMs, 2 * 3600000);
  assert.deepEqual(n.following.map((e) => e.id), ['tomorrow']);
  const none = nextEvent({ events: [events[3]], now: NOW });
  assert.deepEqual([none.current, none.next, none.following], [null, null, []]);
});

test('agendaDays: events and open tasks per day, plus overdue', () => {
  const a = agendaDays({ events, tasks, boards, today: NOW, days: 7 });
  assert.equal(a.days.length, 7);
  assert.deepEqual(a.days[0].events.map((e) => e.id), ['allday', 'past', 'now', 'soon']);
  assert.deepEqual(a.days[0].tasks.map((t) => t.id), ['today']);
  assert.deepEqual(a.days[1].events.map((e) => e.id), ['tomorrow']);
  assert.equal(a.days[0].label, 'Today');
  assert.equal(a.days[1].label, 'Tomorrow');
  assert.equal(a.days[2].label, 'Sat Oct 3');
  assert.deepEqual(a.days[2].tasks.map((t) => t.id), ['later']);
  assert.deepEqual(a.overdue.map((t) => t.id), ['overdue']);
});

test('countdowns: soonest first, past dates last, bad rows dropped', () => {
  const rows = countdowns(
    [{ id: 'c', date: '2026-09-20' }, { id: 'b', date: '2026-12-01' }, { id: 'a', date: '2026-10-04' }, { id: 'bad', date: 'soon' }, null],
    NOW
  );
  assert.deepEqual(rows.map((r) => [r.id, r.days, r.tone]), [['a', 3, 'soon'], ['b', 61, 'later'], ['c', -11, 'past']]);
});

/* ---------------- week at a glance ---------------- */
test('weekKpis: tiles with week-over-week deltas and which direction is good', () => {
  const habits = [{ id: 'h1', name: 'Read', created_at: '2026-01-01T00:00:00Z' }];
  const log = (d) => ({ habit_id: 'h1', log_date: d, completed: true });
  const habitLogs = ['2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-09-20', '2026-09-21', '2026-09-22'].map(log);
  const workouts = [{ completed_at: at(2026, 9, 30), workout_type: 'Push' }, { completed_at: at(2026, 10, 1), workout_type: 'Pull' }, { completed_at: at(2026, 9, 22), workout_type: 'Legs' }];
  const transactions = [{ amount: 50, date: '2026-10-01' }, { amount: 25, date: '2026-09-30' }, { amount: 100, date: '2026-09-20' }];
  const { tiles } = weekKpis({ habits, habitLogs, tasks, boards, workouts, transactions, categories: [], today: NOW });
  const tile = (id) => tiles.find((t) => t.id === id);

  assert.equal(tile('habits').value, '86%');
  assert.equal(tile('habits').delta.diff, 43);
  assert.equal(deltaTone(tile('habits').delta, tile('habits').good), 'good');
  assert.equal(tile('workouts').value, '2');
  assert.equal(tile('workouts').delta.diff, 1);
  assert.equal(tile('spend').value, '$75');
  assert.equal(tile('spend').delta.dir, 'down');
  assert.equal(deltaTone(tile('spend').delta, tile('spend').good), 'good'); // spending less is an improvement
  assert.equal(tile('overdue').value, '1');
  assert.equal(tile('streak').value, '4d');
  assert.equal(tile('tasks').value, '1/3');
});

test('weekKpis on an empty account shows only the always-on tiles', () => {
  const { tiles } = weekKpis({ today: NOW });
  assert.deepEqual(tiles.map((t) => t.id), ['tasks', 'overdue', 'workouts']);
  assert.equal(tiles[0].value, '0');
});

test('deltaTone', () => {
  assert.equal(deltaTone({ dir: 'up' }, 'up'), 'good');
  assert.equal(deltaTone({ dir: 'down' }, 'up'), 'bad');
  assert.equal(deltaTone({ dir: 'down' }, 'down'), 'good');
  assert.equal(deltaTone({ dir: 'flat' }, 'up'), 'flat');
  assert.equal(deltaTone(null), 'flat');
});

/* ---------------- work ---------------- */
test('projectProgress: completion per project, most urgent first, complete projects hidden', () => {
  const projects = [
    { id: 'p2', name: 'Unlinked', status: 'Active' },
    { id: 'p1', name: 'Linked', status: 'Active', todo_board_id: 'b1', color: '#fff' },
    { id: 'p3', name: 'Shipped', status: 'Complete', todo_board_id: 'b1' },
  ];
  const rows = projectProgress({ projects, tasks, boards, today: NOW });
  assert.deepEqual(rows.map((r) => r.id), ['p1', 'p2']);
  assert.deepEqual(
    { total: rows[0].total, done: rows[0].done, open: rows[0].open, overdue: rows[0].overdue, pct: rows[0].pct, next: rows[0].next.id },
    { total: 5, done: 1, open: 4, overdue: 1, pct: 20, next: 'overdue' }
  );
  assert.deepEqual({ total: rows[1].total, pct: rows[1].pct, linked: rows[1].linked }, { total: 0, pct: null, linked: false });
  assert.equal(projectProgress({ projects, tasks, boards, today: NOW, includeComplete: true }).length, 3);
});

test('crmFollowups: hottest and longest-untouched first, cadence by temperature', () => {
  const contacts = [
    { id: 'A', business_name: 'A', lead_temp: 'Hot', last_touch: '2026-09-25' }, // 6d, cadence 3
    { id: 'B', business_name: 'B', lead_temp: 'Warm', last_touch: '2026-09-30' }, // fresh
    { id: 'C', business_name: 'C', lead_temp: 'Cold' }, // never
    { id: 'D', business_name: 'D', lead_temp: 'Cold', last_touch: '2026-09-10' }, // 21d
    { id: 'E', business_name: 'E', lead_temp: 'Hot' }, // never
  ];
  const r = crmFollowups({ contacts, today: NOW });
  assert.deepEqual(r.queue.map((q) => q.id), ['E', 'A', 'C', 'D']);
  assert.deepEqual(r.byTemp, { Hot: 2, Warm: 1, Cold: 2 });
  assert.equal(r.neverTouched, 2);
  assert.equal(r.touchedThisWeek, 2);
  assert.equal(r.dueCount, 4);
  assert.equal(r.queue.find((q) => q.id === 'A').overdueBy, 3);
  assert.equal(crmFollowups({ contacts, today: NOW, limit: 2 }).queue.length, 2);
  assert.equal(crmFollowups({ today: NOW }).total, 0);
});

test('opportunityStats: counts, average fit and what closes soonest', () => {
  const rows = [
    { id: 'o1', status: 'new', title: 'One', deadline: '2026-10-10', score: 80 },
    { id: 'o2', status: 'saved', title: 'Two', deadline: '2026-10-05', score: 70 },
    { id: 'o3', status: 'new', title: 'Past', deadline: '2026-09-01', score: 60 },
    { id: 'o4', status: 'applied', title: 'Applied', deadline: '2026-10-03', score: 90 },
    { id: 'o5', status: 'new', title: 'Far', starts_on: '2027-03-01', score: 50 },
    { id: 'o6', status: 'dismissed', title: 'No', deadline: '2026-10-02', score: 99 },
  ];
  const s = opportunityStats({ rows, today: NOW });
  assert.deepEqual(s.counts, { new: 3, saved: 1, applied: 1, dismissed: 1 });
  assert.equal(s.liveCount, 4);
  assert.equal(s.avgScore, 65);
  assert.deepEqual(s.closing.map((o) => [o.id, o.days, o.kind]), [['o2', 4, 'deadline'], ['o1', 9, 'deadline']]);
  assert.equal(opportunityStats({ rows, today: NOW, soonDays: 400 }).closing.at(-1).kind, 'starts');
});

/* ---------------- finance ---------------- */
const accounts = [
  { type: 'Checking', balance: 5000 }, { type: 'Savings', balance: 10000 }, { type: 'Investment', balance: 20000 }, { type: 'Liability', balance: 3000 },
];
const categories = [{ id: 'c1', name: 'Food', budgeted: 1000 }, { id: 'c2', name: 'Gas', budgeted: 500 }];
const income = [{ amount: 4000, frequency: 'Monthly' }];

test('financeKpis: net worth, 30-day change, month spend vs budget, savings rate', () => {
  const snapshots = [{ snapshot_date: '2026-08-15', total: 28000 }, { snapshot_date: '2026-09-20', total: 30000 }];
  const txns = [{ amount: 100, date: '2026-10-01', category_id: 'c1' }, { amount: 2000, date: '2026-09-10', category_id: 'c1' }];
  const k = financeKpis({ accounts, snapshots, income, categories, txns, today: NOW });
  assert.deepEqual(
    { netWorth: k.netWorth, liquid: k.liquid, debt: k.debt, change: k.change, since: k.changeSince, spent: k.spent, lastSpent: k.lastSpent, budget: k.budget, budgetPct: k.budgetPct, remaining: k.remaining },
    { netWorth: 32000, liquid: 15000, debt: 3000, change: 4000, since: '2026-08-15', spent: 100, lastSpent: 2000, budget: 1500, budgetPct: 7, remaining: 1400 }
  );
  assert.equal(k.projected, null); // too early in the month to project
  assert.deepEqual(k.savings, { rate: 50, basis: 'last month' });
});

test('financeKpis projects the month once there is a trend, and flags a pace over budget', () => {
  const mid = new Date(2026, 9, 15, 12);
  const calm = financeKpis({ accounts, income, categories, txns: [{ amount: 600, date: '2026-10-05' }], today: mid });
  assert.equal(calm.projected, Math.round((600 / 15) * 31));
  assert.equal(calm.overBudgetPace, false);
  assert.deepEqual(calm.savings, { rate: Math.round(((4000 - calm.projected) / 4000) * 100), basis: 'projected' });
  const hot = financeKpis({ accounts, income, categories, txns: [{ amount: 900, date: '2026-10-05' }], today: mid });
  assert.equal(hot.overBudgetPace, true);
});

test('financeKpis has no change/savings without data and does not divide by zero', () => {
  const k = financeKpis({ today: NOW });
  assert.deepEqual([k.hasData, k.change, k.savings, k.budgetPct, k.remaining, k.netWorth], [false, null, null, null, null, 0]);
});

test('recentTransactions: newest first with category names', () => {
  const txns = [
    { id: 'a', amount: 5, date: '2026-09-30', category_id: 'c1', note: 'Lunch' },
    { id: 'b', amount: 40, date: '2026-10-01', category_id: 'c2' },
    { id: 'c', amount: 9, date: '2026-10-01', category_id: null, created_at: '2026-10-01T09:00:00Z' },
  ];
  const rows = recentTransactions({ txns, categories, limit: 2 });
  assert.deepEqual(rows.map((r) => r.id), ['c', 'b']);
  assert.deepEqual([rows[1].note, rows[1].category, rows[0].category], ['Gas', 'Gas', 'Uncategorized']);
});

test('categorySpend: this month by category with shares, long tails folded into "Everything else"', () => {
  const txns = [
    { amount: 100, date: '2026-10-01', category_id: 'c1' }, { amount: 50, date: '2026-10-01', category_id: 'c1' },
    { amount: 30, date: '2026-10-01', category_id: 'c2' }, { amount: 20, date: '2026-10-01', category_id: null },
    { amount: 999, date: '2026-09-30', category_id: 'c1' },
  ];
  const c = categorySpend({ txns, categories, today: NOW });
  assert.equal(c.total, 200);
  assert.deepEqual(c.rows.map((r) => [r.name, r.amount, r.share]), [['Food', 150, 75], ['Gas', 30, 15], ['Uncategorized', 20, 10]]);
  const folded = categorySpend({ txns, categories, today: NOW, limit: 2 });
  assert.deepEqual(folded.rows.map((r) => [r.name, r.amount, r.share]), [['Food', 150, 75], ['Everything else', 50, 25]]);
});

test('holdingMovers: gainers, losers and the day’s total move from live quotes', () => {
  const holdings = [
    { id: '1', ticker: 'AAPL', shares: 10 }, { id: '2', ticker: 'MSFT', shares: 5 },
    { id: '3', ticker: 'TSLA', shares: 2 }, { id: '4', ticker: 'NOPE', shares: 1 }, { id: '5', ticker: 'ZERO', shares: 0 },
  ];
  const prices = { AAPL: { price: 100, change: 2 }, MSFT: { price: 200, change: -1 }, TSLA: { price: 300, change: 5 }, ZERO: { price: 1, change: 1 } };
  const m = holdingMovers({ holdings, prices });
  assert.deepEqual(m.rows.map((r) => r.ticker), ['TSLA', 'AAPL', 'MSFT']);
  assert.deepEqual(m.gainers.map((r) => r.ticker), ['TSLA', 'AAPL']);
  assert.deepEqual(m.losers.map((r) => r.ticker), ['MSFT']);
  assert.equal(Math.round(m.rows[1].dayGain * 100) / 100, Math.round((1000 - 1000 / 1.02) * 100) / 100);
  assert.equal(m.total, 1000 + 1000 + 600);
});

test('dividendStats: year to date, trailing 12 months, last payment, upcoming', () => {
  const holdings = [{ id: 'h1', ticker: 'VYM' }];
  const dividends = [
    { amount: 10, paid_date: '2026-09-15', holding_id: 'h1' }, { amount: 20, paid_date: '2026-03-01', holding_id: 'h1' },
    { amount: 30, paid_date: '2025-12-01', holding_id: 'h1' }, { amount: 99, paid_date: '2024-01-01', holding_id: 'h1' },
    { amount: 40, paid_date: '2026-11-15', holding_id: 'h1' },
  ];
  const d = dividendStats({ dividends, holdings, today: NOW });
  assert.deepEqual([d.ytd, d.t12, d.monthlyAvg], [30, 60, 5]);
  assert.deepEqual(d.last, { amount: 10, date: '2026-09-15', ticker: 'VYM' });
  assert.deepEqual(d.upcoming.map((u) => u.amount), [40]);
  assert.equal(d.series.length, 12);
  assert.deepEqual([d.series[0].key, d.series.at(-1).key], ['2025-11', '2026-10']);
  assert.equal(d.series.find((s) => s.key === '2026-09').amount, 10);
  assert.equal(dividendStats({ today: NOW }).last, null);
});

/* ---------------- health ---------------- */
test('supplementChecklist: grouped by time of day, taken today, low stock', () => {
  const supplements = [
    { id: 's1', name: 'A', timing: 'Morning' }, { id: 's2', name: 'B', timing: 'Morning', dose: '5mg' },
    { id: 's3', name: 'C', timing: 'Evening', units_remaining: 3 }, { id: 's4', name: 'D', enabled: false },
    { id: 's5', name: 'E', timing: 'Whenever', units_remaining: 30 },
  ];
  const logs = [{ supplement_id: 's1', taken_at: at(2026, 10, 1, 8) }, { supplement_id: 's2', taken_at: at(2026, 9, 30, 8) }];
  const c = supplementChecklist({ supplements, logs, today: NOW });
  assert.deepEqual(c.groups.map((g) => [g.timing, g.total, g.taken]), [['Morning', 3, 1], ['Evening', 1, 0]]);
  assert.deepEqual([c.taken, c.total], [1, 4]);
  assert.deepEqual(c.low.map((i) => i.id), ['s3']);
  assert.equal(c.groups[0].items.find((i) => i.id === 's2').dose, '5mg');
});

const schedule = [
  { day_of_week: 'Mon', workout_type: 'Push' }, { day_of_week: 'Tue', workout_type: 'Pull' }, { day_of_week: 'Wed', workout_type: 'Rest' },
  { day_of_week: 'Thu', workout_type: 'Legs' }, { day_of_week: 'Fri', workout_type: 'Cardio' },
];
test('weekTraining: planned vs done across Mon–Sun, flags missed past sessions', () => {
  const logs = [{ completed_at: at(2026, 9, 28), workout_type: 'Push' }];
  const w = weekTraining({ schedule, logs, today: NOW });
  assert.deepEqual(w.days.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual([w.planned, w.done, w.missed], [4, 1, 1]);
  assert.deepEqual(w.days.map((d) => [d.done, d.missed, d.rest, d.isToday]).slice(0, 4), [[true, false, false, false], [false, true, false, false], [false, false, true, false], [false, false, false, true]]);
});

test('healthKpis: weight change vs a week ago, training, calories and protein vs goal', () => {
  const weights = [
    { logged_at: at(2026, 9, 20), weight: 180 }, { logged_at: at(2026, 9, 24), weight: 178 },
    { logged_at: at(2026, 9, 30), weight: 177 }, { logged_at: at(2026, 10, 1), weight: 176.4 },
  ];
  const nutrition = [{ logged_at: at(2026, 9, 30, 9), calories: 1000, protein: 80 }, { logged_at: at(2026, 9, 30, 19), calories: 1200, protein: 90 }];
  const h = healthKpis({ weights, workouts: [{ completed_at: at(2026, 9, 28) }], schedule, nutrition, goals: [{ calories: 2500, protein: 180 }], today: NOW });
  assert.deepEqual(h.weight, { latest: 176.4, change: -1.6, since: '2026-09-24', on: '2026-10-01' });
  assert.deepEqual(h.training, { done: 1, planned: 4, last7: 1, prev7: 0 });
  assert.deepEqual(h.calories, { avg: 2200, goal: 2500, days: 1 });
  assert.deepEqual(h.protein, { avg: 170, goal: 180 });
  assert.equal(healthKpis({ today: NOW }).weight, null);
  // A single weigh-in has nothing to compare against.
  assert.equal(healthKpis({ weights: [weights[3]], today: NOW }).weight.change, null);
});

/* ---------------- habits ---------------- */
test('longestRun finds the longest consecutive run, ignoring duplicates and order', () => {
  assert.equal(longestRun(['2026-09-04', '2026-09-01', '2026-09-02', '2026-09-02']), 2);
  assert.equal(longestRun(['2026-02-28', '2026-03-01']), 2);
  assert.equal(longestRun([]), 0);
});

test('streakBoard: current + best streak and 30-day rate per habit', () => {
  const habits = [{ id: 'h2', name: 'Run', created_at: '2026-01-01T00:00:00Z' }, { id: 'h1', name: 'Read', created_at: '2026-01-01T00:00:00Z' }, { id: 'h3', name: 'Off', active: false }];
  const days = [];
  for (let d = 1; d <= 10; d += 1) days.push(`2026-09-${String(d).padStart(2, '0')}`);
  const logs = [...days, '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((d) => ({ habit_id: 'h1', log_date: d, completed: true }));
  logs.push({ habit_id: 'h2', log_date: '2026-10-01', completed: true });
  const b = streakBoard({ habits, logs, today: NOW });
  assert.deepEqual(b.rows.map((r) => r.id), ['h1', 'h2']);
  assert.deepEqual(
    { current: b.rows[0].current, best: b.rows[0].best, rate30: b.rows[0].rate30, total: b.rows[0].total, doneToday: b.rows[0].doneToday },
    { current: 4, best: 10, rate30: 43, total: 14, doneToday: true }
  );
  assert.deepEqual([b.rows[1].current, b.rows[1].best], [1, 1]);
  assert.equal(b.longest.id, 'h1');
});

test('habitHeatmap: Mon–Sun columns shaded by share of habits done, future days blank', () => {
  const habits = [{ id: 'h1', created_at: '2026-01-01T00:00:00Z' }, { id: 'h2', created_at: '2026-01-01T00:00:00Z' }];
  const logs = [
    { habit_id: 'h1', log_date: '2026-09-28', completed: true }, { habit_id: 'h2', log_date: '2026-09-28', completed: true },
    { habit_id: 'h1', log_date: '2026-10-01', completed: true },
  ];
  const m = habitHeatmap({ habits, logs, today: NOW, weeks: 2 });
  assert.equal(m.weeks.length, 2);
  assert.deepEqual(m.weeks.map((w) => w.label), ['Sep', '']);
  const cell = (key) => m.weeks.flatMap((w) => w.cells).find((c) => c.key === key);
  assert.equal(m.weeks[0].cells[0].key, '2026-09-21');
  assert.deepEqual([cell('2026-09-28').level, cell('2026-09-28').done], [4, 2]);
  assert.deepEqual([cell('2026-10-01').level, cell('2026-10-01').done, cell('2026-10-01').possible], [2, 1, 2]);
  assert.deepEqual([cell('2026-09-29').level, cell('2026-09-29').future], [0, false]);
  assert.deepEqual([cell('2026-10-02').future, cell('2026-10-02').level], [true, 0]);
  assert.deepEqual([m.total, m.bestDay, m.activeCount], [3, 2, 2]);
});

test('habitHeatmap does not count a habit before it existed', () => {
  const habits = [{ id: 'h1', created_at: '2026-09-30T10:00:00' }];
  const m = habitHeatmap({ habits, logs: [], today: NOW, weeks: 1 });
  assert.equal(m.weeks[0].cells.find((c) => c.key === '2026-09-29').possible, 0);
  assert.equal(m.weeks[0].cells.find((c) => c.key === '2026-09-30').possible, 1);
});

/* ---------------- launcher links ---------------- */
test('normalizeLink: only safe links get through', () => {
  assert.deepEqual(normalizeLink('/todo'), { ok: true, url: '/todo', internal: true, host: 'CTRLpanel' });
  assert.deepEqual(normalizeLink('example.com'), { ok: true, url: 'https://example.com/', internal: false, host: 'example.com' });
  assert.equal(normalizeLink('http://www.foo.org/a?b=1').host, 'foo.org');
  assert.equal(normalizeLink('localhost:3000').ok, true);
  assert.equal(normalizeLink('http://localhost:3000/x').ok, true);
  for (const bad of ['', '   ', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'ftp://x.com', 'mailto:a@b.com', 'file:///etc/passwd', 'nodots', 'http://']) {
    assert.equal(normalizeLink(bad).ok, false, `should reject ${JSON.stringify(bad)}`);
  }
});
