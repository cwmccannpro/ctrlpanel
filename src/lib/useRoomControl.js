import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from './api.js';
import { roomOnline } from './roomControl.js';

export function useRoomControl() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const active = useRef(true), reading = useRef(false), writing = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const next = await authApi.get('/room/status');
      if (active.current) { setData(next); setError(''); setNow(Date.now()); }
    } catch (e) { if (active.current) setError(e.message); }
    finally { reading.current = false; }
  }, []);
  useEffect(() => {
    active.current = true;
    refresh();
    const tick = () => { if (!document.hidden) { setNow(Date.now()); refresh(); } };
    const timer = setInterval(tick, 3000);
    document.addEventListener('visibilitychange', tick);
    return () => { active.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [refresh]);
  const send = useCallback(async (target, patch) => {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    try { await authApi.post('/room/command', { target, patch }); await refresh(); }
    catch (e) { if (active.current) setError(e.message); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  }, [refresh]);
  return { ...data, error, busy, loading: !data && !error, online: !error && roomOnline(data?.controller, now), refresh, send };
}
