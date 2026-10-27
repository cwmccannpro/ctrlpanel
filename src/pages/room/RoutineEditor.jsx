import { useState } from 'react';
import Modal from './RoomDialog.jsx';
import { DAYS } from '../../lib/room.js';

export default function RoutineEditor({ routine, presets, onSave, onClose, busy }) {
  const [form, setForm] = useState(() => ({ name: '', time: '07:00', days: [0,1,2,3,4,5,6],
    preset_id: presets[0]?.id || '', enabled: true, alarm: false, alarm_seconds: 900, date: '', ...routine }));
  const [error, setError] = useState('');
  const patch = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e) {
    e.preventDefault();
    if (!form.days.length) return setError('Select at least one day.');
    setError('');
    const { name, time, days, preset_id, enabled, alarm, alarm_seconds, date } = form;
    if (await onSave({ name: name.trim(), time, days, preset_id, enabled, alarm, alarm_seconds, date: date || null })) onClose();
  }
  return <Modal title={routine ? 'Edit routine' : 'New routine'} onClose={busy ? undefined : onClose}>
    <form className="room-form" onSubmit={submit}>
      <label>Name<input className="input" value={form.name} required maxLength={60} onChange={(e) => patch('name', e.target.value)} placeholder="Morning wake" /></label>
      <div className="room-form-pair">
        <label>Time<input className="input" type="time" required value={form.time} onChange={(e) => patch('time', e.target.value)} /></label>
        <label>Scene<select className="select" required value={form.preset_id} onChange={(e) => patch('preset_id', e.target.value)}>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <fieldset className="room-days"><legend>Repeat on</legend>{DAYS.map((day, i) => <button type="button" key={day} aria-pressed={form.days.includes(i)} className={form.days.includes(i) ? 'selected' : ''}
        onClick={() => patch('days', form.days.includes(i) ? form.days.filter((d) => d !== i) : [...form.days, i].sort())}>{day}</button>)}</fieldset>
      <label>One-time date <span className="room-caption">Optional; leave blank to repeat</span><input className="input" type="date" value={form.date || ''} onChange={(e) => patch('date', e.target.value)} /></label>
      <label className="room-check"><input type="checkbox" checked={form.enabled} onChange={(e) => patch('enabled', e.target.checked)} />Routine enabled</label>
      <label className="room-check"><input type="checkbox" checked={form.alarm} onChange={(e) => patch('alarm', e.target.checked)} />Ring the Mac speaker alarm</label>
      {form.alarm && <><label>Alarm duration (seconds)<input className="input" type="number" min="1" max="900" required value={form.alarm_seconds} onChange={(e) => patch('alarm_seconds', Number(e.target.value))} /></label><p className="room-caption">Rings at full volume on the Mac’s built-in speakers. Previous audio settings are restored when it stops.</p></>}
      <p className="room-caption">Times use America/New_York, including daylight-saving changes. For a one-time date, select its weekday above.</p>
      {error && <p role="alert" className="room-error">{error}</p>}
      <button className="btn btn--accent" type="submit" disabled={busy || !presets.length}>{busy ? 'Saving…' : 'Save routine'}</button>
    </form>
  </Modal>;
}
