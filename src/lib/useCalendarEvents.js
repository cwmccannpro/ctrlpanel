import { useEffect, useMemo, useState } from 'react';
import { useRows } from './useData.js';
import { gcal, ical } from './api.js';
import { useIcalFeeds } from './useIcalFeeds.js';

const DAY = 86400000;

/**
 * Calendar events from the same sources the Calendar page uses: Google when connected,
 * else the local Supabase table, plus the user's read-only .ics feeds.
 * Shared by the dashboard, the weekly review and projects.
 */
export function useCalendarEvents() {
  const { rows: localRows } = useRows('calendar_events', []);
  const [gEvents, setGEvents] = useState(null);
  const [feedEvents, setFeedEvents] = useState([]);
  const feeds = useIcalFeeds();
  const feedKey = JSON.stringify(feeds);

  useEffect(() => {
    let on = true;
    gcal.status()
      .then((s) => (s.connected ? gcal.list() : null))
      .then((r) => { if (on && r) setGEvents(r.events || []); })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  useEffect(() => {
    let on = true;
    if (!feeds.length) {
      setFeedEvents([]);
      return undefined;
    }
    const now = Date.now();
    ical.events(feeds, { timeMin: new Date(now - 14 * DAY).toISOString(), timeMax: new Date(now + 90 * DAY).toISOString() })
      .then((r) => { if (on) setFeedEvents(r.events || []); })
      .catch(() => { if (on) setFeedEvents([]); });
    return () => { on = false; };
    // feedKey captures the feed list's content; `feeds` itself is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey]);

  const base = gEvents ?? localRows;
  return useMemo(() => (feedEvents.length ? [...base, ...feedEvents] : base), [base, feedEvents]);
}
