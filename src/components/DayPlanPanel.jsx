import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import CalendarWeekGrid from './CalendarWeekGrid.jsx';
import CalendarEventEditor from './CalendarEventEditor.jsx';
import { icloud } from '../lib/api.js';
import { canEditEvent, newDraft } from '../lib/calendarEdit.js';
import { eventsForDay } from '../lib/calendarView.js';
import { dayKey, parseLocalDate } from '../lib/helpers.js';
import { DEFAULT_MINS, DURATIONS, dayLoad, durationLabel, tintFor } from '../lib/taskBlocks.js';
import { useTaskDrag } from '../lib/taskDrag.js';
import { refreshCalendarEvents, useCalendarEvents } from '../lib/useCalendarEvents.js';
import { useTaskPlanner } from '../lib/useTaskPlanner.js';
import { GRID } from '../lib/weekLayout.js';
import '../styles/dayplan.css';

// Timeline height (px). Dragging its bottom edge changes it; it's saved per panel
// in cfg.timelineH. "Full day" sizes it so every hour from 6 AM to midnight shows.
const DEFAULT_H = 360;
const MIN_H = 180;
const MAX_H = 1600;
const FULL_HOUR_PX = 34;
const clampH = (h) => Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));

const RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const clock = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atMin = (d, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m);
const span = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
};

/**
 * Dashboard "Day Plan": the day as a 6 AM–midnight timeline (calendar events and
 * scheduled To Do blocks together), a live Now/Next card, booked-vs-free stats, and
 * a list of tasks that still need a time — drag them onto the timeline or tap ⚡.
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
  const [mins, setMins] = useState({});
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
  const timed = useMemo(
    () => dayItems.filter((e) => !e.all_day && !/^\d{4}-\d{2}-\d{2}$/.test(e.starts_at || '') && !e.done).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [dayItems]
  );
  const load = useMemo(() => dayLoad(items, date), [items, date]);

  // Now / Next
  const current = isToday ? timed.find((e) => Date.parse(e.starts_at) <= +now && (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 1) > +now) : null;
  const next = timed.find((e) => Date.parse(e.starts_at) > (isToday ? +now : -Infinity));
  const hero = current || next;
  const progress = current && current.ends_at ? Math.min(1, (+now - Date.parse(current.starts_at)) / (Date.parse(current.ends_at) - Date.parse(current.starts_at))) : 0;

  const dayTasks = dayItems.filter((e) => e.kind === 'task');
  const eventCount = dayItems.length - dayTasks.length;

  // Tasks still needing a time: overdue + due on the shown day.
  const dayStr = dayKey(date);
  const todo = useMemo(
    () => planner.unscheduled
      .filter((t) => t.due_date && (t.due_date === dayStr || (isToday && parseLocalDate(t.due_date) < today)))
      .sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9)),
    [planner.unscheduled, dayStr, isToday, today]
  );
  const lengthOf = (t) => mins[t.id] || DEFAULT_MINS;
  const cycle = (t) => setMins((m) => ({ ...m, [t.id]: DURATIONS[(DURATIONS.indexOf(lengthOf(t)) + 1) % DURATIONS.length] }));
  const snap = (t) => planner.snapToNextFree(t, items, { mins: lengthOf(t), from: isToday ? new Date() : date });

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

      <div className="dp-hero" style={hero ? { '--event-color': hero.kind === 'task' ? tintFor(hero.priority) : hero.color || 'var(--accent)' } : undefined}>
        {hero ? (
          <>
            <span className="dp-hero-label">{current ? 'Now' : 'Next'}</span>
            <strong>{hero.title}</strong>
            <span className="dp-hero-meta">
              {current
                ? `until ${clock(hero.ends_at)} · ${span(Date.parse(hero.ends_at) - +now)} left`
                : isToday
                  ? `${clock(hero.starts_at)} · in ${span(Date.parse(hero.starts_at) - +now)}`
                  : `${clock(hero.starts_at)}${hero.ends_at ? ` – ${clock(hero.ends_at)}` : ''}`}
              {hero.kind === 'task' ? ' · task' : hero.calendar ? ` · ${hero.calendar}` : ''}
            </span>
            {current && <div className="dp-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress * 100}%` }} /></div>}
          </>
        ) : (
          <>
            <span className="dp-hero-label">{isToday ? 'Clear' : 'Open day'}</span>
            <strong>{isToday ? 'Nothing else on the calendar' : 'Nothing scheduled'}</strong>
            <span className="dp-hero-meta">{durationLabel(Math.max(0, load.free))} free · drag a task here to plan it</span>
          </>
        )}
      </div>

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

      {todo.length > 0 && (
        <div className="dp-todo">
          <div className="dp-todo-head"><span>Needs a time</span><small>{todo.length}</small></div>
          {todo.slice(0, 5).map((t) => (
            <div
              key={t.id}
              className={`dp-task ${drag?.taskId === t.id ? 'is-dragging' : ''}`}
              style={{ '--tint': tintFor(t.priority) }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', t.title || 'Task');
                const m = lengthOf(t);
                setTimeout(() => setDrag({ taskId: t.id, mins: m, grabMin: Math.min(10, m / 2), from: 'list' }), 0);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <i className="ti ti-grip-vertical dp-grip" aria-hidden="true" />
              <span className="dp-task-title" title={t.title}>{t.title}</span>
              <button className="dp-chip" onClick={() => cycle(t)} title="Duration — click to change">{durationLabel(lengthOf(t))}</button>
              <button className="dp-snap" onClick={() => snap(t)} title="Snap to the next free slot" aria-label={`Snap ${t.title} to the next free slot`}><i className="ti ti-bolt" /></button>
            </div>
          ))}
          {todo.length > 5 && <Link className="dp-more" to="/calendar">+{todo.length - 5} more in Calendar</Link>}
        </div>
      )}
      {editing && <CalendarEventEditor event={editing.event} draft={editing.draft} onSaved={refreshCalendarEvents} onClose={() => setEditing(null)} />}
    </>
  );
}
