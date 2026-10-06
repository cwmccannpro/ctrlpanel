import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Modal from '../components/shared/Modal.jsx';
import { loadCalendarEvents } from '../lib/calendarData.js';
import CalendarFeeds from '../components/CalendarFeeds.jsx';
import CalendarWeekGrid from '../components/CalendarWeekGrid.jsx';
import TaskTray from '../components/TaskTray.jsx';
import TaskBlockDetail from '../components/TaskBlockDetail.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { useTaskPlanner } from '../lib/useTaskPlanner.js';
import { gcal, ical } from '../lib/api.js';
import { calendarDays, dateKey, eventsForDay, moveCalendar, sameDate } from '../lib/calendarView.js';
import { feedName } from '../lib/icalFeeds.js';
import { useIcalFeeds } from '../lib/useIcalFeeds.js';
import '../styles/calendar.css';
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time = value => new Date(value).toLocaleTimeString([], {
  hour: 'numeric',
  minute: '2-digit'
});
const allDay = e => e.all_day || /^\d{4}-\d{2}-\d{2}$/.test(e.starts_at || '');
const eventTime = e => allDay(e) ? 'All day' : `${time(e.starts_at)}${e.ends_at ? ` – ${time(e.ends_at)}` : ''}`;
export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [view, setView] = useState('Week');
  const [events, setEvents] = useState([]);
  const { updateUiPreferences } = useAuth();
  const feeds = useIcalFeeds();
  const feedKey = JSON.stringify(feeds);
  const [feedHealth, setFeedHealth] = useState({});
  const [managing, setManaging] = useState(false);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState({
    connected: false,
    ready: false
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null);
  const planner = useTaskPlanner();
  const [drag, setDrag] = useState(null);
  const [tray, setTray] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1100);
  const grid = useRef(null);
  const days = useMemo(() => calendarDays(cursor, view), [cursor, view]);
  const firstDay = dateKey(days[0]),
    lastDay = dateKey(days.at(-1));
  useEffect(() => {
    if (!params.get('google')) return;
    const next = new URLSearchParams(params);
    next.delete('google');
    next.delete('message');
    setParams(next, {
      replace: true
    });
  }, [params, setParams]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        let connection;
        try {
          connection = await gcal.status();
        } catch {
          connection = {
            connected: false,
            ready: false
          };
        }
        if (!active) return;
        setStatus(connection);
        let rows;
        const until = new Date(`${lastDay}T00:00:00`);
        until.setDate(until.getDate() + 1);
        const from = new Date(`${firstDay}T00:00:00`).toISOString();
        let sourceNote = '';
        try {
          if (connection.connected) {
            const result = await gcal.list({
              timeMin: from,
              timeMax: until.toISOString()
            });
            if (!result.connected) throw new Error('Reconnect Google Calendar to load events.');
            rows = result.events || [];
          } else {
            rows = await loadCalendarEvents(from, until.toISOString());
          }
        } catch (e) {
          // With feeds configured, a broken Google/saved source must not hide them.
          if (!feeds.length) throw e;
          rows = [];
          sourceNote = e.message || 'Events could not load.';
        }
        if (active) setNotice(sourceNote);
        // Read-only .ics feeds. One broken feed is reported, never fatal.
        if (feeds.length) {
          try {
            const feedResult = await ical.events(feeds, { timeMin: from, timeMax: until.toISOString() });
            if (!active) return;
            rows = [...rows, ...(feedResult.events || [])];
            setFeedHealth(Object.fromEntries((feedResult.feeds || []).map(f => [f.id, f])));
          } catch (e) {
            if (!active) return;
            setFeedHealth(Object.fromEntries(feeds.map(f => [f.id, { ok: false, error: e.message || 'Feed failed to load.' }])));
          }
        } else if (active) {
          setFeedHealth({});
        }
        if (active) setEvents(rows);
      } catch (e) {
        if (active) {
          setError(e.message || 'Events could not load.');
          setEvents([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
    // feedKey carries the feed list's content; `feeds` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, lastDay, revision, feedKey]);
  const saveFeeds = async next => {
    await updateUiPreferences('calendar', {
      feeds: next
    });
  };
  const brokenFeeds = feeds.filter(f => feedHealth[f.id] && !feedHealth[f.id].ok);
  // Calendar events plus the To Do tasks the user has time-blocked.
  const items = useMemo(() => [...events, ...planner.items], [events, planner.items]);
  const selectedEvents = useMemo(() => eventsForDay(items, selected), [items, selected]);
  const weekMode = view === 'Week';
  const toggleTask = id => {
    const task = planner.tasks.find(t => t.id === id);
    if (task) planner.toggleDone(task);
  };
  const snapTask = (task, mins) => planner.snapToNextFree(task, items, {
    mins
  });
  const openTask = task => {
    const block = planner.items.find(i => i.task_id === task.id);
    setDetail(block || {
      kind: 'task',
      task_id: task.id,
      title: task.title,
      priority: task.priority,
      due_date: task.due_date,
      calendar: 'To Do',
      color: 'var(--accent)',
      unplaced: true,
      mins: 30
    });
  };
  const choose = date => {
    setSelected(date);
    if (!days.some(d => sameDate(d, date))) setCursor(date);
  };
  const move = direction => {
    const next = moveCalendar(cursor, direction, view);
    setCursor(next);
    setSelected(next);
  };
  const today = () => {
    const now = new Date();
    setCursor(now);
    setSelected(now);
  };
  const keyboard = (event, date) => {
    const offset = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7
    }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    choose(next);
    requestAnimationFrame(() => grid.current?.querySelector(`[data-date="${dateKey(next)}"]`)?.focus());
  };
  const rangeLabel = () => {
    const a = days[0], b = days.at(-1);
    const m = d => d.toLocaleDateString([], {
      month: 'short'
    });
    return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getDate()} – ${b.getDate()}` : `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}`;
  };
  const legend = [...feeds.map(f => ({
    id: f.id,
    name: feedName(f),
    color: f.color
  })), ...(planner.items.length || planner.unscheduled.length ? [{
    id: 'tasks',
    name: 'To Do blocks',
    color: 'var(--accent)',
    dashed: true
  }] : [])];
  const sourceFooter = <footer className={`calendar-source ${weekMode ? 'calendar-source--bar' : ''}`}>
    <span>{[status.connected ? 'Google Calendar' : feeds.length ? '' : 'Saved events', feeds.length ? `${feeds.length} iCal feed${feeds.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ')} · Read only</span>
    {weekMode && legend.length > 0 && <div className="calendar-legend">{legend.map(l => <span key={l.id} className={l.dashed ? 'dashed' : ''} style={{
      '--event-color': l.color
    }}><i />{l.name}</span>)}</div>}
    <button className="btn btn--ghost btn--icon" aria-label="Refresh events" disabled={loading} onClick={() => setRevision(r => r + 1)}><i className="ti ti-refresh" /></button>
    <button className="btn btn--sm" onClick={() => setManaging(true)}><i className="ti ti-rss" /> Feeds</button>
    {!status.connected && status.ready && !feeds.length && <button className="btn btn--sm" onClick={() => gcal.connect().catch(e => setError(e.message))}>Connect Google</button>}
    {status.connected && <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer">Open Google Calendar ↗</a>}
  </footer>;
  return <section className="calendar-page fade-in" aria-label="Calendar">
    <header className="calendar-toolbar"><h1>{weekMode ? <>{rangeLabel()} <span>{days.at(-1).getFullYear()}</span></> : <>{cursor.toLocaleDateString([], {
          month: 'long'
        })} <span>{cursor.getFullYear()}</span></>}</h1><div className="calendar-controls"><div className="segmented" aria-label="Calendar view">{['Month', 'Week'].map(v => <button key={v} aria-pressed={view === v} className={view === v ? 'active' : ''} onClick={() => {
            setCursor(selected);
            setView(v);
          }}>{v}</button>)}</div>{weekMode && <button className={`btn btn--ghost calendar-tray-toggle ${tray ? 'on' : ''}`} aria-pressed={tray} onClick={() => setTray(t => !t)}><i className="ti ti-checkbox" /> Tasks{planner.unscheduled.length > 0 && <small>{planner.unscheduled.length}</small>}</button>}<button className="btn btn--ghost" onClick={today}>Today</button><div className="row"><button className="btn btn--ghost btn--icon" aria-label={`Previous ${view.toLowerCase()}`} onClick={() => move(-1)}><i className="ti ti-chevron-left" /></button><button className="btn btn--ghost btn--icon" aria-label={`Next ${view.toLowerCase()}`} onClick={() => move(1)}><i className="ti ti-chevron-right" /></button></div></div></header>
    {error && <div className="calendar-error" role="alert">{error}<button className="btn btn--sm" onClick={() => setRevision(r => r + 1)}>Retry</button></div>}
    {!error && notice && <div className="calendar-error" role="status"><span>{notice}</span>{status.connected && <button className="btn btn--sm" onClick={() => gcal.connect().catch(e => setError(e.message))}>Reconnect</button>}</div>}
    {!error && brokenFeeds.length > 0 && <div className="calendar-error" role="alert"><span>{brokenFeeds.map(f => `${feedName(f)}: ${feedHealth[f.id].error}`).join(' · ')}</span><button className="btn btn--sm" onClick={() => setManaging(true)}>Feeds</button></div>}
    {weekMode ? <><div className={`calendar-layout calendar-layout--week ${tray ? 'has-tray' : ''}`}>
      <div className="calendar-sheet" aria-busy={loading}>
        <CalendarWeekGrid days={days} events={items} selected={selected} onSelect={choose} onOpen={setDetail} loading={loading} drag={drag} setDrag={setDrag} onDropTask={(id, date, startMin, mins) => planner.place(id, new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, startMin), mins)} onResizeTask={planner.resize} onToggleTask={toggleTask} onUnscheduleTask={planner.unschedule} />
      </div>
      {tray && <TaskTray planner={planner} drag={drag} setDrag={setDrag} onSnap={snapTask} onOpenTask={openTask} onClose={() => setTray(false)} />}
    </div>{sourceFooter}</> : <div className="calendar-layout calendar-layout--month"><div className="calendar-sheet" aria-busy={loading}><div className="calendar-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div><div className="calendar-dates" ref={grid}>
      {days.map(date => {
            const list = eventsForDay(items, date),
              chosen = sameDate(date, selected),
              limit = 2;
            return <button key={dateKey(date)} data-date={dateKey(date)} className={`calendar-date ${date.getMonth() !== cursor.getMonth() ? 'outside' : ''} ${sameDate(date, new Date()) ? 'today' : ''} ${chosen ? 'selected' : ''}`} aria-pressed={chosen} tabIndex={chosen ? 0 : -1} aria-label={`${date.toLocaleDateString([], {
              dateStyle: 'full'
            })}, ${list.length} events`} onClick={() => choose(date)} onKeyDown={e => keyboard(e, date)}><span className="calendar-day-number">{date.getDate()}</span><span className="calendar-cell-events">{list.slice(0, limit).map(e => <span className="calendar-cell-event" key={`${e.cal_id || ''}-${e.id}`} style={{
                  '--event-color': e.color || 'var(--accent)'
                }}><i style={{
                    background: e.color || 'var(--accent)'
                  }} /><span>{e.title || 'Untitled event'}</span></span>)}{list.length > limit && <small>+{list.length - limit} more</small>}</span>{list.length > 0 && <span className="calendar-mobile-dot" />}</button>;
          })}
    </div></div><aside className="calendar-agenda"><header><span>{selected.toLocaleDateString([], {
              weekday: 'long'
            })}</span><h2>{selected.toLocaleDateString([], {
              month: 'long',
              day: 'numeric'
            })}</h2></header><div className="calendar-agenda-events" aria-live="polite">{loading ? <p className="calendar-empty">Loading events…</p> : error ? <p className="calendar-empty">Events are unavailable.</p> : !selectedEvents.length ? <div className="calendar-empty"><i className="ti ti-sun" /><p>No events scheduled.</p></div> : selectedEvents.map(e => <button className="calendar-agenda-event" key={`${e.cal_id || ''}-${e.id}`} style={{
            '--event-color': e.color || 'var(--accent)'
          }} onClick={() => setDetail(e)}><time>{eventTime(e)}</time><strong>{e.title || 'Untitled event'}</strong>{e.calendar && <span>{e.calendar}</span>}</button>)}</div>{sourceFooter}</aside></div>}
    {detail && (detail.kind === 'task' ? <TaskBlockDetail item={detail} planner={planner} onSnap={snapTask} onClose={() => setDetail(null)} /> : <Modal title={detail.title || 'Event'} onClose={() => setDetail(null)}><div className="calendar-detail"><p>{allDay(detail) ? detail.starts_at.slice(0, 10) : new Date(detail.starts_at).toLocaleDateString([], {
            dateStyle: 'full'
          })}</p><p>{eventTime(detail)}</p>{detail.location && <p><i className="ti ti-map-pin" /> {detail.location}</p>}{detail.calendar && <p>{detail.calendar}</p>}{detail.html_link && /^https:\/\//.test(detail.html_link) && <a className="btn" href={detail.html_link} target="_blank" rel="noopener noreferrer">Open event ↗</a>}</div></Modal>)}
    {managing && <CalendarFeeds feeds={feeds} health={feedHealth} onSave={saveFeeds} onClose={() => setManaging(false)} />}
  </section>;
}
