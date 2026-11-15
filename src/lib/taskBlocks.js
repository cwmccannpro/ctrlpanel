// Time-blocking: To Do tasks placed onto calendar time slots.
//
// A block is { start: ISO string, mins: number }, keyed by task id and stored in
// user_settings.ui_preferences.calendar.blocks (RLS-scoped, no schema change).
// Everything here is pure and import-free so `node --test` can load it.

export const SLOT = 15; // snap granularity, minutes
export const MAGNET = 10; // pull to a neighbouring event's edge within this many minutes
export const DEFAULT_MINS = 30;
export const MIN_MINS = 15;
export const MAX_MINS = 8 * 60;
export const DURATIONS = [15, 30, 45, 60, 90, 120];
export const DAY_LO = 6 * 60; // visible window, minutes from midnight
export const DAY_HI = 24 * 60;

// Tasks read as work, not as a calendar: tint by urgency.
export const PRIORITY_TINT = { Urgent: '#f43f5e', High: '#fb923c', Medium: '#fbbf24', Low: '#94a3b8' };
export const tintFor = (priority) => PRIORITY_TINT[priority] || PRIORITY_TINT.Medium;

const MIN = 60000;
const clampMins = (m) => {
  const n = Number(m);
  if (!Number.isFinite(n)) return DEFAULT_MINS;
  return Math.min(MAX_MINS, Math.max(MIN_MINS, Math.round(n / SLOT) * SLOT));
};

export const durationLabel = (mins) => (mins < 60 ? `${mins}m` : mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60}h`);

// Whatever was stored → a clean { taskId: { start, mins } } map.
export function sanitizeBlocks(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, b] of Object.entries(raw)) {
    const t = Date.parse(b?.start);
    if (!id || !Number.isFinite(t)) continue;
    out[id] = { start: new Date(t).toISOString(), mins: clampMins(Number(b.mins) || DEFAULT_MINS) };
  }
  return out;
}

// Blocks → calendar items (same shape the grid renders for events).
export function taskItems(blocks, tasks, isDone = () => false) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = [];
  for (const [id, b] of Object.entries(blocks)) {
    const task = byId.get(id);
    if (!task) continue; // task was deleted
    const start = Date.parse(b.start);
    out.push({
      id: `task:${id}`,
      kind: 'task',
      task_id: id,
      cal_id: 'tasks',
      title: task.title || 'Untitled task',
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + b.mins * MIN).toISOString(),
      all_day: false,
      calendar: 'To Do',
      color: tintFor(task.priority),
      priority: task.priority || 'Medium',
      due_date: task.due_date || null,
      mins: b.mins,
      done: Boolean(isDone(task)),
    });
  }
  return out;
}

const isDateOnly = (e) => Boolean(e.all_day) || /^\d{4}-\d{2}-\d{2}$/.test(e.starts_at || '');

// Timed events/blocks as [startMin, endMin] on a given local day (clipped to the day).
export function busyOnDay(items, date, { skipTaskId } = {}) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const out = [];
  for (const e of items) {
    if (isDateOnly(e) || (skipTaskId && e.task_id === skipTaskId)) continue;
    const s = (Date.parse(e.starts_at) - dayStart) / MIN;
    if (!Number.isFinite(s)) continue;
    const end = e.ends_at ? (Date.parse(e.ends_at) - dayStart) / MIN : s;
    const eEnd = Math.max(end, s + 1);
    if (eEnd <= 0 || s >= 1440) continue;
    out.push([Math.max(0, s), Math.min(1440, eEnd)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function mergeIntervals(list) {
  const out = [];
  for (const [s, e] of [...list].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Where a dragged block lands. `rawMin` is the pointer-derived start (minutes from
 * midnight). Snaps to the 15-minute grid, but is pulled to a neighbouring event's
 * edge (start right after it, or finish right before it) when one is within MAGNET.
 * → { start, edge: minutes of the edge snapped to, or null }
 */
export function snapToSlot({ rawMin, mins, edges = [], lo = DAY_LO, hi = DAY_HI, step = SLOT, magnet = MAGNET }) {
  const latest = Math.max(lo, hi - mins);
  const clamp = (v) => Math.min(latest, Math.max(lo, v));
  let best = null;
  for (const edge of edges) {
    for (const cand of [edge, edge - mins]) {
      const d = Math.abs(cand - rawMin);
      if (d <= magnet && (!best || d < best.d)) best = { cand, d, edge };
    }
  }
  if (best) {
    const start = clamp(best.cand);
    if (start === best.cand) return { start, edge: best.edge };
  }
  return { start: clamp(Math.round(rawMin / step) * step), edge: null };
}

// Edges (minutes) of the other timed items on a day: what blocks can magnetise to.
export function edgesOnDay(items, date, opts) {
  const edges = [];
  for (const [s, e] of busyOnDay(items, date, opts)) edges.push(s, e);
  return edges;
}

/**
 * First free gap of `mins` minutes at or after `from`, scanning up to `days` days.
 * Busy = every timed item in `items` (events and other task blocks).
 * → Date (start of the slot) or null.
 */
export function findFreeSlot({ items, from = new Date(), mins = DEFAULT_MINS, days = 7, lo = DAY_LO, hi = DAY_HI, step = SLOT, skipTaskId }) {
  for (let d = 0; d < days; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    const busy = mergeIntervals(busyOnDay(items, day, { skipTaskId }));
    const nowMin = from.getHours() * 60 + from.getMinutes();
    let cursor = d === 0 ? Math.max(lo, Math.ceil(nowMin / step) * step) : lo;
    for (const [s, e] of busy) {
      if (e <= cursor) continue;
      if (cursor + mins <= s) break;
      cursor = Math.max(cursor, Math.ceil(e / step) * step);
    }
    if (cursor + mins <= hi) {
      return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, cursor);
    }
  }
  return null;
}

// Busy / free minutes inside the visible window of a day (events + blocks, merged).
export function dayLoad(items, date, { lo = DAY_LO, hi = DAY_HI } = {}) {
  const merged = mergeIntervals(busyOnDay(items, date).map(([s, e]) => [Math.max(lo, s), Math.min(hi, e)]).filter(([s, e]) => e > s));
  const busy = merged.reduce((n, [s, e]) => n + (e - s), 0);
  return { busy, free: hi - lo - busy };
}

export const clampDuration = clampMins;
