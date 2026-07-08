import { useState, useEffect, useCallback } from 'react';
import { supabase, isConfigured, insert as sbInsert, update as sbUpdate, remove as sbRemove } from './supabase.js';

/**
 * Load rows from a Supabase table (RLS-scoped to the current user). When
 * Supabase isn't configured it falls back to `mock` (empty by default), so
 * new accounts start with a clean slate.
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
      setUsingMock(Boolean(error));
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

/**
 * CRUD helper over a table with optimistic local updates. Returns:
 *   rows, loading, add(row), patch(id, changes), remove(id), reload
 * `add` inserts (DB fills id + user_id via defaults) and reconciles the temp
 * row with the returned real row so later edits/deletes hit the real id.
 */
export function useCrud(table, order) {
  const { rows, setRows, loading, reload } = useRows(table, [], order);

  const add = useCallback(
    async (row) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setRows((prev) => [...prev, { ...row, id: tempId }]);
      const { data } = await sbInsert(table, [row]);
      const real = data?.[0];
      if (real) setRows((prev) => prev.map((r) => (r.id === tempId ? real : r)));
      return real || { ...row, id: tempId };
    },
    [table, setRows]
  );

  const patch = useCallback(
    async (id, changes) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
      await sbUpdate(table, id, changes);
    },
    [table, setRows]
  );

  const removeRow = useCallback(
    async (id) => {
      setRows((prev) => prev.filter((r) => r.id !== id));
      await sbRemove(table, id);
    },
    [table, setRows]
  );

  return { rows, setRows, loading, add, patch, remove: removeRow, reload };
}
