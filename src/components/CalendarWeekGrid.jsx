import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dateKey, eventsForDay, sameDate } from '../lib/calendarView.js';
import { GRID, layoutDay } from '../lib/weekLayout.js';
import { SLOT, busyOnDay, clampDuration, dayLoad, durationLabel, edgesOnDay, snapToSlot, tintFor } from '../lib/taskBlocks.js';
import '../styles/calendar-week.css';
import '../styles/calendar-tasks.css';

const HOURS = GRID.end - GRID.start; // 18 → 6 AM to midnight
const MIN_HOUR_PX = 30;
const MAX_HOUR_PX = 64;
const PAD = 10; // breathing room above the first and below the last hour label

const hourLabel = (h) => new Date(2000, 0, 1, h % 24).toLocaleTimeString([], { hour: 'numeric' });
const clock = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const atMin = (date, min) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, min);
const range = (e) => (e.ends_at ? `${clock(e.starts_at)} – ${clock(e.ends_at)}` : clock(e.starts_at));
const colorOf = (e) => e.color || 'var(--accent)';

/**
 * A time grid: vertical 6 AM–midnight axis, every event positioned and sized by
 * when it happens and how long it lasts. Seven columns for the Calendar's Week,
 * one for the dashboard's Day Plan (`compact`).
 *
 * To Do tasks scheduled as time blocks render as dashed-edge blocks on top of the
 * calendar. When the task handlers are provided you can drag a task (from the
 * tray, or an existing block) onto a slot — it snaps to 15 minutes and magnetises
 * to the edges of neighbouring events — and drag a block's bottom edge to resize it.
 *
 * `drag` / `setDrag` carry the in-flight drag: { taskId, mins, grabMin }.
 */
