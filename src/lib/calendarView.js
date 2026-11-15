export const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const sameDate = (a, b) => dateKey(a) === dateKey(b);
export function calendarDays(cursor, view = 'Month') {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), view === 'Month' ? 1 : cursor.getDate());
  start.setDate(start.getDate() - start.getDay());
  return Array.from({
    length: view === 'Month' ? 42 : 7
  }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}
export function moveCalendar(cursor, direction, view) {
  return view === 'Week' ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + direction * 7) : new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}
export function eventsForDay(events, date) {
  const key = dateKey(date),
    start = +new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    end = +new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return events.filter(e => {
    if (!e.starts_at) return false;
    if (e.all_day || /^\d{4}-\d{2}-\d{2}$/.test(e.starts_at)) return e.starts_at.slice(0, 10) <= key && (e.ends_at ? e.ends_at.slice(0, 10) > key : e.starts_at.slice(0, 10) === key);
    const from = Date.parse(e.starts_at),
      until = e.ends_at ? Date.parse(e.ends_at) : from + 1;
    return from < end && Math.max(from + 1, until) > start;
  }).sort((a, b) => Number(!!b.all_day) - Number(!!a.all_day) || a.starts_at.localeCompare(b.starts_at));
}
