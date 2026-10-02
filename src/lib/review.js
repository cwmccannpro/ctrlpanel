// Weekly review: pure stats over the rows the app already stores (no React, no network),
// so every number can be unit-tested. A "week" here is a rolling window — the last 7 days
// ending today, compared with the 7 before — so the review is useful on any day, not only
// on Sunday. Days are LOCAL calendar days (see dayKey): never UTC.
import { dayKey } from './helpers.js';
import { currentStreak } from './habits.js';
import { doneColumn } from './commandPalette.js';

const DAY_MS = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** ISO-8601 week (Monday start; week 1 holds Jan 4th) for a local date. */
export function isoWeek(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // the Thursday of this week
  const year = d.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((d - jan4) / DAY_MS - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { year, week };
}

/** "2026-W40" */
export function weekLabel(date) {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Day-key lists for the review: last 7 days, the 7 before, and the 7 after today. */
export function reviewWindows(today = new Date()) {
  const t = startOfDay(today);
  const keys = (from, n) => Array.from({ length: n }, (_, i) => dayKey(addDays(from, i)));
  const current = keys(addDays(t, -6), 7);
  const previous = keys(addDays(t, -13), 7);
  const next = keys(addDays(t, 1), 7);
  return { today: dayKey(t), current, previous, next, from: current[0], to: current[6] };
}

/** A column value → local day key: date-only strings pass through, timestamps are read in local time. */
export function rowDay(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : dayKey(d);
}

const setOf = (keys) => new Set(keys);
const sum = (rows, pick) => rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);

/** Change between two numbers: `{ diff, pct, dir }` (dir is 'up' | 'down' | 'flat'). */
export function delta(current, previous) {
  const diff = round1((current ?? 0) - (previous ?? 0));
  return {
    diff,
    pct: previous ? Math.round(((current - previous) / previous) * 100) : null,
    dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
  };
}

/* ---------------- sections ---------------- */

export function habitStats({ habits = [], logs = [], windows }) {
  const active = habits.filter((h) => h.active !== false);
  const done = new Set(logs.filter((l) => l.completed !== false).map((l) => `${l.habit_id}|${l.log_date}`));
  const cur = setOf(windows.current);
  const prev = setOf(windows.previous);
  const per = active.map((h) => {
    const born = rowDay(h.created_at);
    // A habit can only be missed on days it existed.
    const count = (days) => {
      let possible = 0;
      let hit = 0;
      for (const d of days) {
        if (born && d < born) continue;
        possible += 1;
        if (done.has(`${h.id}|${d}`)) hit += 1;
      }
      return { hit, possible };
    };
    const c = count(windows.current);
    const p = count(windows.previous);
    return {
      id: h.id,
      name: h.name,
      done: c.hit,
      possible: c.possible,
      rate: pct(c.hit, c.possible),
      prevRate: pct(p.hit, p.possible),
      streak: currentStreak((dk) => done.has(`${h.id}|${dk}`), new Date(`${windows.today}T12:00:00`)),
    };
  });
  const totalHit = sum(per, (h) => h.done);
  const totalPossible = sum(per, (h) => h.possible);
  const prevHit = sum(active, (h) => windows.previous.filter((d) => (!rowDay(h.created_at) || d >= rowDay(h.created_at)) && done.has(`${h.id}|${d}`)).length);
  const prevPossible = sum(active, (h) => windows.previous.filter((d) => !rowDay(h.created_at) || d >= rowDay(h.created_at)).length);
  const ranked = per.filter((h) => h.rate !== null).sort((a, b) => b.rate - a.rate || b.streak - a.streak);
  return {
    count: active.length,
    rate: pct(totalHit, totalPossible),
    prevRate: pct(prevHit, prevPossible),
    habits: per,
    best: ranked[0] || null,
    needsWork: ranked.length > 1 ? ranked.at(-1) : null,
    longestStreak: per.reduce((m, h) => (h.streak > (m?.streak || 0) ? h : m), null),
    daysTracked: [...cur].filter((d) => active.some((h) => done.has(`${h.id}|${d}`))).length,
    prevDaysTracked: [...prev].filter((d) => active.some((h) => done.has(`${h.id}|${d}`))).length,
  };
}

export function taskStats({ tasks = [], boards = [], windows }) {
  const boardById = Object.fromEntries(boards.map((b) => [b.id, b]));
  const isDone = (t) => {
    const col = t.column_name || '';
    return col === 'Done' || col === doneColumn(boardById[t.board_id]);
  };
  const dueIn = (days) => {
    const s = setOf(days);
    const rows = tasks.filter((t) => t.due_date && s.has(rowDay(t.due_date)));
    return { total: rows.length, done: rows.filter(isDone).length };
  };
  const open = tasks.filter((t) => !isDone(t));
  const byDue = (a, b) => String(a.due_date).localeCompare(String(b.due_date));
  const nextSet = setOf([windows.today, ...windows.next]);
  const created = (days) => {
    const s = setOf(days);
    return tasks.filter((t) => s.has(rowDay(t.created_at))).length;
  };
  return {
    overdue: open.filter((t) => t.due_date && rowDay(t.due_date) < windows.today).sort(byDue),
    dueThisWeek: dueIn(windows.current),
    dueLastWeek: dueIn(windows.previous),
    upcoming: open.filter((t) => t.due_date && nextSet.has(rowDay(t.due_date))).sort(byDue),
    createdThisWeek: created(windows.current),
    createdLastWeek: created(windows.previous),
    openCount: open.length,
  };
}

export function workoutStats({ logs = [], windows }) {
  const inWin = (days) => {
    const s = setOf(days);
    return logs.filter((l) => s.has(rowDay(l.completed_at)));
  };
  const cur = inWin(windows.current);
  const types = {};
  cur.forEach((l) => { types[l.workout_type || 'Workout'] = (types[l.workout_type || 'Workout'] || 0) + 1; });
  return {
    count: cur.length,
    prevCount: inWin(windows.previous).length,
    activeDays: new Set(cur.map((l) => rowDay(l.completed_at))).size,
    types,
  };
}

export function nutritionStats({ logs = [], goals = [], windows }) {
  const goal = goals[0] || null;
  const summarize = (days) => {
    const s = setOf(days);
    const rows = logs.filter((l) => s.has(rowDay(l.logged_at)));
    const byDay = {};
    rows.forEach((l) => {
      const d = rowDay(l.logged_at);
      byDay[d] = byDay[d] || { calories: 0, protein: 0 };
      byDay[d].calories += Number(l.calories) || 0;
      byDay[d].protein += Number(l.protein) || 0;
    });
    const loggedDays = Object.keys(byDay).length;
    return {
      loggedDays,
      avgCalories: loggedDays ? Math.round(sum(Object.values(byDay), (d) => d.calories) / loggedDays) : null,
      avgProtein: loggedDays ? Math.round(sum(Object.values(byDay), (d) => d.protein) / loggedDays) : null,
    };
  };
  const cur = summarize(windows.current);
  return {
    ...cur,
    prev: summarize(windows.previous),
    goalCalories: goal ? Number(goal.calories) || null : null,
    goalProtein: goal ? Number(goal.protein) || null : null,
  };
}

export function weightStats({ logs = [], windows }) {
  const inWin = (days) => {
    const s = setOf(days);
    return logs
      .filter((l) => s.has(rowDay(l.logged_at)))
      .sort((a, b) => String(a.logged_at).localeCompare(String(b.logged_at)));
  };
  const cur = inWin(windows.current);
  const prev = inWin(windows.previous);
  const avg = (rows) => (rows.length ? round2(sum(rows, (r) => r.weight) / rows.length) : null);
  return {
    entries: cur.length,
    first: cur.length ? round2(Number(cur[0].weight)) : null,
    last: cur.length ? round2(Number(cur.at(-1).weight)) : null,
    change: cur.length > 1 ? round2(Number(cur.at(-1).weight) - Number(cur[0].weight)) : null,
    avg: avg(cur),
    prevAvg: avg(prev),
  };
}

export function spendStats({ transactions = [], categories = [], windows }) {
  const inWin = (days) => {
    const s = setOf(days);
    return transactions.filter((t) => s.has(rowDay(t.date)));
  };
  const cur = inWin(windows.current);
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const byCat = {};
  cur.forEach((t) => { byCat[t.category_id] = (byCat[t.category_id] || 0) + (Number(t.amount) || 0); });
  const monthlyBudget = sum(categories, (c) => c.budgeted);
  return {
    total: Math.round(sum(cur, (t) => t.amount) * 100) / 100,
    prevTotal: Math.round(sum(inWin(windows.previous), (t) => t.amount) * 100) / 100,
    count: cur.length,
    top: Object.entries(byCat)
      .map(([id, amount]) => ({ name: names[id] || 'Uncategorized', amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3),
    // A month's budget spread over a week (12 months / 52 weeks).
    weeklyBudget: monthlyBudget ? Math.round(((monthlyBudget * 12) / 52) * 100) / 100 : null,
  };
}

export function noteStats({ notes = [], windows }) {
  const s = setOf(windows.current);
  const made = notes.filter((n) => s.has(rowDay(n.created_at)));
  return { count: made.length, titles: made.slice(0, 5).map((n) => n.title) };
}

/** Events starting today through the next 7 days, soonest first. */
export function upcomingEvents(events = [], windows) {
  const s = setOf([windows.today, ...windows.next]);
  return events
    .filter((e) => s.has(rowDay(e.starts_at)))
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
}

/** Everything the review page and the note template need, from raw table rows. */
export function buildReview({ today = new Date(), habits, habitLogs, tasks, boards, workouts, nutrition, goals, weights, transactions, categories, notes, events }) {
  const windows = reviewWindows(today);
  return {
    windows,
    label: weekLabel(today),
    habits: habitStats({ habits, logs: habitLogs, windows }),
    tasks: taskStats({ tasks, boards, windows }),
    workouts: workoutStats({ logs: workouts, windows }),
    nutrition: nutritionStats({ logs: nutrition, goals, windows }),
    weight: weightStats({ logs: weights, windows }),
    spend: spendStats({ transactions, categories, windows }),
    notes: noteStats({ notes, windows }),
    events: upcomingEvents(events, windows),
  };
}

/* ---------------- the review note ---------------- */

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const shortDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const longDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export const reviewNoteTitle = (review) => `Weekly review ${review.label}`;

/** Markdown for a new Knowledge note: the week's numbers filled in, reflection prompts left blank. */
export function reviewNoteTemplate(review) {
  const { windows: w, habits, tasks, workouts, nutrition, weight, spend, notes, events } = review;
  const lines = [`# ${reviewNoteTitle(review)}`, `_${shortDate(w.from)} – ${shortDate(w.to)}_`, '', '## By the numbers'];

  if (habits.count) {
    const vs = habits.prevRate !== null ? ` (last week ${habits.prevRate}%)` : '';
    const best = habits.longestStreak?.streak >= 2 ? ` · longest streak: ${habits.longestStreak.name} (${habits.longestStreak.streak} days)` : '';
    lines.push(`- **Habits:** ${habits.rate ?? 0}% completed${vs}${best}`);
  }
  lines.push(`- **Tasks:** ${tasks.dueThisWeek.total} due this week, ${tasks.dueThisWeek.done} done · ${tasks.overdue.length} overdue now`);
  lines.push(`- **Training:** ${workouts.count} workout${workouts.count === 1 ? '' : 's'} (last week ${workouts.prevCount})`);
  if (nutrition.loggedDays) {
    const goal = nutrition.goalCalories ? ` vs goal ${nutrition.goalCalories.toLocaleString('en-US')}` : '';
    lines.push(`- **Nutrition:** avg ${nutrition.avgCalories.toLocaleString('en-US')} kcal/day over ${nutrition.loggedDays} logged day${nutrition.loggedDays === 1 ? '' : 's'}${goal}`);
  }
  if (weight.entries) {
    const move = weight.change === null ? '' : ` (${weight.change > 0 ? '+' : weight.change < 0 ? '−' : '±'}${Math.abs(weight.change)})`;
    lines.push(`- **Weight:** ${weight.first} → ${weight.last}${move}`);
  }
  if (spend.count) {
    const budget = spend.weeklyBudget ? ` · weekly budget ${money(spend.weeklyBudget)}` : '';
    lines.push(`- **Spending:** ${money(spend.total)} (last week ${money(spend.prevTotal)})${budget}`);
  }
  lines.push(`- **Notes written:** ${notes.count}`);

  lines.push('', '## Wins', '- ', '', '## Lessons', '- ', '', "## Next week's focus", '- ');

  if (tasks.overdue.length || tasks.upcoming.length || events.length) {
    lines.push('', '## Coming up');
    tasks.overdue.slice(0, 5).forEach((t) => lines.push(`- [ ] **Overdue** · ${t.title} (was due ${shortDate(rowDay(t.due_date))})`));
    tasks.upcoming.slice(0, 8).forEach((t) => lines.push(`- [ ] ${t.title} — ${longDay(rowDay(t.due_date))}${t.priority && t.priority !== 'Medium' ? ` (${t.priority})` : ''}`));
    events.slice(0, 6).forEach((e) => lines.push(`- ${longDay(rowDay(e.starts_at))} · ${e.title}`));
  }
  return `${lines.join('\n')}\n`;
}
