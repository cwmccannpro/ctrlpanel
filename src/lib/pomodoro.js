// Pure state machine for the dashboard focus timer (no React, no storage), so it can be
// unit-tested. The timer survives navigating away and reloads because a running timer
// stores its absolute end time (`endsAt`), not a countdown.

export const PRESETS = [
  { id: '25/5', focus: 25, rest: 5 },
  { id: '50/10', focus: 50, rest: 10 },
  { id: '90/15', focus: 90, rest: 15 },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

const minutesFor = (preset, mode) => (mode === 'rest' ? preset.rest : preset.focus) * 60000;

/** A stopped timer showing a full interval for `mode` ('focus' | 'rest'). */
export const freshTimer = (preset, mode = 'focus') => ({
  mode: mode === 'rest' ? 'rest' : 'focus',
  running: false,
  endsAt: null,
  remainingMs: minutesFor(preset, mode),
});

export const remainingMs = (timer, now) => (timer.running ? Math.max(0, timer.endsAt - now) : timer.remainingMs);

export const startTimer = (timer, now) => (timer.running ? timer : { ...timer, running: true, endsAt: now + timer.remainingMs });

export const pauseTimer = (timer, now) =>
  timer.running ? { ...timer, running: false, endsAt: null, remainingMs: remainingMs(timer, now) } : timer;

export const isFinished = (timer, now) => timer.running && now >= timer.endsAt;

/** When an interval ends, switch to the other mode (stopped, full length). */
export const nextTimer = (timer, preset) => freshTimer(preset, timer.mode === 'focus' ? 'rest' : 'focus');

/** "24:07" */
export function clockText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Share of the interval already elapsed, 0..1. */
export const elapsedFraction = (timer, preset, now) => {
  const full = minutesFor(preset, timer.mode);
  return full ? Math.min(1, Math.max(0, (full - remainingMs(timer, now)) / full)) : 0;
};

/** Read a stored timer defensively: anything odd becomes a fresh one. */
export function sanitizeTimer(raw, preset) {
  const mode = raw?.mode === 'rest' ? 'rest' : 'focus';
  const full = minutesFor(preset, mode);
  if (raw?.running && Number.isFinite(raw.endsAt)) return { mode, running: true, endsAt: raw.endsAt, remainingMs: full };
  const left = Number(raw?.remainingMs);
  return { mode, running: false, endsAt: null, remainingMs: Number.isFinite(left) && left > 0 && left <= full ? left : full };
}

/** Count a finished focus interval on `dayKey`, keeping only the last 14 days. */
export function recordSession(sessions = {}, day) {
  const next = { ...sessions, [day]: (Number(sessions[day]) || 0) + 1 };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)).slice(-14));
}
