import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import CalendarWeekGrid from './CalendarWeekGrid.jsx';
import CalendarEventEditor from './CalendarEventEditor.jsx';
import DayPlanHero from './DayPlanHero.jsx';
import { icloud } from '../lib/api.js';
import { canEditEvent, newDraft } from '../lib/calendarEdit.js';
import { eventsForDay } from '../lib/calendarView.js';
import { dayKey } from '../lib/helpers.js';
import { dayLoad, durationLabel } from '../lib/taskBlocks.js';
import { useTaskDrag } from '../lib/taskDrag.js';
import { refreshCalendarEvents, useCalendarEvents } from '../lib/useCalendarEvents.js';
import { useTaskPlanner } from '../lib/useTaskPlanner.js';
import { GRID } from '../lib/weekLayout.js';
import { upNext } from '../lib/upNext.js';
import '../styles/dayplan.css';

// Timeline height (px). Dragging its bottom edge changes it; it's saved per panel
// in cfg.timelineH. "Full day" sizes it so every hour from 6 AM to midnight shows.
const DEFAULT_H = 360;
const MIN_H = 180;
const MAX_H = 1600;
const FULL_HOUR_PX = 34;
const clampH = (h) => Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));

const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atMin = (d, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m);

/**
 * Dashboard "Day Plan": the day as a 6 AM–midnight timeline (calendar events and
 * scheduled To Do blocks together), a live Now/Next card, and booked-vs-free stats.
 *
 * Task rows in the other dashboard panels (To Do boards, Due Soon, Today) drag onto
 * the timeline too; the in-flight drag is shared through lib/taskDrag.js. Blocks that
 * overlap each other or a calendar event sit side by side (lanes from weekLayout.js).
 */
