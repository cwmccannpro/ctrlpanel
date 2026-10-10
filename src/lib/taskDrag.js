import { useSyncExternalStore } from 'react';

// The task being dragged toward a time slot: { taskId, mins, grabMin, from }.
//
// Task rows live in different dashboard panels (To Do boards, Due Soon, Today) from
// the Day Plan they get dropped on, so the in-flight drag can't be component state.
// One tiny module-level store lets any panel start a drag and the Day Plan's grid
// read it (ghost, quarter-hour guide) without prop-drilling through the layout engine.
let current = null;
const listeners = new Set();

export const getTaskDrag = () => current;

export function setTaskDrag(next) {
  const value = typeof next === 'function' ? next(current) : next;
  if (value === current) return;
  current = value || null;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** [drag, setDrag] — same shape as useState, but shared by every panel. */
export function useTaskDrag() {
  const drag = useSyncExternalStore(subscribe, getTaskDrag, () => null);
  return [drag, setTaskDrag];
}
