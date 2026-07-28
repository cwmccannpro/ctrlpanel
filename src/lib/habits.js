// ============================================================
// CTRLpanel — shared habit consistency-trend helpers
// Used by the Habits page and the Dashboard habits panels so the trend math
// stays in one place.
// ============================================================
export const RANGES = ['1M', '3M', '6M', '1Y', 'ALL'];
export const RANGE_DAYS = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
export const ROLL_WINDOW = 7; // rolling completion-rate window (days)

export const dayKey = (d) => d.toISOString().slice(0, 10);

// Build the last N calendar days (oldest → newest).
export function recentDays(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d);
  }
  return out;
}

// One point per day: the trailing ROLL_WINDOW-day completion rate across the
// given habits. `possible` only counts a (habit, day) once the habit existed,
// so newly-added habits don't drag down earlier history.
export function buildTrend({ habitIds, habitStart, isDone, start, end, windowDays = ROLL_WINDOW }) {
  const points = [];
  const cur = new Date(start);
  while (cur <= end) {
    let done = 0;
    let possible = 0;
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(cur);
      d.setDate(cur.getDate() - i);
      const dk = dayKey(d);
      for (const id of habitIds) {
        if (habitStart[id] && dk < habitStart[id]) continue;
        possible++;
        if (isDone(id, dk)) done++;
      }
    }
    points.push({
      date: dayKey(cur),
      label: cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      rate: possible ? Math.round((done / possible) * 100) : 0,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return points;
}

// High-level: compute the trend series straight from habit + log rows.
// chartHabit === 'all' aggregates every active habit; otherwise a single id.
export function computeTrend({ logs = [], habits = [], chartHabit = 'all', range = '3M' }) {
  const active = habits.filter((h) => h.active !== false);
  const logMap = {};
  logs.forEach((l) => { logMap[`${l.habit_id}|${l.log_date}`] = l; });
  const isDone = (id, dk) => Boolean(logMap[`${id}|${dk}`]?.completed);

  const habitStart = {};
  habits.forEach((h) => { habitStart[h.id] = (h.created_at || '').slice(0, 10) || ''; });

  const validIds = new Set(active.map((h) => h.id));
  const ids = chartHabit === 'all' || !validIds.has(chartHabit) ? active.map((h) => h.id) : [chartHabit];
  if (!ids.length) return [];

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  let start = new Date(end);
  if (range === 'ALL') {
    const dates = logs.map((l) => l.log_date).filter(Boolean).sort();
    if (dates[0]) start = new Date(dates[0]);
  } else {
    start.setDate(end.getDate() - ((RANGE_DAYS[range] || 90) - 1));
  }
  start.setHours(0, 0, 0, 0);

  const MAX_DAYS = 1500;
  const span = Math.round((end - start) / 86400000) + 1;
  if (span > MAX_DAYS) start = new Date(end.getTime() - (MAX_DAYS - 1) * 86400000);

  return buildTrend({ habitIds: ids, habitStart, isDone, start, end });
}
