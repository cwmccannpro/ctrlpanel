import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../components/AuthProvider.jsx';
import { insert, queryTable, update } from './supabase.js';
import { notifyDataChanged } from './useData.js';

// Keep failed reads distinct from an empty week, and only show a save as
// successful once the RLS-scoped database has returned the saved row.
export function useFitnessPlan() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestVersion = useRef(0);
  const reload = useCallback(async (foreground = true) => {
    const version = ++requestVersion.current;
    if (!user?.id) { setRows([]); setLoading(false); setError(null); return; }
    if (foreground) setLoading(true);
    try {
      const result = await queryTable('fitness_schedule');
      if (version !== requestVersion.current) return;
      if (result.error) throw result.error;
      setRows(result.data || []);
      setError(null);
    } catch (err) {
      if (version === requestVersion.current) setError(err);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setRows([]);
    reload();
    const changed = (event) => {
      if (event.detail?.table === 'fitness_schedule') reload(false);
    };
    window.addEventListener('ctrlpanel:data-changed', changed);
    return () => {
      requestVersion.current += 1;
      window.removeEventListener('ctrlpanel:data-changed', changed);
    };
  }, [reload]);

  const saveDay = async (day, row, payload) => {
    const result = row
      ? await update('fitness_schedule', row.id, payload)
      : await insert('fitness_schedule', [{ day_of_week: day, ...payload }]);
    if (result.error) throw result.error;
    const saved = result.data?.[0];
    if (!saved) throw new Error('The day could not be saved. Please try again.');
    setRows((current) => row ? current.map((item) => item.id === row.id ? saved : item) : [...current, saved]);
    notifyDataChanged('fitness_schedule');
    return saved;
  };
  return { rows, loading, error, reload, saveDay };
}
