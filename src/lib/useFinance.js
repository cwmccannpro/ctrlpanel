import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../components/AuthProvider.jsx';
import { financeSheets } from './api.js';
import { financeDebtEnabled, financeViewData } from './financeSheet.js';

// One in-memory request/cache per signed-in owner across all finance widgets.
// Private finance values never go into localStorage or the service worker.
const stores = new Map();
function getStore(id) {
  if (!stores.has(id)) stores.set(id, { state: { loading: true, connected: false, data: {}, error: null }, listeners: new Set(), pending: null, at: 0 });
  return stores.get(id);
}
const emit = (s, patch) => { s.state = { ...s.state, ...patch }; s.listeners.forEach((f) => f()); };
async function refresh(s) {
  if (s.pending) return s.pending;
  emit(s, { loading: true });
  s.pending = financeSheets.workbook().then((data) => {
    s.at = Date.now();
    emit(s, { ...data, data: data.data || {}, error: null, loading: false });
    return data;
  }).catch((error) => { emit(s, { error, loading: false }); throw error; }).finally(() => { s.pending = null; });
  return s.pending;
}
export default function useFinance() {
  const { user, refreshSettings } = useAuth();
  const id = user?.id || 'signed-out';
  const s = getStore(id);
  const subscribe = useCallback((fn) => { s.listeners.add(fn); return () => s.listeners.delete(fn); }, [s]);
  const state = useSyncExternalStore(subscribe, () => s.state);
  const includeDebt = financeDebtEnabled();
  const data = useMemo(() => financeViewData(state.data, includeDebt), [state.data, includeDebt]);
  useEffect(() => {
    if (!user) return;
    const load = () => { if (document.visibilityState !== 'hidden') refresh(s).catch(() => {}); };
    if (Date.now() - s.at > 30000 || (s.state.includeDebt !== undefined && s.state.includeDebt !== includeDebt)) load();
    const focus = () => { if (Date.now() - s.at > 15000) load(); };
    window.addEventListener('focus', focus);
    const timer = setInterval(load, 60000);
    // Clear another account's cache on identity changes.
    for (const key of stores.keys()) if (key !== id) stores.delete(key);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [id, s, includeDebt]);
  const reload = () => refresh(s);
  const mutate = async (fn) => {
    // Settle an older background read before mutating, then reread after save.
    if (s.pending) await s.pending.catch(() => {});
    const result = await fn();
    try { await reload(); } catch { /* state explicitly shows the refresh error */ }
    return result;
  };
  return { ...state, data, includeDebt, reload,
    save: (table, row, values) => mutate(() => financeSheets.save({ table, recordId: row?.id, version: row?.version, values })),
    remove: (table, row) => mutate(() => financeSheets.save({ table, recordId: row.id, version: row.version, remove: true })),
    snapshot: (date) => mutate(() => financeSheets.snapshot(date)),
    connect: async (sheetId) => { await mutate(() => financeSheets.connect(sheetId)); await refreshSettings(); },
    disconnect: async () => { await mutate(() => financeSheets.disconnect()); await refreshSettings(); },
  };
}
