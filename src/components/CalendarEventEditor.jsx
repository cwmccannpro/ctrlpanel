import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { useAuth } from './AuthProvider.jsx';
import { icloud } from '../lib/api.js';
import { draftFromEvent, eventFromDraft, localDate } from '../lib/calendarEdit.js';
import '../styles/calendar-edit.css';

const shift = (date, from, to) => {
  // Keep a multi-day event's length when its start date moves.
  const [a, b, c] = [date, from, to].map((s) => new Date(`${s}T12:00:00`));
  return localDate(new Date(+a + (+c - +b)));
};

/**
 * Create, edit or delete an iCloud event (CalDAV). `event` is an existing,
 * editable iCloud event; without it, `draft` (from newDraft) seeds a new one.
 * The calendar picker remembers the last calendar used for new events in
 * ui_preferences.calendar.icloudCalendar.
 */
export default function CalendarEventEditor({ event = null, draft: seed = null, onClose, onSaved }) {
  const { settings, updateUiPreferences } = useAuth();
  const remembered = settings?.ui_preferences?.calendar?.icloudCalendar || '';
  const [draft, setDraft] = useState(() => (event ? draftFromEvent(event) : { ...seed, calId: seed?.calId || remembered }));
  const [calendars, setCalendars] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    let on = true;
    icloud.calendars()
      .then((list) => { if (on) setCalendars(list.filter((c) => c.writable)); })
      .catch((e) => { if (on) { setCalendars([]); setError(e.message || 'Couldn’t load your iCloud calendars.'); } });
    return () => { on = false; };
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, []);

  // Fall back to the first writable calendar when none is chosen or the saved one is gone.
  useEffect(() => {
    if (!calendars?.length) return;
    if (!calendars.some((c) => c.id === draft.calId)) setDraft((d) => ({ ...d, calId: calendars[0].id }));
  }, [calendars, draft.calId]);

  const set = (patch) => { setError(''); setConfirming(false); setDraft((d) => ({ ...d, ...patch })); };
  const calendar = useMemo(() => calendars?.find((c) => c.id === draft.calId), [calendars, draft.calId]);
  const overnight = !draft.allDay && draft.end && draft.start && draft.end <= draft.start && draft.endDate <= draft.date;

  const save = async (e) => {
    e?.preventDefault();
    const body = eventFromDraft(draft);
    if (body.error) return setError(body.error);
    if (!draft.calId) return setError('Pick a calendar.');
    setBusy('save');
    setError('');
    try {
      if (event) await icloud.update({ ...body, href: event.href, etag: event.etag, cal_id: draft.calId });
      else await icloud.create({ ...body, cal_id: draft.calId });
      if (!event && draft.calId !== remembered) updateUiPreferences('calendar', { icloudCalendar: draft.calId }).catch(() => {});
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'The event couldn’t be saved.');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!confirming) return setConfirming(true);
    setBusy('delete');
    setError('');
    try {
      await icloud.remove({ href: event.href, etag: event.etag });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'The event couldn’t be deleted.');
      setConfirming(false);
    } finally {
      setBusy('');
    }
  };

  const footer = (
    <div className="cal-edit-actions">
      {event && (
        <button type="button" className={`btn ${confirming ? 'btn--danger' : 'btn--ghost'}`} onClick={remove} disabled={Boolean(busy)}>
          <i className="ti ti-trash" /> {busy === 'delete' ? 'Deleting…' : confirming ? 'Delete from iCloud' : 'Delete'}
        </button>
      )}
      <span className="cal-edit-spacer" />
      <button type="button" className="btn btn--ghost" onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
      <button type="submit" form="cal-edit-form" className="btn btn--accent" disabled={Boolean(busy) || !calendars?.length}>
        {busy === 'save' ? 'Saving…' : event ? 'Save' : 'Add event'}
      </button>
    </div>
  );

  return (
    <Modal title={event ? 'Edit event' : 'New event'} onClose={busy ? undefined : onClose} footer={footer}>
      <form id="cal-edit-form" className="cal-edit" onSubmit={save} style={{ '--event-color': calendar?.color || 'var(--accent)' }}>
        <input
          ref={titleRef}
          className="input cal-edit-title"
          placeholder="Event title"
          value={draft.title}
          maxLength={300}
          onChange={(e) => set({ title: e.target.value })}
          aria-label="Title"
        />

        <div className="cal-edit-row">
          <label className="cal-edit-toggle">
            <button type="button" role="switch" aria-checked={draft.allDay} className={`switch ${draft.allDay ? 'on' : ''}`} onClick={() => set({ allDay: !draft.allDay, endDate: draft.date })} aria-label="All day" />
            All day
          </label>
        </div>

        <div className="cal-edit-grid">
          <label>
            <span className="field-label">{draft.allDay ? 'Starts' : 'Date'}</span>
            <input type="date" className="input" value={draft.date} required onChange={(e) => e.target.value && set({ date: e.target.value, endDate: shift(e.target.value, draft.date, draft.endDate || draft.date) })} />
          </label>
          {draft.allDay ? (
            <label>
              <span className="field-label">Ends</span>
              <input type="date" className="input" value={draft.endDate} min={draft.date} required onChange={(e) => set({ endDate: e.target.value })} />
            </label>
          ) : (
            <div className="cal-edit-times">
              <label>
                <span className="field-label">From</span>
                <input type="time" className="input" value={draft.start} step={300} required onChange={(e) => set({ start: e.target.value })} />
              </label>
              <label>
                <span className="field-label">To{overnight && <em> +1 day</em>}{!overnight && draft.endDate > draft.date && <em> {new Date(`${draft.endDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</em>}</span>
                <input type="time" className="input" value={draft.end} step={300} required onChange={(e) => set({ end: e.target.value })} />
              </label>
            </div>
          )}
        </div>

        <label>
          <span className="field-label">Calendar</span>
          <select className="select" value={draft.calId} onChange={(e) => set({ calId: e.target.value })} disabled={!calendars?.length}>
            {!calendars && <option value="">Loading calendars…</option>}
            {calendars?.length === 0 && <option value="">No writable iCloud calendars</option>}
            {calendars?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <label>
          <span className="field-label">Location</span>
          <input className="input" value={draft.location} maxLength={300} placeholder="Optional" onChange={(e) => set({ location: e.target.value })} />
        </label>
        <label>
          <span className="field-label">Notes</span>
          <textarea className="textarea" value={draft.notes} maxLength={4000} rows={3} placeholder="Optional" onChange={(e) => set({ notes: e.target.value })} />
        </label>

        {error && <p className="cal-edit-error" role="alert">{error}</p>}
        <p className="cal-edit-note"><i className="ti ti-brand-apple" /> Saves straight to iCloud. Changes show on your iPhone and Mac within a minute.</p>
      </form>
    </Modal>
  );
}
