import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase, isConfigured, insert as sbInsert, update as sbUpdate, remove as sbRemove } from './supabase.js';
import { createCrudWriter } from './crudWriter.js';
import { reportDataFailure, failureMessage } from './writeStatus.js';

/**
 * Load rows from a Supabase table (RLS-scoped to the current user). When
 * Supabase isn't configured it falls back to `mock` (empty by default), so
 * new accounts start with a clean slate.
 *
 * A failed load is never shown as "no data": it sets `error` (and `usingMock`),
 * raises an error toast with a Retry, and keeps whatever rows were already loaded
 * so a flaky refresh doesn't blank the screen.
 */
export function useRows(table, mock = [], order) {
  const [rows, setRows] = useState(mock);
  const [loading, setLoading] = useState(isConfigured);
  const [usingMock, setUsingMock] = useState(!isConfigured);
  const [error, setError] = useState(null);
  const loadedFor = useRef(null); // the table whose rows are on screen

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
    const { data, error: loadError } = await q;
    if (loadError || !data) {
      if (loadedFor.current !== table) setRows(mock);
      setUsingMock(Boolean(loadError));
      setError(loadError || new Error('No data returned.'));
      reportDataFailure({ message: failureMessage('load', table, loadError), key: `${table}:load`, retry: reload });
    } else {
      loadedFor.current = table;
      setRows(data);
      setUsingMock(false);
      setError(null);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, order]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Something outside this hook (e.g. the command palette) wrote to the table.
  useEffect(() => {
    const onChanged = (e) => e.detail?.table === table && reload();
    window.addEventListener(DATA_EVENT, onChanged);
    return () => window.removeEventListener(DATA_EVENT, onChanged);
  }, [table, reload]);

  return { rows, setRows, loading, usingMock, error, reload };
}

const DATA_EVENT = 'ctrlpanel:data-changed';

/** Tell every mounted useRows/useCrud on `table` to reload (writes made outside them). */
export function notifyDataChanged(table) {
  window.dispatchEvent(new CustomEvent(DATA_EVENT, { detail: { table } }));
}

/**
 * CRUD helper over a table with optimistic local updates. Returns:
 *   rows, loading, error, add(row), patch(id, changes), remove(id), reload
 * `add` inserts (DB fills id + user_id via defaults), swaps the placeholder row for
 * the saved one, and resolves to it — or to null if the insert failed. A rejected
 * add/patch/remove is undone on screen and reported with a Retry toast; see
 * crudWriter.js for the exact rules.
 */
export function useCrud(table, order) {
  const { rows, setRows, loading, error, reload } = useRows(table, [], order);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const writer = useMemo(
    () => createCrudWriter({
      table,
      api: { insert: sbInsert, update: sbUpdate, remove: sbRemove },
      setRows,
      onFailure: reportDataFailure,
      reload: () => reloadRef.current(),
    }),
    [table, setRows]
  );

  return { rows, setRows, loading, error, add: writer.add, patch: writer.patch, remove: writer.remove, reload };
}
