// Pure KPI / list logic behind the dashboard panels (no React, no network), so every
// number on the dashboard can be unit-tested. Panels fetch rows and hand them to these
// functions. Days are LOCAL calendar days (dayKey / rowDay) — never `toISOString().slice(0,10)`.
import { dayKey, currency } from './helpers.js';
import { currentStreak } from './habits.js';
import { doneColumn } from './commandPalette.js';
import { eventsForDay } from './calendarView.js';
import {
  rowDay, reviewWindows, isoWeek, delta, habitStats, taskStats, workoutStats, nutritionStats, spendStats,
} from './review.js';

const DAY_MS = 86400000;
const dayNum = (key) => {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
/** Whole calendar days from one day key to another (DST-proof). */
export const daysBetween = (fromKey, toKey) => dayNum(toKey) - dayNum(fromKey);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
};
const sum = (rows, pick) => rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const byPriority = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
  String(a.created_at || '').localeCompare(String(b.created_at || ''));
const byDueThenPriority = (a, b) => String(rowDay(a.due_date)).localeCompare(String(rowDay(b.due_date))) || byPriority(a, b);

const real = (id) => id && !String(id).startsWith('tmp-');

/* ============================================================
   Tasks
   ============================================================ */
const boardIndex = (boards = []) => Object.fromEntries(boards.filter((b) => real(b.id)).map((b) => [b.id, b]));

/** A task is done when it sits in its board's "Done" column (or the board's last column). */
export function isTaskDone(task, boardById = {}) {
  const col = task.column_name || '';
  return col === 'Done' || col === doneColumn(boardById[task.board_id]);
}

/** Headline numbers for the To Do list: what is open, due, late, undated, high priority. */
export function taskKpis({ tasks = [], boards = [], today = new Date() }) {
  const t = dayKey(today);
  const byId = boardIndex(boards);
  const open = tasks.filter((x) => !isTaskDone(x, byId));
  const week = new Set(reviewWindows(today).current);
  const dueWeek = tasks.filter((x) => x.due_date && week.has(rowDay(x.due_date)));
  const doneWeek = dueWeek.filter((x) => isTaskDone(x, byId)).length;
  return {
    total: tasks.length,
    open: open.length,
    dueToday: open.filter((x) => x.due_date && rowDay(x.due_date) === t).length,
    overdue: open.filter((x) => x.due_date && rowDay(x.due_date) < t).length,
    noDate: open.filter((x) => !x.due_date).length,
    highPriority: open.filter((x) => x.priority === 'Urgent' || x.priority === 'High').length,
    dueWeek: dueWeek.length,
    doneWeek,
    rate: pct(doneWeek, dueWeek.length),
  };
}

export const TASK_FILTERS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'priority', label: 'High priority' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'inbox', label: 'No date' },
];

/** A focused list of open tasks: overdue, high priority, due in the next 7 days, or undated. */
export function focusTasks({ tasks = [], boards = [], filter = 'overdue', today = new Date(), limit = 12 }) {
  const t = dayKey(today);
  const byId = boardIndex(boards);
  const open = tasks.filter((x) => !isTaskDone(x, byId));
  const due = (x) => rowDay(x.due_date);
  const horizon = dayKey(addDays(today, 6));
  let rows;
  if (filter === 'priority') {
    rows = open.filter((x) => x.priority === 'Urgent' || x.priority === 'High').sort(byPriority);
    rows.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (due(a) || '9').localeCompare(due(b) || '9'));
  } else if (filter === 'week') {
    rows = open.filter((x) => x.due_date && due(x) >= t && due(x) <= horizon).sort(byDueThenPriority);
  } else if (filter === 'inbox') {
    rows = open.filter((x) => !x.due_date).sort(byPriority);
  } else {
    rows = open.filter((x) => x.due_date && due(x) < t).sort(byDueThenPriority);
  }
  return { total: rows.length, items: rows.slice(0, limit) };
}

/* ============================================================
   Time
   ============================================================ */
