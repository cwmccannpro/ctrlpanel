// Write/load failures raised by lib code reach the UI through one window event, so
// lib code stays free of React context (same pattern as notifyDataChanged in useData.js).
// The ToastProvider listens and shows an error toast with a Retry action.
export const DATA_FAILED_EVENT = 'ctrlpanel:data-failed';

/** @param {{ message: string, key?: string, retry?: () => void }} detail */
export function reportDataFailure(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DATA_FAILED_EVENT, { detail }));
}

export const tableLabel = (table) => String(table || 'data').replace(/_/g, ' ');

const ACTION_MESSAGES = {
  add: (label) => `Couldn’t save that new item to ${label}.`,
  update: (label) => `Couldn’t save your change to ${label}.`,
  remove: (label) => `Couldn’t delete that from ${label}.`,
  load: (label) => `Couldn’t load ${label}.`,
};

export function failureMessage(action, table, error) {
  const base = (ACTION_MESSAGES[action] || ACTION_MESSAGES.update)(tableLabel(table));
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const network = offline || /failed to fetch|networkerror|network request|load failed/i.test(error?.message || '');
  return `${base} ${network ? 'You appear to be offline.' : 'Please try again.'}`;
}
