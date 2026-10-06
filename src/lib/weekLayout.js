// Time-grid layout for the Week view: where each timed event sits vertically
// (minutes from midnight, clipped to the visible 6 AM–midnight window) and which
// side-by-side lane it takes when events overlap. Pure and import-free so
// `node --test` can load it.

const MIN = 60000;
export const GRID = { start: 6, end: 24 }; // visible hours: 6 AM → midnight

const isDateOnly = (e) => Boolean(e.all_day) || /^\d{4}-\d{2}-\d{2}$/.test(e.starts_at || '');

/**
 * events: the events overlapping `date` (e.g. from eventsForDay).
 * → {
 *   allDay: events for the all-day row (date-only, or filling the whole visible day),
 *   blocks: [{ event, top, bottom, col, cols, clipTop, clipBottom }]  // top/bottom in minutes from midnight
 *   before, after: timed events that fall wholly outside the 6 AM–midnight window
 * }
 */
export function layoutDay(events, date, { startHour = GRID.start, endHour = GRID.end, minMinutes = 30 } = {}) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const lo = startHour * 60;
  const hi = endHour * 60;
  const allDay = [];
  const blocks = [];
  let before = 0;
  let after = 0;

  for (const event of events) {
    if (isDateOnly(event)) {
      allDay.push(event);
      continue;
    }
    const s = (Date.parse(event.starts_at) - dayStart) / MIN;
    if (!Number.isFinite(s)) continue;
    const parsedEnd = event.ends_at ? (Date.parse(event.ends_at) - dayStart) / MIN : s;
    const e = Math.max(Number.isFinite(parsedEnd) ? parsedEnd : s, s + 1);

    if (e <= lo) { before++; continue; }
    if (s >= hi) { after++; continue; }
    if (s <= lo && e >= hi) { allDay.push(event); continue; } // spans the whole visible day

    let top = Math.max(s, lo);
    let bottom = Math.max(Math.min(e, hi), top + minMinutes); // short events keep a readable height
    if (bottom > hi) {
      bottom = hi;
      top = Math.min(top, hi - minMinutes);
    }
    blocks.push({ event, top, bottom, col: 0, cols: 1, clipTop: s < lo, clipBottom: e > hi });
  }

  // Lanes: events that chain-overlap share a cluster; each takes the first free column.
  blocks.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster = [];
  let clusterEnd = -1;
  let laneEnds = [];
  const flush = () => {
    for (const b of cluster) b.cols = laneEnds.length || 1;
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };
  for (const b of blocks) {
    if (cluster.length && b.top >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= b.top);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(b.bottom); } else laneEnds[lane] = b.bottom;
    b.col = lane;
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.bottom);
  }
  flush();

  return { allDay, blocks, before, after };
}