/** How far through the day / week (Mon–Sun) / month / quarter / year we are. */
export function timeProgress(now = new Date()) {
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const within = (start, end) => clampPct(((now - start) / (end - start)) * 100);
  const dow = (now.getDay() + 6) % 7;
  const qStart = Math.floor(mo / 3) * 3;
  const today = dayKey(now);
  const yearStart = `${y}-01-01`;
  const daysInYear = daysBetween(yearStart, `${y + 1}-01-01`);
  const dayOfYear = daysBetween(yearStart, today) + 1;
  return {
    week: isoWeek(now).week,
    quarter: Math.floor(mo / 3) + 1,
    dayOfYear,
    daysInYear,
    rows: [
      { id: 'day', label: 'Day', pct: within(new Date(y, mo, d), new Date(y, mo, d + 1)), left: `${Math.max(0, 24 - now.getHours() - 1)}h left` },
      { id: 'week', label: 'Week', pct: within(new Date(y, mo, d - dow), new Date(y, mo, d - dow + 7)), left: `${6 - dow}d left` },
      { id: 'month', label: 'Month', pct: within(new Date(y, mo, 1), new Date(y, mo + 1, 1)), left: `${new Date(y, mo + 1, 0).getDate() - d}d left` },
      { id: 'quarter', label: `Q${Math.floor(mo / 3) + 1}`, pct: within(new Date(y, qStart, 1), new Date(y, qStart + 3, 1)), left: `${daysBetween(today, dayKey(new Date(y, qStart + 3, 1))) - 1}d left` },
      { id: 'year', label: String(y), pct: within(new Date(y, 0, 1), new Date(y + 1, 0, 1)), left: `${daysInYear - dayOfYear}d left` },
    ],
  };
}

/** "2h 15m", "12m", "3d 4h" — a duration for countdowns (no "in"). */
export function formatCountdown(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const isAllDay = (e) => Boolean(e.all_day) || DATE_ONLY.test(String(e.starts_at || ''));

/**
 * The event happening now and the next one(s) after it. All-day events are not "next up".
 * `startsInMs` / `endsInMs` are measured from `now`.
 */
export function nextEvent({ events = [], now = new Date(), following = 2 } = {}) {
  const t = now.getTime();
  const timed = events
    .filter((e) => e.starts_at && !isAllDay(e))
    .map((e) => {
      const start = Date.parse(e.starts_at);
      const end = e.ends_at ? Date.parse(e.ends_at) : start;
      return { e, start, end };
    })
    .filter((x) => Number.isFinite(x.start) && (x.end > t || x.start >= t))
    .sort((a, b) => a.start - b.start);
  const current = timed.find((x) => x.start <= t && x.end > t) || null;
  const upcoming = timed.filter((x) => x.start > t);
  return {
    current: current ? current.e : null,
    endsInMs: current ? current.end - t : null,
    next: upcoming[0]?.e || null,
    startsInMs: upcoming[0] ? upcoming[0].start - t : null,
    following: upcoming.slice(1, 1 + following).map((x) => x.e),
  };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The next `days` days (today first) with each day's events and open tasks, plus what is overdue. */
export function agendaDays({ events = [], tasks = [], boards = [], today = new Date(), days = 7 }) {
  const t = dayKey(today);
  const byId = boardIndex(boards);
  const open = tasks.filter((x) => x.due_date && !isTaskDone(x, byId));
  const out = Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const key = dayKey(date);
    return {
      key,
      date,
      isToday: i === 0,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${WEEKDAY[date.getDay()]} ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      events: eventsForDay(events, date),
      tasks: open.filter((x) => rowDay(x.due_date) === key).sort(byPriority),
    };
  });
  return {
    overdue: open.filter((x) => rowDay(x.due_date) < t).sort(byDueThenPriority),
    days: out,
    count: sum(out, (d) => d.events.length + d.tasks.length),
  };
}

/** Countdown rows for a list of `{ id, label, date }`, soonest first; past dates sink to the end. */
export function countdowns(items = [], today = new Date()) {
  const t = dayKey(today);
  return items
    .filter((i) => i && DATE_ONLY.test(String(i.date || '')))
    .map((i) => {
      const days = daysBetween(t, i.date);
      return { ...i, days, past: days < 0, tone: days < 0 ? 'past' : days <= 7 ? 'soon' : 'later' };
    })
    .sort((a, b) => Number(a.past) - Number(b.past) || (a.past ? b.days - a.days : a.days - b.days));
}

/* ============================================================
   Week at a glance (reuses the weekly-review stats)
   ============================================================ */
/**
 * Tone of a change: `good` names the direction that is an improvement ('up' | 'down').
 * Returns 'good' | 'bad' | 'flat'.
 */
export function deltaTone(d, good = 'up') {
  if (!d || d.dir === 'flat') return 'flat';
  return d.dir === good ? 'good' : 'bad';
}

