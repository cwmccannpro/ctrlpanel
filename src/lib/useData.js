import { useState, useEffect, useCallback } from 'react';
import { supabase, isConfigured } from './supabase.js';

/**
 * Load rows from a Supabase table, falling back to mock data when Supabase
 * isn't configured (or the query errors). Returns { rows, setRows, loading,
 * usingMock, reload } so pages can optimistically edit local state and stay
 * functional offline (AGENTS.md rule #8).
 *
 * @param table     Supabase table name
 * @param mock      array of mock rows to use as fallback
 * @param order     optional column to order by (ascending)
 */
export function useRows(table, mock = [], order) {
  const [rows, setRows] = useState(mock);
  const [loading, setLoading] = useState(isConfigured);
  const [usingMock, setUsingMock] = useState(!isConfigured);

  const reload = useCallback(async () => {
    if (!isConfigured || !supabase) {
      setRows(mock);
      setUsingMock(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    let q = supabase.from(table).select('*');
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error || !data) {
      setRows(mock);
      setUsingMock(true);
    } else {
      setRows(data);
      setUsingMock(false);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, order]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, setRows, loading, usingMock, reload };
}