export default function DayPlanPanel({ cfg = {}, onCfg = () => {} }) {
  const navigate = useNavigate();
  const events = useCalendarEvents();
  const timeline = useRef(null);
  const saved = Number(cfg.timelineH) > 0 ? clampH(Number(cfg.timelineH)) : DEFAULT_H;
  const [height, setHeight] = useState(saved);
  const [resizing, setResizing] = useState(false);
  useEffect(() => { if (!resizing) setHeight(saved); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [writable, setWritable] = useState(false);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    let on = true;
    icloud.status().then((s) => { if (on) setWritable(Boolean(s.connected)); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const planner = useTaskPlanner();
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useTaskDrag();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const nowKey = dayKey(now);
  const today = useMemo(() => startOf(new Date()), [nowKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const date = useMemo(() => addDays(today, offset), [today, offset]);
  const isToday = offset === 0;
  const items = useMemo(() => [...events, ...planner.items], [events, planner.items]);
  const dayItems = useMemo(() => eventsForDay(items, date), [items, date]);
  const load = useMemo(() => dayLoad(items, date), [items, date]);
  const plan = upNext(dayItems, { now, isToday });

  const dayTasks = dayItems.filter((e) => e.kind === 'task');
  const eventCount = dayItems.length - dayTasks.length;

  const open = (e) => (canEditEvent(e) ? setEditing({ event: e }) : navigate(e.kind === 'task' ? '/todo' : '/calendar'));
  const createAt = (d, startMin) => setEditing({ draft: newDraft(d, { startMin }) });

  /* ---------- timeline height: drag the bottom edge, or toggle the full day ---------- */
  // Height at which every hour shows at FULL_HOUR_PX (chrome = all-day row + borders).
  const fullHeight = () => {
    const el = timeline.current;
    const body = el?.querySelector('.wk-body');
    const chrome = el && body ? el.offsetHeight - body.clientHeight : 2;
    return clampH(chrome + (GRID.end - GRID.start) * FULL_HOUR_PX + 20);
  };
  const isFull = height >= fullHeight() - 4;
  const commit = (h) => { setHeight(h); onCfg({ timelineH: h }); };
  const toggleFull = () => commit(isFull ? DEFAULT_H : fullHeight());
  const startResize = (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    let last = h0;
    setResizing(true);
    const move = (ev) => { last = clampH(h0 + ev.clientY - y0); setHeight(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setResizing(false);
      if (last !== h0) onCfg({ timelineH: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const resizeKey = (e) => {
    const step = { ArrowDown: 40, ArrowUp: -40 }[e.key];
    if (step) { e.preventDefault(); commit(clampH(height + step)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFull(); }
  };

  // A task added on the dashboard after this panel loaded isn't in the planner's copy
  // yet — fetch it first, or its block would be hidden as "deleted".
  const dropTask = async (taskId, d, startMin, m) => {
    if (!planner.tasks.some((t) => t.id === taskId)) await planner.reload();
    planner.place(taskId, atMin(d, startMin), m, drag?.title);
  };

  return (
    <>
      <div className="dash2-panel-head">
        <Link to="/calendar" className="dash2-panel-title dash2-link" style={{ marginBottom: 0 }}>Day Plan <i className="ti ti-arrow-up-right" /></Link>
        <div className="dp-nav">
          <button className="btn btn--ghost btn--icon" aria-label="Previous day" onClick={() => setOffset((o) => o - 1)}><i className="ti ti-chevron-left" /></button>
          <button className="dp-today" onClick={() => setOffset(0)} disabled={isToday} title="Jump to today">
            {isToday ? 'Today' : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </button>
          <button className="btn btn--ghost btn--icon" aria-label="Next day" onClick={() => setOffset((o) => o + 1)}><i className="ti ti-chevron-right" /></button>
          <button
            className={`btn btn--ghost btn--icon dp-full ${isFull ? 'on' : ''}`}
            aria-pressed={isFull}
            aria-label={isFull ? 'Shrink the timeline' : 'Show the full day'}
            title={isFull ? 'Shrink the timeline' : 'Show the full day (or drag the timeline’s bottom edge)'}
            onClick={toggleFull}
          >
            <i className={`ti ${isFull ? 'ti-arrows-minimize' : 'ti-arrows-vertical'}`} />
          </button>
          {writable && (
            <button className="btn btn--ghost btn--icon" aria-label="New event" title="New iCloud event" onClick={() => createAt(date, isToday ? Math.min(22 * 60 + 30, Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30) : 9 * 60)}>
              <i className="ti ti-plus" />
            </button>
          )}
        </div>
      </div>

      <div className="dp-date">{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>

      <DayPlanHero plan={plan} now={now} isToday={isToday} free={load.free} />

      <div className="dp-stats">
        <div><b>{durationLabel(load.busy)}</b><span>booked</span></div>
        <div><b>{durationLabel(Math.max(0, load.free))}</b><span>free</span></div>
        <div><b>{eventCount}</b><span>events</span></div>
        <div><b>{dayTasks.filter((t) => t.done).length}/{dayTasks.length}</b><span>tasks</span></div>
      </div>
      <div className="dp-load" aria-hidden="true"><i style={{ width: `${Math.min(100, (load.busy / (18 * 60)) * 100)}%` }} /></div>

      <div ref={timeline} className={`dp-timeline ${resizing ? 'is-resizing' : ''}`} style={{ height }}>
        <CalendarWeekGrid
          days={[date]}
          events={items}
          compact
          onOpen={open}
          onCreateAt={writable ? createAt : undefined}
          drag={drag}
          setDrag={setDrag}
          onDropTask={dropTask}
          onResizeTask={planner.resize}
          onToggleTask={(id) => { const t = planner.tasks.find((x) => x.id === id); if (t) planner.toggleDone(t); }}
          onUnscheduleTask={planner.unschedule}
        />
        <div
          className="dp-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Timeline height. Drag, or use the arrow keys; Enter shows the full day."
          aria-valuenow={height}
          aria-valuemin={MIN_H}
          aria-valuemax={MAX_H}
          tabIndex={0}
          title="Drag to resize · double-click for the full day"
          onPointerDown={startResize}
          onDoubleClick={toggleFull}
          onKeyDown={resizeKey}
        >
          <i />
        </div>
      </div>

      {editing && <CalendarEventEditor event={editing.event} draft={editing.draft} onSaved={refreshCalendarEvents} onClose={() => setEditing(null)} />}
    </>
  );
}
