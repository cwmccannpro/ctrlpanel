// Pure helpers for writable calendar events (iCloud over CalDAV).
// Import-free so `node --test` can load it.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const shiftDate = (s, days) => {
  const [y, m, d] = s.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
};
const atLocal = (date, time) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

export const isAllDay = (e) => Boolean(e?.all_day) || DATE_ONLY.test(e?.starts_at || '');

/** Only iCloud events from a writable calendar that don't repeat. */
export const canEditEvent = (e) => e?.source === 'icloud' && e.editable === true && Boolean(e.href);

/**
 * Feeds and iCloud can carry the same event (a public link to a calendar that is
 * also connected over CalDAV). Keep iCloud's editable copy, drop the feed's.
 */
export function mergeCalendarSources({ base = [], icloud = [], feeds = [] } = {}) {
  if (!icloud.length) return feeds.length ? [...base, ...feeds] : base;
  const key = (e) => `${e.uid || e.title}|${e.starts_at}`;
  const seen = new Set(icloud.map(key));
  return [...base, ...icloud, ...feeds.filter((e) => !seen.has(key(e)))];
}

/** Editor form state for a new event starting at `startMin` on `date`. */
export function newDraft(date, { startMin = 9 * 60, mins = 60, calId = '' } = {}) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, startMin);
  const end = new Date(+start + mins * 60000);
  return {
    title: '',
    allDay: false,
    date: localDate(start),
    endDate: localDate(end),
    start: localTime(start),
    end: localTime(end),
    location: '',
    notes: '',
    calId,
  };
}

/** Editor form state from an existing event. All-day end dates are shown inclusive. */
export function draftFromEvent(e) {
  if (isAllDay(e)) {
    const date = e.starts_at.slice(0, 10);
    const endExcl = (e.ends_at || '').slice(0, 10);
    return {
      title: e.title || '',
      allDay: true,
      date,
      endDate: DATE_ONLY.test(endExcl) && endExcl > date ? shiftDate(endExcl, -1) : date,
      start: '09:00',
      end: '10:00',
      location: e.location || '',
      notes: e.notes || '',
      calId: e.cal_id || '',
    };
  }
  const s = new Date(e.starts_at);
  const en = e.ends_at ? new Date(e.ends_at) : new Date(+s + 3600000);
  return {
    title: e.title || '',
    allDay: false,
    date: localDate(s),
    endDate: localDate(en),
    start: localTime(s),
    end: localTime(en),
    location: e.location || '',
    notes: e.notes || '',
    calId: e.cal_id || '',
  };
}

/**
 * Form state → the event shape the API takes, or { error }.
 * A timed event whose end time is before its start on the same day runs past midnight.
 */
export function eventFromDraft(d) {
  const title = String(d.title || '').trim();
  if (!title) return { error: 'Give the event a title.' };
  if (!DATE_ONLY.test(d.date || '')) return { error: 'Pick a date.' };
  const base = { title, location: String(d.location || '').trim(), notes: String(d.notes || '').trim() };
  if (d.allDay) {
    const last = DATE_ONLY.test(d.endDate || '') ? d.endDate : d.date;
    if (last < d.date) return { error: 'The end date is before the start date.' };
    return { ...base, all_day: true, starts_at: d.date, ends_at: shiftDate(last, 1) };
  }
  if (!/^\d{2}:\d{2}$/.test(d.start || '') || !/^\d{2}:\d{2}$/.test(d.end || '')) return { error: 'Pick a start and end time.' };
  const start = atLocal(d.date, d.start);
  let end = atLocal(DATE_ONLY.test(d.endDate || '') && d.endDate >= d.date ? d.endDate : d.date, d.end);
  if (end <= start && (!d.endDate || d.endDate <= d.date)) end = new Date(+end + DAY);
  if (end <= start) return { error: 'The end is before the start.' };
  return { ...base, all_day: false, starts_at: start.toISOString(), ends_at: end.toISOString() };
}
