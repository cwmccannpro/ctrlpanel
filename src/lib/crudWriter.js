// ============================================================
// Optimistic writes that tell the truth.
//
// The UI changes immediately; if the database then rejects the write, the change
// is undone and the failure is reported (with a Retry), instead of leaving a row on
// screen that was never saved. Pure and dependency-injected so it is unit-testable:
// useCrud (useData.js) wires it to React state and Supabase.
//
//   add(row)        -> the saved row, or null if it could not be saved
//   patch(id, ch)   -> { data, error } like Supabase; { error } means it was rolled back
//   remove(id)      -> { data, error }; { error } means the row was put back
//
// Editing or deleting a row whose insert is still in flight waits for the real id
// instead of sending the placeholder `tmp-…` id to the database.
// ============================================================
import { failureMessage } from './writeStatus.js';

export const isTempId = (id) => typeof id === 'string' && id.startsWith('tmp-');

// Supabase isn't configured (mock mode): keep the old local-only behaviour.
const LOCAL_ONLY = 'supabase-not-configured';
const isLocalOnly = (error) => error?.message === LOCAL_ONLY;

const asError = (e) => (e instanceof Error || (e && typeof e === 'object' && 'message' in e) ? e : new Error(String(e || 'Write failed')));

/**
 * @param {object} o
 * @param {string} o.table
 * @param {{insert: Function, update: Function, remove: Function}} o.api  Supabase-shaped: resolve to { data, error }
 * @param {(updater: (rows: object[]) => object[]) => void} o.setRows  React-style functional state setter
 * @param {(failure: {message: string, key: string, retry: () => void}) => void} [o.onFailure]
 * @param {() => void} [o.reload]  re-sync with the database
 */
export function createCrudWriter({ table, api, setRows, onFailure = () => {}, reload = () => {} }) {
  const inflight = new Map(); // temp id -> Promise<saved row | null>
  const queued = new Map(); // temp id -> changes made while its insert was in flight

  const report = (action, error, retry) => {
    if (typeof console !== 'undefined') console.warn(`[data] ${action} on ${table} failed:`, error?.message || error);
    onFailure({ message: failureMessage(action, table, error), key: `${table}:${action}`, retry });
  };
  const call = async (fn, ...args) => {
    try {
      return (await fn(...args)) || { data: null, error: null };
    } catch (e) {
      return { data: null, error: asError(e) };
    }
  };

  async function add(row) {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setRows((prev) => [...prev, { ...row, id }]);
    const run = (async () => {
      const result = await call(api.insert, table, [row]);
      const saved = result.data?.[0];
      if (isLocalOnly(result.error)) return { ...row, id };
      if (result.error || !saved) {
        queued.delete(id);
        setRows((prev) => prev.filter((r) => r.id !== id));
        report('add', result.error, () => add(row));
        return null;
      }
      const extra = queued.get(id);
      queued.delete(id);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...saved, ...extra } : r)));
      if (extra) await commitPatch(saved.id, extra, saved);
      return saved;
    })();
    inflight.set(id, run);
    try {
      return await run;
    } finally {
      inflight.delete(id);
    }
  }

  // `before` holds the values the changed keys had, so a failed save can restore them.
  async function commitPatch(id, changes, before) {
    const result = await call(api.update, table, id, changes);
    if (isLocalOnly(result.error)) return { data: null, error: null };
    const gone = !result.error && Array.isArray(result.data) && result.data.length === 0; // deleted elsewhere, or not permitted
    if (!result.error && !gone) return result;
    const error = result.error || new Error('This item no longer exists.');
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const undo = {};
      // Only undo keys still holding our optimistic value; a newer edit stays.
      for (const key of Object.keys(changes)) if (key in before && Object.is(r[key], changes[key])) undo[key] = before[key];
      return { ...r, ...undo };
    }));
    if (gone) reload();
    report('update', error, () => patch(id, changes));
    return { data: null, error };
  }

  async function patch(id, changes) {
    if (isTempId(id)) {
      const pending = inflight.get(id);
      if (!pending) return { data: null, error: new Error('This item was never saved.') };
      // Show it now; add() sends it once the insert has a real id.
      queued.set(id, { ...queued.get(id), ...changes });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
      const saved = await pending;
      return saved ? { data: [saved], error: null } : { data: null, error: new Error('The new item could not be saved.') };
    }
    const before = {};
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      for (const key of Object.keys(changes)) before[key] = r[key];
      return { ...r, ...changes };
    }));
    return commitPatch(id, changes, before);
  }

  async function remove(id) {
    let removed = null;
    let index = -1;
    setRows((prev) => {
      index = prev.findIndex((r) => r.id === id);
      removed = index >= 0 ? prev[index] : null;
      return prev.filter((r) => r.id !== id);
    });
    let realId = id;
    if (isTempId(id)) {
      const saved = await inflight.get(id);
      if (!saved) return { data: null, error: null }; // never saved, nothing to delete
      realId = saved.id;
      setRows((prev) => prev.filter((r) => r.id !== realId));
    }
    const result = await call(api.remove, table, realId);
    if (!result.error || isLocalOnly(result.error)) return result;
    if (removed) {
      const back = { ...removed, id: realId };
      setRows((prev) => (prev.some((r) => r.id === realId) ? prev : [...prev.slice(0, index), back, ...prev.slice(index)]));
    }
    report('remove', result.error, () => remove(realId));
    return result;
  }

  return { add, patch, remove };
}
