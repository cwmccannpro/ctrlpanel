import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

// Nutrition is also written by external GPTs. Refresh while visible and on
// focus, without requiring Realtime publication changes in Supabase.
export function useNutritionRows(table, select = '*', order = 'logged_at', range = null) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const version = useRef(0);
  const start = range?.start;
  const end = range?.end;
  const reload = useCallback(async () => {
    const current = ++version.current;
    try {
      if (!supabase) throw new Error('Sign in to a configured CTRLpanel account.');
      let query = supabase.from(table).select(select).order(order, { ascending: true });
      // A daily dashboard requests only its day, rather than the oldest rows in
      // a large meal history. Callers without a range retain the full log query.
      if (start && end) query = query.gte(order, start).lt(order, end);
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      if (current === version.current) { setRows(result.data || []); setError(''); }
    } catch (e) { if (current === version.current) setError(e.message || 'Could not load nutrition data.'); }
    finally { if (current === version.current) setLoading(false); }
  }, [table, select, order, start, end]);
  useEffect(() => {
    setLoading(true);
    reload();
    const refresh = () => document.visibilityState !== 'hidden' && reload();
    const changed = (e) => e.detail?.table === table && refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('ctrlpanel:data-changed', changed);
    const timer = setInterval(refresh, 20000);
    return () => {
      version.current++;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('ctrlpanel:data-changed', changed);
    };
  }, [reload, table]);
  return { rows, loading, error, reload };
}
