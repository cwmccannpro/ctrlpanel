// ============================================================
// CTRLpanel — weekly fitness plan (pure helpers)
//
// The plan is one `fitness_schedule` row per weekday:
//   { day_of_week: 'Mon', workout_type: 'Push', exercises: [...], notes }
// `workout_type` is free text (Push / Pull / Legs / anything you name it);
// `exercises` is [{ id, name, sets, reps, weight, note }] with sets/reps kept
// as text so "8-10", "AMRAP" or "3 × 12" all work.
// Keep this file import-free so `node --test` can load it.
// ============================================================

export const PLAN_DAYS = [
  { key: 'Mon', label: 'Monday' },
  { key: 'Tue', label: 'Tuesday' },
  { key: 'Wed', label: 'Wednesday' },
  { key: 'Thu', label: 'Thursday' },
  { key: 'Fri', label: 'Friday' },
  { key: 'Sat', label: 'Saturday' },
  { key: 'Sun', label: 'Sunday' },
];

/** Quick-pick names for a day; any other text is allowed too. */
export const SPLIT_TYPES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Cardio', 'Rest'];

const TYPE_COLORS = {
  push: 'var(--accent)',
  pull: '#3b82f6',
  legs: '#10b981',
  upper: '#8b5cf6',
  lower: '#f59e0b',
  'full body': '#ec4899',
  cardio: '#14b8a6',
  rest: '#6b7280',
};

/** Accent colour for a day's name; unknown names fall back to the app accent. */
export const typeColor = (type) => TYPE_COLORS[String(type || '').trim().toLowerCase()] || 'var(--accent)';

export const isRest = (type) => /^rest$/i.test(String(type || '').trim());

const uid = () => Math.random().toString(36).slice(2, 10);

export const blankExercise = () => ({ id: uid(), name: '', sets: '', reps: '', weight: '', note: '' });

/** 'Mon'…'Sun' for a Date, independent of locale. */
export const dayKeyFor = (date = new Date()) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];

export const dayLabel = (key) => PLAN_DAYS.find((d) => d.key === key)?.label || key;

/** The day after `key`, wrapping Sun → Mon. */
export const nextDayKey = (key) => {
  const i = PLAN_DAYS.findIndex((d) => d.key === key);
  return PLAN_DAYS[(i + 1) % PLAN_DAYS.length].key;
};

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Normalise stored exercises: tolerate null / wrong shapes, drop blank names, keep order. */
export function cleanExercises(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ id: text(e.id) || uid(), name: text(e.name), sets: text(e.sets), reps: text(e.reps), weight: text(e.weight), note: text(e.note) }))
    .filter((e) => e.name);
}

/** Index rows by weekday. If a day somehow has two rows, the first one wins. */
export function planByDay(rows = []) {
  const map = {};
  rows.forEach((r) => { if (r?.day_of_week && !map[r.day_of_week]) map[r.day_of_week] = r; });
  return map;
}

/** Everything the UI needs for one weekday. `planned` is false when nothing is saved for it. */
export function dayPlan(row) {
  const type = text(row?.workout_type);
  const exercises = cleanExercises(row?.exercises);
  return {
    type,
    rest: isRest(type) && exercises.length === 0,
    exercises,
    notes: text(row?.notes),
    planned: Boolean(row && (type || exercises.length || text(row.notes))),
  };
}

/** "4 × 8–10", "4 sets", "10 reps" or "" depending on what was filled in. */
export function setsReps(ex) {
  const sets = text(ex?.sets);
  const reps = text(ex?.reps);
  if (sets && reps) return `${sets} × ${reps}`;
  if (sets) return `${sets} ${sets === '1' ? 'set' : 'sets'}`;
  if (reps) return `${reps} reps`;
  return '';
}

/** New array with the item at `from` moved to `to` (clamped); the original is untouched. */
export function moveItem(list, from, to) {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** Copy of a day's exercises with fresh ids, for "copy from another day". */
export const cloneExercises = (list) => cleanExercises(list).map((e) => ({ ...e, id: uid() }));