export default function CalendarWeekGrid({
  days, events, selected, onSelect = () => {}, onOpen = () => {}, loading,
  compact = false, fixedHour,
  drag = null, setDrag = () => {}, onDropTask, onResizeTask, onToggleTask, onUnscheduleTask,
}) {
  const body = useRef(null);
  const cols = useRef([]);
  const [fit, setFit] = useState(40);
  const hour = fixedHour || fit;
  const [now, setNow] = useState(() => new Date());
  const [ghost, setGhost] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [hot, setHot] = useState(null); // task whose resize handle is under the pointer, so the block doesn't start a drag
  const planning = Boolean(onDropTask);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el || fixedHour) return undefined;
    const measure = () => setFit(Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, (el.clientHeight - PAD * 2) / HOURS)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedHour]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!drag) setGhost(null);
  }, [drag]);

  const perDay = useMemo(
    () => days.map((date) => ({ date, ...layoutDay(eventsForDay(events, date), date), load: dayLoad(events, date) })),
    [days, events]
  );
  const hasAllDay = perDay.some((d) => d.allDay.length);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowVisible = nowMin >= GRID.start * 60 && nowMin <= GRID.end * 60;
  const px = useCallback((min) => ((min - GRID.start * 60) / 60) * hour, [hour]);

  // When the window is too short to show every hour, open near now (or the morning).
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || el.dataset.scrolled || el.scrollHeight <= el.clientHeight + 1) return;
    const focus = days.some((d) => sameDate(d, now)) && nowVisible ? nowMin : 8 * 60;
    el.scrollTop = Math.max(0, px(Math.max(GRID.start * 60, focus - 60)));
    el.dataset.scrolled = '1';
  }, [hour, days, now, nowMin, nowVisible, px]);

  /* ---------- drag & drop: tasks onto time slots ---------- */
  const slotFor = (e, i) => {
    const colTop = cols.current[i].getBoundingClientRect().top;
    const raw = GRID.start * 60 + ((e.clientY - colTop) / hour) * 60 - (drag.grabMin || 0);
    const edges = edgesOnDay(events, days[i], { skipTaskId: drag.taskId });
    const { start, edge } = snapToSlot({ rawMin: raw, mins: drag.mins, edges });
    const overlaps = busyOnDay(events, days[i], { skipTaskId: drag.taskId }).filter(([s, en]) => s < start + drag.mins && en > start).length;
    // Overlapping blocks stack side by side, so preview the lane this one will take:
    // run the same layout with the dragged block placed (and its old position removed).
    const probe = { id: '__ghost__', kind: 'task', task_id: drag.taskId, starts_at: atMin(days[i], start).toISOString(), ends_at: atMin(days[i], start + drag.mins).toISOString() };
    const placed = layoutDay(eventsForDay([...events.filter((x) => x.task_id !== drag.taskId), probe], days[i]), days[i]).blocks.find((b) => b.event === probe);
    return { col: i, start, mins: drag.mins, edge, overlaps, lane: placed?.col ?? 0, lanes: placed?.cols ?? 1 };
  };
  const onDragOver = (e, i) => {
    if (!drag || !planning) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const g = slotFor(e, i);
    setGhost((p) => (p && p.col === g.col && p.start === g.start && p.edge === g.edge && p.overlaps === g.overlaps && p.lane === g.lane && p.lanes === g.lanes ? p : g));
  };
  const onDrop = (e, i) => {
    if (!drag || !planning) return;
    e.preventDefault();
    const g = slotFor(e, i);
    onDropTask(drag.taskId, days[i], g.start, drag.mins);
    setGhost(null);
    setDrag(null);
  };
  const onGridLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setGhost(null);
  };
  const startBlockDrag = (e, item) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.title);
    // Defer so the browser snapshots the block before it dims.
    setTimeout(() => setDrag({ taskId: item.task_id, mins: item.mins, grabMin: Math.min(item.mins - 5, Math.max(0, ((e.clientY - top) / hour) * 60)), from: 'grid' }), 0);
  };

  /* ---------- resize a task block from its bottom edge ---------- */
  const startResize = (e, item, topMin) => {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const base = item.mins;
    const cap = GRID.end * 60 - topMin;
    let last = base;
    setResizing({ id: item.task_id, mins: base });
    const move = (ev) => {
      last = Math.min(cap, clampDuration(base + ((ev.clientY - y0) / hour) * 60));
      setResizing({ id: item.task_id, mins: last });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setResizing(null);
      if (last !== base) onResizeTask?.(item.task_id, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const renderTask = (b, e) => {
    const mins = resizing?.id === e.task_id ? resizing.mins : e.mins;
    const bottom = resizing?.id === e.task_id ? b.top + mins : b.bottom;
    const height = Math.max(18, px(bottom) - px(b.top) - 2);
    const size = height < 28 ? 's' : height < 48 ? 'm' : 'l';
    const dragging = drag?.taskId === e.task_id;
    return (
      <div
        key={`${e.cal_id}-${e.id}`}
        role="button"
        tabIndex={0}
        draggable={planning && hot !== e.task_id && !resizing}
        className={`wk-event wk-task wk-event--${size} ${b.cols >= 3 ? 'wk-narrow' : ''} ${e.done ? 'is-done' : ''} ${dragging ? 'is-dragging' : ''} ${resizing?.id === e.task_id ? 'is-resizing' : ''}`}
        style={{
          top: px(b.top) + 1,
          height,
          left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
          width: `calc(${100 / b.cols}% - 4px)`,
          '--event-color': tintFor(e.priority),
        }}
        onClick={() => onOpen(e)}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e); } }}
        onDragStart={(ev) => startBlockDrag(ev, e)}
        onDragEnd={() => { setDrag(null); setGhost(null); }}
        aria-label={`Task: ${e.title}, ${range(e)}${e.done ? ', done' : ''}`}
        title={`${e.title}\n${range(e)} · ${durationLabel(mins)}\nDrag to move · drag the bottom edge to resize`}
      >
        <button
          className="wk-check"
          aria-label={e.done ? 'Mark not done' : 'Mark done'}
          aria-pressed={e.done}
          onClick={(ev) => { ev.stopPropagation(); onToggleTask?.(e.task_id); }}
          onDragStart={(ev) => ev.preventDefault()}
        >
          {e.done && <i className="ti ti-check" />}
        </button>
        <div className="wk-task-text">
          <strong>{e.title}</strong>
          {size !== 's' && <time>{clock(e.starts_at)} · {durationLabel(mins)}</time>}
        </div>
        {onUnscheduleTask && (
          <button className="wk-unschedule" aria-label="Remove from calendar" title="Remove from calendar" onClick={(ev) => { ev.stopPropagation(); onUnscheduleTask(e.task_id); }} onDragStart={(ev) => ev.preventDefault()}>
            <i className="ti ti-x" />
          </button>
        )}
        {planning && <span className="wk-resize" onPointerEnter={() => setHot(e.task_id)} onPointerLeave={() => setHot(null)} onPointerDown={(ev) => startResize(ev, e, b.top)} aria-hidden="true" />}
      </div>
    );
  };

  return (
    <div
      className={`wk ${compact ? 'wk--compact' : ''} ${drag ? 'wk--dragging' : ''}`}
      aria-busy={loading}
      style={{ '--hour': `${hour}px`, '--cols': days.length }}
    >
      {!compact && (
        <div className="wk-head">
          <span className="wk-gutter" />
          {perDay.map(({ date, before, load }) => {
            const today = sameDate(date, now);
            return (
              <button
                key={dateKey(date)}
                className={`wk-day ${today ? 'today' : ''} ${sameDate(date, selected) ? 'selected' : ''}`}
                aria-pressed={sameDate(date, selected)}
                aria-label={date.toLocaleDateString([], { dateStyle: 'full' })}
                onClick={() => onSelect(date)}
                title={`${durationLabel(load.busy)} booked · ${durationLabel(Math.max(0, load.free))} free (6 AM–midnight)`}
              >
                <small>{date.toLocaleDateString([], { weekday: 'short' })}</small>
                <b>{date.getDate()}</b>
                {before > 0 && <em title={`${before} earlier than 6 AM`}>↑ {before}</em>}
                <span className="wk-load" style={{ '--load': Math.min(1, load.busy / (HOURS * 60)) }} />
              </button>
            );
          })}
        </div>
      )}

      {hasAllDay && (
        <div className="wk-allday">
          <span className="wk-gutter">all-day</span>
          {perDay.map(({ date, allDay }) => (
            <div key={dateKey(date)} className="wk-allday-cell">
              {allDay.slice(0, 3).map((e) => (
                <button key={`${e.cal_id || ''}-${e.id}`} className="wk-chip" style={{ '--event-color': colorOf(e) }} onClick={() => onOpen(e)} title={e.title}>
                  {e.title || 'Untitled event'}
                </button>
              ))}
              {allDay.length > 3 && <small>+{allDay.length - 3} more</small>}
            </div>
          ))}
        </div>
      )}

      <div className="wk-body" ref={body} onDragLeave={onGridLeave}>
        <div className="wk-canvas" style={{ height: HOURS * hour + PAD * 2 }}>
          <div className="wk-hours" aria-hidden="true">
            {Array.from({ length: HOURS + 1 }, (_, i) => (
              <span key={i} style={{ top: PAD + i * hour }}>{hourLabel(GRID.start + i)}</span>
            ))}
          </div>
          <div className="wk-cols" style={{ top: PAD, height: HOURS * hour }}>
            {perDay.map(({ date, blocks, after }, i) => {
              const today = sameDate(date, now);
              return (
                <div
                  key={dateKey(date)}
                  ref={(el) => { cols.current[i] = el; }}
                  className={`wk-col ${today ? 'today' : ''} ${!compact && sameDate(date, selected) ? 'selected' : ''} ${ghost?.col === i ? 'is-target' : ''}`}
                  onDragOver={(e) => onDragOver(e, i)}
                  onDrop={(e) => onDrop(e, i)}
                >
                  {blocks.map((b) => {
                    const e = b.event;
                    if (e.kind === 'task') return renderTask(b, e);
                    const height = Math.max(18, px(b.bottom) - px(b.top) - 2);
                    const size = height < 28 ? 's' : height < 48 ? 'm' : 'l';
                    return (
                      <button
                        key={`${e.cal_id || ''}-${e.id}`}
                        className={`wk-event wk-event--${size} ${b.clipTop ? 'clip-top' : ''} ${b.clipBottom ? 'clip-bottom' : ''}`}
                        style={{
                          top: px(b.top) + 1,
                          height,
                          left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                          width: `calc(${100 / b.cols}% - 4px)`,
                          '--event-color': colorOf(e),
                        }}
                        onClick={() => onOpen(e)}
                        aria-label={`${e.title || 'Untitled event'}, ${range(e)}${e.calendar ? `, ${e.calendar}` : ''}`}
                        title={`${e.title || 'Untitled event'}\n${range(e)}${e.location ? `\n${e.location}` : ''}`}
                      >
                        <strong>{e.title || 'Untitled event'}</strong>
                        {size !== 's' && <time>{range(e)}</time>}
                        {size === 'l' && e.location && <span>{e.location}</span>}
                      </button>
                    );
                  })}
                  {ghost?.col === i && drag && (
                    <div
                      className={`wk-ghost ${ghost.overlaps ? 'stack' : ''} ${ghost.edge != null ? 'magnet' : ''}`}
                      style={{
                        top: px(ghost.start) + 1,
                        height: Math.max(18, (ghost.mins / 60) * hour - 2),
                        left: `calc(${(ghost.lane / ghost.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / ghost.lanes}% - 4px)`,
                      }}
                    >
                      <time>{clock(atMin(date, ghost.start))} – {clock(atMin(date, ghost.start + ghost.mins))}</time>
                      <em>{ghost.overlaps ? `Beside ${ghost.overlaps} ${ghost.overlaps === 1 ? 'item' : 'items'}` : ghost.edge != null ? 'Snapped to event' : `${SLOT}-min grid`}</em>
                    </div>
                  )}
                  {after > 0 && <em className="wk-after" title={`${after} later events`}>↓ {after}</em>}
                  {today && nowVisible && <i className="wk-now" style={{ top: px(nowMin) }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