/** KPI tiles for the last 7 days vs the 7 before, only for the areas that have data. */
export function weekKpis({ habits = [], habitLogs = [], tasks = [], boards = [], workouts = [], transactions = [], categories = [], today = new Date() }) {
  const windows = reviewWindows(today);
  const h = habitStats({ habits, logs: habitLogs, windows });
  const t = taskStats({ tasks, boards, windows });
  const w = workoutStats({ logs: workouts, windows });
  const s = spendStats({ transactions, categories, windows });
  const tiles = [];

  if (h.count) {
    tiles.push({
      id: 'habits', label: 'Habits', value: h.rate === null ? '—' : `${h.rate}%`, sub: 'completed',
      delta: h.rate !== null && h.prevRate !== null ? delta(h.rate, h.prevRate) : null, unit: ' pts', good: 'up', to: '/habits',
    });
  }
  tiles.push({
    id: 'tasks', label: 'Tasks', value: t.dueThisWeek.total ? `${t.dueThisWeek.done}/${t.dueThisWeek.total}` : `${t.openCount}`,
    sub: t.dueThisWeek.total ? 'due this week, done' : 'open',
    delta: t.dueThisWeek.total || t.dueLastWeek.total ? delta(t.dueThisWeek.done, t.dueLastWeek.done) : null, unit: ' done', good: 'up', to: '/todo',
  });
  tiles.push({ id: 'overdue', label: 'Overdue', value: String(t.overdue.length), sub: t.overdue.length ? 'need a decision' : 'all caught up', delta: null, good: 'down', to: '/todo' });
  tiles.push({ id: 'workouts', label: 'Workouts', value: String(w.count), sub: `${w.activeDays} active day${w.activeDays === 1 ? '' : 's'}`, delta: w.count || w.prevCount ? delta(w.count, w.prevCount) : null, unit: '', good: 'up', to: '/health#fitness' });
  if (s.count || s.prevTotal) {
    tiles.push({
      id: 'spend', label: 'Spend', value: currency(s.total), sub: s.weeklyBudget ? `of ~${currency(s.weeklyBudget)} / week` : 'last 7 days',
      delta: delta(s.total, s.prevTotal), unit: '$', good: 'down', to: '/finance/budget',
    });
  }
  if (h.longestStreak?.streak >= 2) {
    tiles.push({ id: 'streak', label: 'Best streak', value: `${h.longestStreak.streak}d`, sub: h.longestStreak.name, delta: null, good: 'up', to: '/habits' });
  }
  return { windows, tiles };
}

/* ============================================================
   Work
   ============================================================ */
