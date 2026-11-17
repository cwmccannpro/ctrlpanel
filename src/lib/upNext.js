// Import-free so node --test can load it. Shared by the Day Plan panel and Drive.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Now" and "Next" for one day's items (calendar events + scheduled task blocks).
 * All-day, date-only and finished items never count. `progress` (0–1) is how far
 * through the current item `now` is. On a day other than today there is no "now":
 * the first timed item of the day is "next".
 */
export function upNext(dayItems = [], { now = new Date(), isToday = true } = {}) {
  const t = +now;
  const timed = dayItems
    .filter((e) => e && !e.all_day && !e.done && !DATE_ONLY.test(String(e.starts_at || '')) && Number.isFinite(Date.parse(e.starts_at)))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const endOf = (e) => (e.ends_at && Number.isFinite(Date.parse(e.ends_at)) ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 1);
  const current = isToday ? timed.find((e) => Date.parse(e.starts_at) <= t && endOf(e) > t) || null : null;
  const next = timed.find((e) => Date.parse(e.starts_at) > (isToday ? t : -Infinity)) || null;
  const progress = current && current.ends_at
    ? Math.max(0, Math.min(1, (t - Date.parse(current.starts_at)) / (endOf(current) - Date.parse(current.starts_at))))
    : 0;
  return { current, next, hero: current || next, progress };
}
