import { useState, useEffect } from 'react';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import { calendar as calApi } from '../lib/api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS = ['#e11d48', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
const VIEWS = ['Month', 'Week', 'Day'];
let tmpId = 0;

const ymd = (d) => d.toISOString().slice(0, 10);
const sameDay = (a, b) => ymd(a) === ymd(b);

export default function Calendar() {
  const [view, setView] = useState('Month');
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    calApi
      .events()
      .then((r) => {
        setEvents(r.events || []);
        setConnected(r.connected);
      })
      .catch(() => setEvents([]));
  }, []);

  const eventsOn = (date) => events.filter((e) => e.start && sameDay(new Date(e.start), date));

  const move = (dir) => {
    const d = new Date(cursor);
    if (view === 'Month') d.setMonth(d.getMonth() + dir);
    else if (view === 'Week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  };

  const openNew = (date) => {
    const base = date || cursor;
    setEditing({ id: null, title: '', date: ymd(base), time: '09:00', color: COLORS[0], calendar: 'Personal' });
  };

  const saveEvent = () => {
    if (!editing.title.trim()) return;
    const start = new Date(`${editing.date}T${editing.time}`).toISOString();
    if (editing.id) {
      setEvents((prev) => prev.map((e) => (e.id === editing.id ? { ...e, title: editing.title, start, color: editing.color, calendar: editing.calendar } : e)));
    } else {
      const ev = { id: `new-${Date.now()}-${tmpId++}`, title: editing.title, start, color: editing.color, calendar: editing.calendar };
      setEvents((prev) => [...prev, ev]);
      calApi.create(ev).catch(() => {});
    }
    setEditing(null);
  };

  const deleteEvent = () => {
    if (editing?.id) setEvents((prev) => prev.filter((e) => e.id !== editing.id));
    setEditing(null);
  };

  const openEdit = (e) => {
    const d = new Date(e.start);
    setEditing({ id: e.id, title: e.title, date: ymd(d), time: d.toTimeString().slice(0, 5), color: e.color, calendar: e.calendar || 'Personal' });
  };

  const heading =
    view === 'Month'
      ? cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : view === 'Day'
      ? cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : `Week of ${cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Calendar</h1>
          <div className="page-header-sub">
            {connected ? 'Google Calendar connected' : 'Demo events — connect Google Calendar in Settings'}
          </div>
        </div>
        <div className="row">
          <div className="segmented">
            {VIEWS.map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          <button className="btn btn--accent" onClick={() => openNew()}><i className="ti ti-plus" /> Event</button>
        </div>
      </div>

      <div className="spread">
        <div className="row">
          <button className="btn btn--icon" onClick={() => move(-1)}><i className="ti ti-chevron-left" /></button>
          <button className="btn btn--icon" onClick={() => move(1)}><i className="ti ti-chevron-right" /></button>
          <button className="btn btn--sm" onClick={() => setCursor(new Date())}>Today</button>
        </div>
        <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 500 }}>{heading}</span>
      </div>

      {view === 'Month' && <MonthView cursor={cursor} eventsOn={eventsOn} onCell={openNew} onEvent={openEdit} />}
      {view === 'Week' && <WeekView cursor={cursor} eventsOn={eventsOn} onEvent={openEdit} />}
      {view === 'Day' && <DayView cursor={cursor} events={eventsOn(cursor)} onEvent={openEdit} />}

      {editing && (
        <Modal
          title={editing.id ? 'Edit Event' : 'New Event'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn btn--danger" style={{ marginRight: 'auto' }} onClick={deleteEvent}>Delete</button>}
              <button className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveEvent}>Save</button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Title</label>
            <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Date</label><input className="input" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></div>
            <div className="field"><label className="field-label">Time</label><input className="input" type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} /></div>
          </div>
          <div className="field">
            <label className="field-label">Color</label>
            <div className="row">
              {COLORS.map((c) => (
                <span key={c} onClick={() => setEditing({ ...editing, color: c })} style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: editing.color === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} />
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MonthView({ cursor, eventsOn, onCell, onEvent }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, i - startOffset + 1);
    cells.push(d);
  }
  const today = new Date();
  return (
    <Card static>
      <div className="cal-grid">
        {DOW.map((d) => (
          <div className="cal-dow" key={d}>{d}</div>
        ))}
        {cells.map((d, i) => (
          <div
            key={i}
            className={`cal-cell ${d.getMonth() !== month ? 'dim' : ''} ${sameDay(d, today) ? 'today' : ''}`}
            onClick={() => onCell(d)}
          >
            <span className="cal-date">{d.getDate()}</span>
            {eventsOn(d).slice(0, 3).map((e) => (
              <span key={e.id} className="cal-event" style={{ background: e.color }} onClick={(ev) => { ev.stopPropagation(); onEvent(e); }}>
                {e.title}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function WeekView({ cursor, eventsOn, onEvent }) {
  const start = new Date(cursor);
  start.setDate(cursor.getDate() - cursor.getDay());
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const today = new Date();
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>
      {days.map((d, i) => (
        <Card key={i} className="card-section" static style={{ minHeight: 160 }}>
          <div className={`section-label ${sameDay(d, today) ? 'text-accent' : ''}`}>
            {DOW[d.getDay()]} {d.getDate()}
          </div>
          {eventsOn(d).map((e) => (
            <div key={e.id} className="cal-event" style={{ background: e.color, marginTop: 6 }} onClick={() => onEvent(e)}>
              {new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} {e.title}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function DayView({ cursor, events, onEvent }) {
  const sorted = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
  return (
    <Card className="card-section" static>
      {sorted.length === 0 && <p className="body-text">No events this day.</p>}
      {sorted.map((e) => (
        <div className="list-row" key={e.id} onClick={() => onEvent(e)} style={{ cursor: 'pointer' }}>
          <span className="list-row-time">{new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          <span className="list-row-dot" style={{ background: e.color }} />
          <span className="list-row-title">{e.title}</span>
          <span className="list-row-meta">{e.calendar}</span>
        </div>
      ))}
    </Card>
  );
}
