import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import Spinner from '../components/shared/Spinner.jsx';
import { useCrud } from '../lib/useData.js';
import { gcal } from '../lib/api.js';
import { EVENT_COLORS } from '../lib/mockData.js';
import { clamp } from '../lib/helpers.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIEWS = ['Month', 'Week', 'Day'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const ymd = (d) => d.toISOString().slice(0, 10);
const sameDay = (a, b) => ymd(a) === ymd(b);
const timeStr = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hourLabel = (h) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
const hhmm = (d) => d.toTimeString().slice(0, 5);

export default function Calendar() {
  const local = useCrud('calendar_events', 'starts_at');
  const [params, setParams] = useSearchParams();

  const [gStatus, setGStatus] = useState({ connected: false, ready: true, email: null });
  const [gEvents, setGEvents] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState('');

  const [view, setView] = useState('Week');
  const [cursor, setCursor] = useState(new Date());
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const google = gStatus.connected;
  const events = google ? gEvents : local.rows;
  const writableCals = calendars.filter((c) => c.writable);
  const primaryCal = calendars.find((c) => c.primary) || writableCals[0];

  const reloadGoogle = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await gcal.list();
      setGEvents(r.events || []);
      setGStatus((s) => ({ ...s, connected: r.connected }));
    } catch { /* keep current */ } finally {
      setSyncing(false);
    }
  }, []);

  // Initial status + OAuth return banner
  useEffect(() => {
    const flag = params.get('google');
    if (flag === 'connected') setBanner('Google Calendar connected.');
    if (flag === 'error') setBanner(`Google connection failed: ${params.get('message') || 'unknown error'}`);
    if (flag) {
      params.delete('google');
      params.delete('message');
      setParams(params, { replace: true });
    }
    gcal
      .status()
      .then((s) => {
        setGStatus({ connected: s.connected, ready: s.ready, email: s.email });
        if (s.connected) {
          reloadGoogle();
          gcal.calendars().then((r) => setCalendars(r.calendars || [])).catch(() => {});
        }
      })
      .catch(() => setGStatus({ connected: false, ready: false, email: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = async () => {
    await gcal.disconnect().catch(() => {});
    setGEvents([]);
    setCalendars([]);
    setGStatus((s) => ({ ...s, connected: false, email: null }));
    setBanner('Google Calendar disconnected.');
  };

  const eventsOn = useCallback(
    (date) => events.filter((e) => e.starts_at && sameDay(new Date(e.starts_at), date)),
    [events]
  );

  const move = (dir) => {
    const d = new Date(cursor);
    if (view === 'Month') d.setMonth(d.getMonth() + dir);
    else if (view === 'Week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  };

  const openNew = (date, time = '09:00') => {
    const base = date || cursor;
    const [h, m] = time.split(':').map(Number);
    const endD = new Date(base);
    endD.setHours(h + 1, m, 0, 0);
    setEditing({
      id: null,
      title: '',
      date: ymd(base),
      time,
      end_time: hhmm(endD),
      color: EVENT_COLORS[0],
      cal_id: primaryCal?.id || 'primary',
    });
  };

  const openEdit = (e) => {
    const d = new Date(e.starts_at);
    const end = e.ends_at ? new Date(e.ends_at) : new Date(d.getTime() + 3600000);
    setEditing({
      id: e.id,
      cal_id: e.cal_id,
      title: e.title,
      date: ymd(d),
      time: hhmm(d),
      end_time: hhmm(end),
      color: e.color,
      calendar: e.calendar,
    });
  };

  const saveEvent = async () => {
    if (!editing.title.trim()) return;
    const starts = new Date(`${editing.date}T${editing.time}`);
    let ends = new Date(`${editing.date}T${editing.end_time || editing.time}`);
    if (!(ends > starts)) ends = new Date(starts.getTime() + 3600000);
    const payload = { title: editing.title, starts_at: starts.toISOString(), ends_at: ends.toISOString() };
    setBusy(true);
    try {
      if (google) {
        if (editing.id) await gcal.update(editing.id, { ...payload, cal_id: editing.cal_id });
        else await gcal.create({ ...payload, cal_id: editing.cal_id });
        await reloadGoogle();
      } else if (editing.id) {
        local.patch(editing.id, { ...payload, color: editing.color });
      } else {
        local.add({ ...payload, color: editing.color, calendar: 'Personal' });
      }
      setEditing(null);
    } catch (e) {
      setBanner(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = async () => {
    if (!editing?.id) return setEditing(null);
    setBusy(true);
    try {
      if (google) {
        await gcal.remove(editing.id, editing.cal_id);
        await reloadGoogle();
      } else {
        local.remove(editing.id);
      }
      setEditing(null);
    } catch (e) {
      setBanner(`Delete failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const weekDays = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const heading =
    view === 'Month'
      ? cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : view === 'Day'
      ? cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : `${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const calFor = (id) => calendars.find((c) => c.id === id);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Calendar</h1>
          <div className="page-header-sub row" style={{ gap: 8 }}>
            {google ? (
              <>
                <span className="status-dot running" /> Synced with Google{gStatus.email ? ` · ${gStatus.email}` : ''}
                {syncing && <Spinner />}
              </>
            ) : (
              <>Local calendar{gStatus.ready ? '' : ' · Google not configured on server'}</>
            )}
          </div>
        </div>
        <div className="row">
          {google ? (
            <button className="btn" onClick={disconnect}><i className="ti ti-plug-off" /> Disconnect Google</button>
          ) : (
            <button className="btn" onClick={() => gcal.connect()} disabled={!gStatus.ready}>
              <i className="ti ti-brand-google" /> Connect Google Calendar
            </button>
          )}
          <div className="segmented">
            {VIEWS.map((v) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v}</button>)}
          </div>
          <button className="btn btn--accent" onClick={() => openNew()}><i className="ti ti-plus" /> Event</button>
        </div>
      </div>

      {banner && (
        <div className="auth-notice" style={{ marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{banner}</span>
          <button className="btn btn--ghost btn--icon" onClick={() => setBanner('')}><i className="ti ti-x" /></button>
        </div>
      )}

      <div className="spread">
        <div className="row">
          <button className="btn btn--icon" onClick={() => move(-1)}><i className="ti ti-chevron-left" /></button>
          <button className="btn btn--icon" onClick={() => move(1)}><i className="ti ti-chevron-right" /></button>
          <button className="btn btn--sm" onClick={() => setCursor(new Date())}>Today</button>
        </div>
        <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 500 }}>{heading}</span>
      </div>

      {google && calendars.length > 0 && (
        <div className="cal-legend">
          {calendars.map((c) => (
            <span className="cal-legend-chip" key={c.id} title={c.writable ? 'Editable' : 'Read-only'}>
              <span className="list-row-dot" style={{ background: c.color }} />
              {c.name}
            </span>
          ))}
        </div>
      )}

      <div>
        {view === 'Month' && (
          <MonthView cursor={cursor} eventsOn={eventsOn} onCell={(d) => openNew(d)} onEvent={openEdit} onDay={(d) => { setCursor(d); setView('Day'); }} />
        )}
        {view === 'Week' && (
          <TimeGrid days={weekDays} eventsOn={eventsOn} onEvent={openEdit} onSlot={openNew} onDayHead={(d) => { setCursor(d); setView('Day'); }} />
        )}
        {view === 'Day' && (
          <TimeGrid days={[cursor]} eventsOn={eventsOn} onEvent={openEdit} onSlot={openNew} />
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Edit Event' : 'New Event'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn btn--danger" style={{ marginRight: 'auto' }} onClick={deleteEvent} disabled={busy}>Delete</button>}
              <button className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveEvent} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button>
            </>
          }
        >
          <div className="field"><label className="field-label">Title</label><input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} autoFocus /></div>
          <div className="grid grid-3">
            <div className="field"><label className="field-label">Date</label><input className="input" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></div>
            <div className="field"><label className="field-label">Start</label><input className="input" type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} /></div>
            <div className="field"><label className="field-label">End</label><input className="input" type="time" value={editing.end_time} onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} /></div>
          </div>

          {google ? (
            <div className="field">
              <label className="field-label">Calendar</label>
              {editing.id ? (
                <div className="row" style={{ padding: '8px 2px' }}>
                  <span className="list-row-dot" style={{ background: calFor(editing.cal_id)?.color || editing.color }} />
                  <span className="body-text">{calFor(editing.cal_id)?.name || editing.calendar || 'Google'}</span>
                </div>
              ) : (
                <select className="select" value={editing.cal_id || ''} onChange={(e) => setEditing({ ...editing, cal_id: e.target.value })}>
                  {writableCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          ) : (
            <div className="field">
              <label className="field-label">Color</label>
              <div className="row">
                {EVENT_COLORS.map((c) => (
                  <span key={c} onClick={() => setEditing({ ...editing, color: c })} style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: editing.color === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} />
                ))}
              </div>
            </div>
          )}
          {google && <p className="list-row-meta">Syncs to your Google Calendar. Event color follows its calendar.</p>}
        </Modal>
      )}
    </div>
  );
}

/* ================= iCal-style time grid (Week / Day) ================= */

// Lay out one day's timed events into lanes so overlaps sit side by side.
function layoutDay(evts) {
  const items = evts
    .map((e) => {
      const start = +new Date(e.starts_at);
      let end = e.ends_at ? +new Date(e.ends_at) : start + 3600000;
      if (end - start < 20 * 60000) end = start + 20 * 60000; // min visual height
      return { ev: e, start, end };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const laneEnds = [];
    for (const it of cluster) {
      let lane = 0;
      while (laneEnds[lane] > it.start) lane++;
      laneEnds[lane] = it.end;
      it.lane = lane;
    }
    const lanes = laneEnds.length || 1;
    cluster.forEach((it) => placed.push({ ...it, lanes }));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return placed;
}

// Hours shown without scrolling: 5 AM → midnight. (12–5 AM is above the fold.)
const VISIBLE_START = 5;
const VISIBLE_HOURS = 24 - VISIBLE_START;

function TimeGrid({ days, eventsOn, onEvent, onSlot, onDayHead }) {
  const bodyRef = useRef(null);
  const [hourHeight, setHourHeight] = useState(36);
  const [nowTick, setNowTick] = useState(Date.now());

  // Size rows so 5 AM–midnight exactly fills the grid; keep in sync on resize.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const fit = () => {
      const h = Math.max(el.clientHeight / VISIBLE_HOURS, 22);
      setHourHeight(h);
      el.scrollTop = VISIBLE_START * h; // land with 5 AM at the top
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Current-time line
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const now = new Date(nowTick);
  const nowTop = (now.getHours() + now.getMinutes() / 60) * hourHeight;

  const totalH = 24 * hourHeight;
  const today = new Date();

  const slotClick = (day) => (e) => {
    if (e.target.closest('.tg-event')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mins = clamp(Math.round(((e.clientY - rect.top) / hourHeight) * 60 / 30) * 30, 0, 23.5 * 60);
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    onSlot?.(day, `${h}:${m}`);
  };

  return (
    <Card static className="tg-card">
      {/* Day headers */}
      <div className="tg-head">
        <div className="tg-gutter-head" />
        {days.map((d, i) => (
          <div
            key={i}
            className={`tg-day-head ${sameDay(d, today) ? 'today' : ''}`}
            onClick={() => onDayHead?.(d)}
            style={{ cursor: onDayHead ? 'pointer' : 'default' }}
          >
            <span className="tg-dow">{DOW[d.getDay()]}</span>
            <span className="tg-date">{d.getDate()}</span>
          </div>
        ))}
      </div>

      {/* All-day row */}
      <AllDayRow days={days} eventsOn={eventsOn} onEvent={onEvent} />

      {/* Scrollable hour grid */}
      <div className="tg-body" ref={bodyRef}>
        <div className="tg-gutter" style={{ height: totalH }}>
          {HOURS.map((h) => (
            <div key={h} className="tg-hour-label" style={{ top: h * hourHeight }}>
              {h > 0 && hourLabel(h)}
            </div>
          ))}
        </div>
        {days.map((d, di) => {
          const timed = eventsOn(d).filter((e) => !e.all_day);
          return (
            <div key={di} className="tg-col" style={{ height: totalH }} onClick={slotClick(d)}>
              {HOURS.map((h) => (
                <div key={h} className="tg-line" style={{ top: h * hourHeight }} />
              ))}
              {layoutDay(timed).map(({ ev, start, end, lane, lanes }) => {
                const s = new Date(start);
                const top = (s.getHours() + s.getMinutes() / 60) * hourHeight;
                const height = Math.max(((end - start) / 3600000) * hourHeight, 18);
                const width = 100 / lanes;
                return (
                  <div
                    key={`${ev.cal_id || 'local'}-${ev.id}`}
                    className="tg-event"
                    style={{ top, height, left: `${lane * width}%`, width: `calc(${width}% - 3px)`, background: ev.color }}
                    onClick={(e) => { e.stopPropagation(); onEvent(ev); }}
                    title={`${ev.title} · ${timeStr(ev.starts_at)}${ev.calendar ? ` · ${ev.calendar}` : ''}`}
                  >
                    <span className="tg-event-time">{timeStr(ev.starts_at)}</span>
                    <span className="tg-event-title">{ev.title}</span>
                  </div>
                );
              })}
              {sameDay(d, today) && (
                <div className="tg-now" style={{ top: nowTop }}>
                  <span className="tg-now-dot" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AllDayRow({ days, eventsOn, onEvent }) {
  const perDay = days.map((d) => eventsOn(d).filter((e) => e.all_day));
  if (!perDay.some((l) => l.length)) return null;
  return (
    <div className="tg-allday">
      <div className="tg-gutter-head tg-allday-label">all-day</div>
      {perDay.map((list, i) => (
        <div key={i} className="tg-allday-col">
          {list.map((e) => (
            <div key={`${e.cal_id || 'local'}-${e.id}`} className="tg-allday-chip" style={{ background: e.color }} onClick={() => onEvent(e)}>
              {e.title}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ================= Month view ================= */

function MonthView({ cursor, eventsOn, onCell, onEvent, onDay }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: 42 }).map((_, i) => new Date(year, month, i - startOffset + 1));
  const today = new Date();
  return (
    <Card static>
      <div className="cal-grid">
        {DOW.map((d) => <div className="cal-dow" key={d}>{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className={`cal-cell ${d.getMonth() !== month ? 'dim' : ''} ${sameDay(d, today) ? 'today' : ''}`} onClick={() => onCell(d)}>
            <span className="cal-date" onClick={(e) => { e.stopPropagation(); onDay?.(d); }} style={{ cursor: 'pointer' }}>{d.getDate()}</span>
            {eventsOn(d).slice(0, 3).map((e) => (
              <span key={`${e.cal_id || 'local'}-${e.id}`} className="cal-event" style={{ background: e.color }} onClick={(ev) => { ev.stopPropagation(); onEvent(e); }}>{e.title}</span>
            ))}
            {eventsOn(d).length > 3 && <span className="list-row-meta">+{eventsOn(d).length - 3} more</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
