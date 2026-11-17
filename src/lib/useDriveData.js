import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { loadDriveSnapshot } from './driveSnapshot.js';

const EMPTY = { tasks: [], boards: [], habits: [], logs: [] };
const initialState = userId => ({ userId, data: EMPTY, loading: true, error: '', updated: null, partial: false });
// Bounded reads, no persistent private-data cache; refresh on resume and every minute.
export function useDriveData(userId) {
  const [state, setState] = useState(() => initialState(userId));
  const generation = useRef(0);
  const busy = useRef(false);
  const active = useRef(true);
  const request = useRef(null);
  const refresh = useCallback(async () => {
    if (!supabase || !userId || busy.current || document.hidden || !active.current) return;
    busy.current = true;
    const version = generation.current;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const snapshot = await loadDriveSnapshot(supabase, controller.signal);
      if (version === generation.current) setState({ ...snapshot, userId, loading: false, error: '', updated: new Date() });
    } catch {
      if (version === generation.current) setState(s => ({ ...s, loading: false, error: s.updated ? 'Sync unavailable. Showing the last successful update.' : 'Could not sync CTRLpanel. Check your connection and retry.' }));
    } finally { clearTimeout(timeout); if (version === generation.current) { busy.current = false; request.current = null; } }
  }, [userId]);
  useEffect(() => {
    generation.current++; busy.current = false;
    setState(initialState(userId));
    const pause = () => { active.current = false; generation.current++; request.current?.abort(); request.current = null; busy.current = false; };
    const resume = () => { active.current = true; refresh(); };
    const visibility = () => { if (document.hidden) pause(); else resume(); };
    refresh();
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('ctrlpanel:resume', resume);
    window.addEventListener('ctrlpanel:pause', pause);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => { generation.current++; request.current?.abort(); busy.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('ctrlpanel:resume', resume); window.removeEventListener('ctrlpanel:pause', pause); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [refresh]);
  return { ...(state.userId === userId ? state : initialState(userId)), refresh };
}