/** Task completion per project (via the project's To Do board), most urgent first. */
export function projectProgress({ projects = [], tasks = [], boards = [], today = new Date(), includeComplete = false }) {
  const t = dayKey(today);
  const byId = boardIndex(boards);
  return projects
    .filter((p) => includeComplete || (p.status || 'Active') !== 'Complete')
    .map((p) => {
      const mine = p.todo_board_id ? tasks.filter((x) => x.board_id === p.todo_board_id) : [];
      const open = mine.filter((x) => !isTaskDone(x, byId));
      const overdue = open.filter((x) => x.due_date && rowDay(x.due_date) < t).length;
      const next = open.filter((x) => x.due_date).sort((a, b) => rowDay(a.due_date).localeCompare(rowDay(b.due_date)))[0] || null;
      return {
        id: p.id, name: p.name, color: p.color || null, status: p.status || 'Active',
        total: mine.length, open: open.length, done: mine.length - open.length, overdue,
        pct: pct(mine.length - open.length, mine.length), next,
        linked: Boolean(p.todo_board_id),
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || String(a.name).localeCompare(String(b.name)));
}

/** How often each lead temperature should be touched (days). */
export const CRM_CADENCE = { Hot: 3, Warm: 7, Cold: 14 };

/** Who in the pipeline is due a follow-up: hottest and longest-untouched first. */
export function crmFollowups({ contacts = [], today = new Date(), limit = 6 }) {
  const t = dayKey(today);
  const rank = { Hot: 0, Warm: 1, Cold: 2 };
  const byTemp = { Hot: 0, Warm: 0, Cold: 0 };
  const rows = contacts.map((c) => {
    const touched = c.last_touch ? rowDay(c.last_touch) : '';
    const since = touched ? Math.max(0, daysBetween(touched, t)) : null;
    const temp = rank[c.lead_temp] !== undefined ? c.lead_temp : 'Cold';
    byTemp[temp] += 1;
    const every = CRM_CADENCE[temp];
    return {
      id: c.id, name: c.business_name || 'Untitled', service: c.service || '', temp, since,
      overdueBy: since === null ? null : Math.max(0, since - every),
      due: since === null || since >= every,
    };
  });
  const queue = rows
    .filter((r) => r.due)
    .sort((a, b) => rank[a.temp] - rank[b.temp] || (b.since ?? 9999) - (a.since ?? 9999) || a.name.localeCompare(b.name));
  return {
    total: contacts.length,
    byTemp,
    neverTouched: rows.filter((r) => r.since === null).length,
    touchedThisWeek: rows.filter((r) => r.since !== null && r.since <= 6).length,
    dueCount: queue.length,
    queue: queue.slice(0, limit),
  };
}

/** Opportunities Agent finds: status counts and what closes (or starts) soonest. */
export function opportunityStats({ rows = [], today = new Date(), soonDays = 30, limit = 5 }) {
  const t = dayKey(today);
  const counts = { new: 0, saved: 0, applied: 0, dismissed: 0 };
  rows.forEach((r) => { if (r.status in counts) counts[r.status] += 1; });
  const live = rows.filter((r) => r.status === 'new' || r.status === 'saved');
  const closing = live
    .map((r) => {
      const when = rowDay(r.deadline) || rowDay(r.starts_on);
      return { id: r.id, title: r.title, org: r.org || '', score: r.score || 0, status: r.status, url: r.url || null, when, kind: r.deadline ? 'deadline' : 'starts', days: when ? daysBetween(t, when) : null };
    })
    .filter((x) => x.when && x.days >= 0 && x.days <= soonDays)
    .sort((a, b) => a.days - b.days || b.score - a.score);
  return {
    counts,
    liveCount: live.length,
    avgScore: live.length ? Math.round(sum(live, (r) => r.score) / live.length) : null,
    closingCount: closing.length,
    closing: closing.slice(0, limit),
  };
}

/* ============================================================
   Finance
   ============================================================ */
export const MONTHLY_FACTOR = { Monthly: 1, 'Bi-Weekly': 26 / 12, Weekly: 52 / 12, Annual: 1 / 12 };
export const monthlyIncome = (rows = []) => rows.reduce((s, i) => s + Number(i.amount || 0) * (MONTHLY_FACTOR[i.frequency] ?? 1), 0);

const monthKey = (key) => String(key).slice(0, 7);

/** Net worth, month spending vs budget, projected month-end and savings rate. */
export function financeKpis({ accounts = [], snapshots = [], income = [], categories = [], txns = [], today = new Date() }) {
  const t = dayKey(today);
  const signed = (a) => (a.type === 'Liability' ? -Number(a.balance || 0) : Number(a.balance || 0));
  const netWorth = sum(accounts, signed);
  const liquid = sum(accounts.filter((a) => a.type === 'Checking' || a.type === 'Savings'), (a) => a.balance);
  const debt = sum(accounts.filter((a) => a.type === 'Liability'), (a) => a.balance);

  const snaps = snapshots.filter((s) => s.snapshot_date).sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const cutoff = dayKey(addDays(today, -30));
  const base = [...snaps].reverse().find((s) => s.snapshot_date <= cutoff) || snaps.find((s) => s.snapshot_date < t) || null;
  const change = base ? round2(netWorth - Number(base.total || 0)) : null;

  const ym = monthKey(t);
  const lastYm = monthKey(dayKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
  const spendIn = (key) => sum(txns.filter((x) => x.date && monthKey(rowDay(x.date)) === key), (x) => x.amount);
  const spent = round2(spendIn(ym));
  const lastSpent = round2(spendIn(lastYm));
  const budget = round2(sum(categories, (c) => c.budgeted));
  const day = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const burnPerDay = day ? spent / day : 0;
  // The first days of a month say little about the rest of it, so no projection before day 3.
  const projected = spent > 0 && day >= 3 ? Math.round(burnPerDay * daysInMonth) : null;
  const inc = round2(monthlyIncome(income));

  let savings = null;
  if (inc > 0 && lastSpent > 0) savings = { rate: Math.round(((inc - lastSpent) / inc) * 100), basis: 'last month' };
  else if (inc > 0 && projected !== null && day >= 7) savings = { rate: Math.round(((inc - projected) / inc) * 100), basis: 'projected' };

  return {
    hasAccounts: accounts.length > 0,
    netWorth: round2(netWorth),
    liquid: round2(liquid),
    debt: round2(debt),
    change,
    changeSince: base ? rowDay(base.snapshot_date) : null,
    income: inc,
    spent,
    lastSpent,
    budget,
    budgetPct: budget > 0 ? Math.round((spent / budget) * 100) : null,
    remaining: budget > 0 ? round2(budget - spent) : null,
    burnPerDay: round2(burnPerDay),
    projected,
    overBudgetPace: budget > 0 && projected !== null ? projected > budget : false,
    savings,
    hasData: accounts.length > 0 || income.length > 0 || categories.length > 0 || txns.length > 0,
  };
}

/** The newest transactions with their category names. */
export function recentTransactions({ txns = [], categories = [], limit = 6 }) {
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  return [...txns]
    .filter((x) => x.date)
    .sort((a, b) => rowDay(b.date).localeCompare(rowDay(a.date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, limit)
    .map((x) => ({ id: x.id, note: x.note || names[x.category_id] || 'Transaction', category: names[x.category_id] || 'Uncategorized', amount: Number(x.amount) || 0, date: rowDay(x.date), recurring: Boolean(x.recurring) }));
}

/** This month's spend by category, biggest first, with each category's share. */
export function categorySpend({ txns = [], categories = [], today = new Date(), limit = 6 }) {
  const ym = monthKey(dayKey(today));
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const by = {};
  txns.filter((x) => x.date && monthKey(rowDay(x.date)) === ym).forEach((x) => {
    const key = x.category_id || 'none';
    by[key] = (by[key] || 0) + (Number(x.amount) || 0);
  });
  const total = sum(Object.values(by), (n) => n);
  const rows = Object.entries(by)
    .map(([id, amount]) => ({ id, name: names[id] || 'Uncategorized', amount: round2(amount), share: total ? Math.round((amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  if (rows.length > limit) {
    const rest = rows.slice(limit - 1);
    const amount = round2(sum(rest, (r) => r.amount));
    rows.splice(limit - 1, rest.length, { id: 'other', name: 'Everything else', amount, share: total ? Math.round((amount / total) * 100) : 0 });
  }
  return { total: round2(total), rows };
}

/** Today's biggest movers among the holdings, from live quotes `{ [ticker]: { price, change% } }`. */
export function holdingMovers({ holdings = [], prices = {} }) {
  const rows = holdings
    .filter((h) => h.ticker && Number(h.shares) > 0 && prices[h.ticker]?.price != null)
    .map((h) => {
      const q = prices[h.ticker];
      const value = Number(h.shares) * Number(q.price);
      const change = Number(q.change) || 0;
      return { id: h.id, ticker: h.ticker, name: h.name || h.ticker, value, pct: change, dayGain: change ? value - value / (1 + change / 100) : 0 };
    })
    .sort((a, b) => b.pct - a.pct);
  const total = sum(rows, (r) => r.value);
  return {
    rows,
    total,
    dayGain: sum(rows, (r) => r.dayGain),
    gainers: rows.filter((r) => r.pct > 0).slice(0, 3),
    losers: rows.filter((r) => r.pct < 0).slice(-3).reverse(),
  };
}

/** Dividend income: year to date, trailing 12 months, last payment and a 12-month series. */
export function dividendStats({ dividends = [], holdings = [], today = new Date() }) {
  const t = dayKey(today);
  const tickers = Object.fromEntries(holdings.map((h) => [h.id, h.ticker]));
  const paid = dividends.filter((d) => d.paid_date && rowDay(d.paid_date) <= t);
  const upcoming = dividends.filter((d) => d.paid_date && rowDay(d.paid_date) > t).sort((a, b) => rowDay(a.paid_date).localeCompare(rowDay(b.paid_date)));
  const yearStart = `${today.getFullYear()}-01-01`;
  const yearAgo = dayKey(addDays(today, -365));
  const series = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (11 - i), 1);
    const key = monthKey(dayKey(d));
    return { key, label: d.toLocaleDateString('en-US', { month: 'short' }), amount: round2(sum(paid.filter((x) => monthKey(rowDay(x.paid_date)) === key), (x) => x.amount)) };
  });
  const last = [...paid].sort((a, b) => rowDay(b.paid_date).localeCompare(rowDay(a.paid_date)))[0] || null;
  const t12 = round2(sum(paid.filter((x) => rowDay(x.paid_date) > yearAgo), (x) => x.amount));
  return {
    count: dividends.length,
    ytd: round2(sum(paid.filter((x) => rowDay(x.paid_date) >= yearStart), (x) => x.amount)),
    t12,
    monthlyAvg: round2(t12 / 12),
    last: last ? { amount: Number(last.amount) || 0, date: rowDay(last.paid_date), ticker: tickers[last.holding_id] || '' } : null,
    upcoming: upcoming.slice(0, 3).map((x) => ({ amount: Number(x.amount) || 0, date: rowDay(x.paid_date), ticker: tickers[x.holding_id] || '' })),
    series,
  };
}

/* ============================================================
   Health
   ============================================================ */
const TIMINGS = ['Morning', 'Afternoon', 'Evening', 'Night'];
export const LOW_STOCK = 7;

/** Today's supplement checklist grouped by time of day, with what is taken and what is running low. */
export function supplementChecklist({ supplements = [], logs = [], today = new Date(), lowAt = LOW_STOCK }) {
  const t = dayKey(today);
  const takenIds = new Set(logs.filter((l) => rowDay(l.taken_at) === t).map((l) => l.supplement_id));
  const items = supplements
    .filter((s) => s.enabled !== false)
    .map((s) => {
      const units = s.units_remaining === null || s.units_remaining === undefined || s.units_remaining === '' ? null : Number(s.units_remaining);
      return { id: s.id, name: s.name, dose: s.dose || '', timing: TIMINGS.includes(s.timing) ? s.timing : 'Morning', taken: takenIds.has(s.id), units, low: units !== null && units < lowAt };
    });
  const groups = TIMINGS.map((timing) => {
    const list = items.filter((i) => i.timing === timing);
    return { timing, items: list, taken: list.filter((i) => i.taken).length, total: list.length };
  }).filter((g) => g.total);
  return { groups, taken: items.filter((i) => i.taken).length, total: items.length, low: items.filter((i) => i.low) };
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** This week (Mon–Sun): the planned workout per day and whether it got done. */
export function weekTraining({ schedule = [], logs = [], today = new Date() }) {
  const t = dayKey(today);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const days = DOW.map((label, i) => {
    const key = dayKey(addDays(monday, i));
    const planned = schedule.find((r) => r.day_of_week === label)?.workout_type || null;
    const rest = !planned || planned === 'Rest';
    const done = logs.filter((l) => rowDay(l.completed_at) === key);
    return {
      label, key, planned: rest ? null : planned, rest, isToday: key === t, isPast: key < t,
      done: done.length > 0, type: done[0]?.workout_type || null, missed: !rest && key < t && done.length === 0,
    };
  });
  return {
    days,
    planned: days.filter((d) => !d.rest).length,
    done: days.filter((d) => d.done).length,
    missed: days.filter((d) => d.missed).length,
  };
}

/** Body, training and nutrition numbers for the last 7 days. */
export function healthKpis({ weights = [], workouts = [], schedule = [], nutrition = [], goals = [], today = new Date() }) {
  const windows = reviewWindows(today);
  const sortedWeights = weights.filter((w) => w.logged_at && Number(w.weight) > 0).sort((a, b) => String(a.logged_at).localeCompare(String(b.logged_at)));
  const latest = sortedWeights.at(-1) || null;
  // Compare with the last weigh-in on or before a week ago; failing that, the first one this week.
  const weekAgoKey = dayKey(addDays(today, -7));
  const older = sortedWeights.filter((w) => rowDay(w.logged_at) <= weekAgoKey).at(-1) || null;
  const thisWeek = sortedWeights.filter((w) => rowDay(w.logged_at) > weekAgoKey);
  const candidate = older || (thisWeek.length > 1 ? thisWeek[0] : null);
  const ref = candidate && candidate !== latest ? candidate : null;
  const training = weekTraining({ schedule, logs: workouts, today });
  const w = workoutStats({ logs: workouts, windows });
  const n = nutritionStats({ logs: nutrition, goals, windows });
  return {
    weight: latest ? { latest: round1(Number(latest.weight)), change: ref ? round1(Number(latest.weight) - Number(ref.weight)) : null, since: ref ? rowDay(ref.logged_at) : null, on: rowDay(latest.logged_at) } : null,
    training: { done: training.done, planned: training.planned, last7: w.count, prev7: w.prevCount },
    calories: { avg: n.avgCalories, goal: n.goalCalories, days: n.loggedDays },
    protein: { avg: n.avgProtein, goal: n.goalProtein },
  };
}

/* ============================================================
   Habits
   ============================================================ */
const activeHabits = (habits) => habits.filter((h) => h.active !== false);
const doneSet = (logs) => new Set(logs.filter((l) => l.completed !== false).map((l) => `${l.habit_id}|${l.log_date}`));

/** The longest run of consecutive days in a set of day keys. */
export function longestRun(keys) {
  const nums = [...new Set([...keys].map(dayNum))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  nums.forEach((n, i) => {
    run = i > 0 && n === nums[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  });
  return best;
}

/** Every active habit's current streak, best streak and 30-day rate, longest streak first. */
export function streakBoard({ habits = [], logs = [], today = new Date() }) {
  const done = doneSet(logs);
  const t = dayKey(today);
  const from = dayKey(addDays(today, -29));
  const rows = activeHabits(habits).map((h) => {
    const days = logs.filter((l) => l.habit_id === h.id && l.completed !== false).map((l) => l.log_date);
    const born = rowDay(h.created_at);
    let possible = 0;
    let hit = 0;
    for (let i = 29; i >= 0; i -= 1) {
      const key = dayKey(addDays(today, -i));
      if (born && key < born) continue;
      possible += 1;
      if (done.has(`${h.id}|${key}`)) hit += 1;
    }
    return {
      id: h.id, name: h.name, current: currentStreak((dk) => done.has(`${h.id}|${dk}`), today),
      best: longestRun(days), rate30: pct(hit, possible), total: days.length, doneToday: done.has(`${h.id}|${t}`),
    };
  });
  rows.sort((a, b) => b.current - a.current || b.best - a.best || String(a.name).localeCompare(String(b.name)));
  return { rows, from, longest: rows.reduce((m, r) => (r.best > (m?.best || 0) ? r : m), null) };
}

const level = (hit, possible) => {
  if (!possible || !hit) return 0;
  const f = hit / possible;
  return f >= 1 ? 4 : f >= 0.67 ? 3 : f >= 0.34 ? 2 : 1;
};

/** A GitHub-style grid: `weeks` columns (Mon–Sun) shaded by the share of habits done each day. */
export function habitHeatmap({ habits = [], logs = [], today = new Date(), weeks = 18 }) {
  const t = dayKey(today);
  const active = activeHabits(habits);
  const done = doneSet(logs);
  const monday = addDays(today, -((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  let prevMonth = -1;
  let best = 0;
  let total = 0;
  const cols = Array.from({ length: weeks }, (_, w) => {
    const cells = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, w * 7 + i);
      const key = dayKey(date);
      const future = key > t;
      let possible = 0;
      let hit = 0;
      if (!future) {
        active.forEach((h) => {
          const wasDone = done.has(`${h.id}|${key}`);
          const born = rowDay(h.created_at);
          if (!born || key >= born || wasDone) possible += 1;
          if (wasDone) hit += 1;
        });
      }
      total += hit;
      if (hit > best) best = hit;
      return { key, future, done: hit, possible, level: future ? 0 : level(hit, possible) };
    });
    const first = addDays(monday, w * 7);
    const label = first.getMonth() !== prevMonth ? first.toLocaleDateString('en-US', { month: 'short' }) : '';
    prevMonth = first.getMonth();
    return { label, cells };
  });
  return { weeks: cols, activeCount: active.length, total, bestDay: best };
}

/* ============================================================
   Launcher links (user-typed, so they are validated)
   ============================================================ */
/**
 * Turn what the user typed into a safe link: `/path` stays inside the app, `example.com`
 * becomes https, and only http(s) is ever allowed (never `javascript:` and friends).
 */
export function normalizeLink(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Enter a link.' };
  if (value.startsWith('/') && !value.startsWith('//')) return { ok: true, url: value, internal: true, host: 'CTRLpanel' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z0-9.-]+:\d+/i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That doesn’t look like a link.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Only http and https links are allowed.' };
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return { ok: false, error: 'That doesn’t look like a link.' };
  return { ok: true, url: url.toString(), internal: false, host: url.hostname.replace(/^www\./, '') };
}
