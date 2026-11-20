import { useEffect, useMemo, useState } from 'react';
import { useRows } from './useData.js';
import { gcal, ical, icloud } from './api.js';
import { mergeCalendarSources } from './calendarEdit.js';
import { useIcalFeeds } from './useIcalFeeds.js';

const DAY = 86400000;
const CHANGED = 'ctrlpanel:calendar-changed';

/** Tell every mounted useCalendarEvents to reload (after an iCloud write). */
export function refreshCalendarEvents() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

/**
 * Calendar events from the same sources the Calendar page uses: Google when connected,
 * else the local Supabase table, plus iCloud (read + write) and the user's read-only
 * .ics feeds. The same event from a feed and from iCloud appears once.
 * Shared by the dashboard and projects.
 */
export function useCalendarEvents() {
  const { rows: localRows } = useRows('calendar_events', []);
  const [gEvents, setGEvents] = useState(null);
  const [appleEvents, setAppleEvents] = useState([]);
  const [feedEvents, setFeedEvents] = useState([]);
  const [revision, setRevision] = useState(0);
  const feeds = useIcalFeeds();
  const feedKey = JSON.stringify(feeds);

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);

  useEffect(() => {
    let on = true;
    gcal.status()
      .then((s) => (s.connected ? gcal.list() : null))
      .then((r) => { if (on && r) setGEvents(r.events || []); })
      .catch(() => {});
    return () => { on = false; };
  }, [revision]);

  useEffect(() => {
    let on = true;
    const now = Date.now();
    icloud.status()
      .then((s) => (s.connected ? icloud.list({ timeMin: new Date(now - 14 * DAY).toISOString(), timeMax: new Date(now + 90 * DAY).toISOString() }) : null))
      .then((r) => { if (on) setAppleEvents(r?.events || []); })
      .catch(() => {});
    return () => { on = false; };
  }, [revision]);

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
  }, [feedKey, revision]);

  const base = gEvents ?? localRows;
  return useMemo(
    () => mergeCalendarSources({ base, icloud: appleEvents, feeds: feedEvents }),
    [base, appleEvents, feedEvents]
  );
}
