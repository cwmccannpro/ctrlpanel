import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Modal from '../components/shared/Modal.jsx';
import { loadCalendarEvents } from '../lib/calendarData.js';
import { gcal } from '../lib/api.js';
import { calendarDays, dateKey, eventsForDay, moveCalendar, sameDate } from '../lib/calendarView.js';
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
  const [view, setView] = useState('Month');
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({
    connected: false,
    ready: false
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null);
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
  }, [firstDay, lastDay, revision]);
  const selectedEvents = useMemo(() => eventsForDay(events, selected), [events, selected]);
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
  return <section className="calendar-page fade-in" aria-label="Calendar">
    <header className="calendar-toolbar"><h1>{cursor.toLocaleDateString([], {
          month: 'long'
        })} <span>{cursor.getFullYear()}</span></h1><div className="calendar-controls"><div className="segmented" aria-label="Calendar view">{['Month', 'Week'].map(v => <button key={v} aria-pressed={view === v} className={view === v ? 'active' : ''} onClick={() => {
            setCursor(selected);
            setView(v);
          }}>{v}</button>)}</div><button className="btn btn--ghost" onClick={today}>Today</button><div className="row"><button className="btn btn--ghost btn--icon" aria-label={`Previous ${view.toLowerCase()}`} onClick={() => move(-1)}><i className="ti ti-chevron-left" /></button><button className="btn btn--ghost btn--icon" aria-label={`Next ${view.toLowerCase()}`} onClick={() => move(1)}><i className="ti ti-chevron-right" /></button></div></div></header>
    {error && <div className="calendar-error" role="alert">{error}<button className="btn btn--sm" onClick={() => setRevision(r => r + 1)}>Retry</button></div>}
    <div className={`calendar-layout calendar-layout--${view.toLowerCase()}`}><div className="calendar-sheet" aria-busy={loading}><div className="calendar-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div><div className="calendar-dates" ref={grid}>
      {days.map(date => {
            const list = eventsForDay(events, date),
              chosen = sameDate(date, selected),
              limit = view === 'Week' ? 5 : 2;
            return <button key={dateKey(date)} data-date={dateKey(date)} className={`calendar-date ${date.getMonth() !== cursor.getMonth() ? 'outside' : ''} ${sameDate(date, new Date()) ? 'today' : ''} ${chosen ? 'selected' : ''}`} aria-pressed={chosen} tabIndex={chosen ? 0 : -1} aria-label={`${date.toLocaleDateString([], {
              dateStyle: 'full'
            })}, ${list.length} events`} onClick={() => choose(date)} onKeyDown={e => keyboard(e, date)}><span className="calendar-day-number">{date.getDate()}</span><span className="calendar-cell-events">{list.slice(0, limit).map(e => <span className="calendar-cell-event" key={`${e.cal_id || ''}-${e.id}`}><i style={{
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
          }} onClick={() => setDetail(e)}><time>{eventTime(e)}</time><strong>{e.title || 'Untitled event'}</strong>{e.calendar && <span>{e.calendar}</span>}</button>)}</div><footer className="calendar-source"><span>{status.connected ? 'Google Calendar' : 'Saved events'} · Read only</span><button className="btn btn--ghost btn--icon" aria-label="Refresh events" disabled={loading} onClick={() => setRevision(r => r + 1)}><i className="ti ti-refresh" /></button>{!status.connected && status.ready && <button className="btn btn--sm" onClick={() => gcal.connect().catch(e => setError(e.message))}>Connect Google</button>}{status.connected && <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer">Open Google Calendar ↗</a>}</footer></aside></div>
    {detail && <Modal title={detail.title || 'Event'} onClose={() => setDetail(null)}><div className="calendar-detail"><p>{allDay(detail) ? detail.starts_at.slice(0, 10) : new Date(detail.starts_at).toLocaleDateString([], {
            dateStyle: 'full'
          })}</p><p>{eventTime(detail)}</p>{detail.calendar && <p>{detail.calendar}</p>}{detail.html_link && /^https:\/\//.test(detail.html_link) && <a className="btn" href={detail.html_link} target="_blank" rel="noopener noreferrer">Open in Google Calendar ↗</a>}</div></Modal>}
  </section>;
}
