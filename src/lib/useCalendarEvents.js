import { useEffect, useState } from 'react';
import { useRows } from './useData.js';
import { gcal } from './api.js';

/**
 * Calendar events from the same source the Calendar page uses: Google when connected,
 * else the local Supabase table. Shared by the dashboard, the weekly review and projects.
 */
export function useCalendarEvents() {
  const { rows: localRows } = useRows('calendar_events', []);
  const [gEvents, setGEvents] = useState(null);
  useEffect(() => {
    let on = true;
    gcal.status()
      .then((s) => (s.connected ? gcal.list() : null))
      .then((r) => { if (on && r) setGEvents(r.events || []); })
      .catch(() => {});
    return () => { on = false; };
  }, []);
  return gEvents ?? localRows;
}
