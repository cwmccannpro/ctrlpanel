import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './RoomDialog.jsx';
import { DEFAULT_LIGHT, room, routineLabel } from '../../lib/room.js';
import LightControls from './LightControls.jsx';
import RoomDevices from './RoomDevices.jsx';
import RoutineEditor from './RoutineEditor.jsx';
import RoomConnection from './RoomConnection.jsx';
import './room.css';

export default function Room() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [connect, setConnect] = useState(false);
  const [editor, setEditor] = useState(null);
  const [saveScene, setSaveScene] = useState(false);
  const [sceneName, setSceneName] = useState('');
  const [draft, setDraft] = useState(DEFAULT_LIGHT);
  const lock = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try { const next = await room.status(); if (alive.current) setStatus(next); }
    catch (e) { if (alive.current) { setError(e.message); setStatus((s) => s ? { ...s, online: false } : s); } }
  }, []);
  useEffect(() => {
    alive.current = true; refresh();
    const timer = setInterval(refresh, 3000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [refresh]);
  async function action(method, path, body, message) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await room.command(method, path, body);
      await refresh();
      if (alive.current) setNotice(message || 'Room updated');
      return result || true;
    } catch (e) { if (alive.current) setError(e.message); await refresh(); return false; }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const data = status?.snapshot || {};
  const online = !!status?.online;
  const disabled = !online || busy;
  const presets = data.presets || [];
  const schedules = data.schedules || [];
  const alarm = data.alarm || {};
  const activeAlarm = !!alarm.active;
  async function stopAlarm() {
    setStopping(true); setError('');
    try { await room.command('POST', '/alarm/stop'); setNotice('Alarm stopped'); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setStopping(false); }
  }
  const enabled = schedules.filter((s) => s.enabled);
  const time = (value) => {
    if (!value) return '—';
    const [h, m] = value.split(':');
    return `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? 'PM' : 'AM'}`;
  };
  return <div className="room-page">
    <header className="room-page-header"><div><h1>Room</h1><p>Your space, in sync with your day.</p></div><div className="room-actions">
      <span className={`room-status ${online ? 'is-online' : ''}`}><span />{online ? 'Mac connected' : status?.paired ? 'Mac offline' : 'Not connected'}</span>
      <button className="btn btn--ghost" onClick={() => setConnect(true)}><i aria-hidden="true" className="ti ti-plug-connected" />Connection</button>
    </div></header>
    <div className="room-feedback" aria-live="polite">{busy ? <p className="room-pending"><i aria-hidden="true" className="ti ti-loader" />Sending to your room…</p> : notice && <p className="room-notice"><i aria-hidden="true" className="ti ti-check" />{notice}</p>}</div>
    {error && <div className="room-alert" role="alert"><i aria-hidden="true" className="ti ti-alert-circle" /><p>{error}</p><button className="btn btn--ghost btn--sm" onClick={() => { setError(''); refresh(); }}>Retry connection</button></div>}
    {!online && <div className="room-offline"><i aria-hidden="true" className="ti ti-plug" /><div><strong>{status ? status.paired ? 'Your Mac is not connected' : 'Bring your room into CTRLpanel' : 'Connecting to your room…'}</strong><p>{data.controller_error || (status?.paired ? 'Start Room Control and its bridge on your Mac. Saved routines continue locally while CTRLpanel is disconnected.' : 'Connect your existing Room Control to bring in your lights, scenes, routines, and alarm.')}</p>{status?.last_seen_at && <small>Last connected {new Date(status.last_seen_at).toLocaleString()}</small>}</div><button className="btn" onClick={() => setConnect(true)}>{status?.paired ? 'Connection settings' : 'Connect Mac'}</button></div>}
    <div className="room-primary-grid">
      <section className="card card--static room-console">
        <div className="room-section-heading"><div><span className="section-label">Lighting</span><h2>Set the atmosphere</h2></div><span className="room-caption">{data.devices?.length || 0} active lights</span></div>
        <div className="room-console-body">
          <div className="room-atmosphere" style={{ '--light-color': draft.mode === 'color' ? draft.color : draft.kelvin < 4200 ? '#ffd5a3' : '#e0edff', '--light-level': draft.brightness / 100 }}>
            <div className="room-orbit"><div className="room-orb"><i aria-hidden="true" className="ti ti-bulb" /></div></div>
            <span>{draft.mode === 'color' ? 'Color' : draft.kelvin < 4200 ? 'Warm white' : 'Cool white'}</span><small>Selected setting</small>
          </div>
          <LightControls disabled={disabled} onDraft={setDraft} onSend={(value) => action('POST', '/room/command', value, 'Whole-room lighting updated')} />
        </div>
        <div className="room-console-footer"><p><i aria-hidden="true" className="ti ti-adjustments-horizontal" />Applies to every active light</p><button className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => { setSceneName(''); setSaveScene(true); }}><i aria-hidden="true" className="ti ti-plus" />Save as scene</button></div>
      </section>
      <section className={`card card--static room-alarm ${activeAlarm ? 'is-ringing' : ''}`}>
        <div className="room-section-heading"><div><span className="section-label">Wake & rest</span><h2>Room alarm</h2></div><i aria-hidden="true" className={`ti ${activeAlarm ? 'ti-bell-ringing' : 'ti-alarm'}`} /></div>
        <div className="room-alarm-display"><span className="room-label">{activeAlarm ? 'Ringing now' : 'Wake-up routine'}</span><strong>{activeAlarm ? 'Time to wake' : time(enabled.find((s) => s.alarm)?.time)}</strong><span>{activeAlarm ? alarm.label || 'Mac speaker alarm' : enabled.find((s) => s.alarm)?.name || 'No audible routine enabled'}</span></div>
        {activeAlarm && <button className="btn btn--accent room-stop" disabled={!online || stopping} onClick={stopAlarm}><i aria-hidden="true" className="ti ti-player-stop" />{stopping ? 'Stopping…' : 'Stop alarm'}</button>}
        <div className="room-alarm-details"><div><i aria-hidden="true" className="ti ti-volume" /><span>Built-in Mac speakers</span><strong>100%</strong></div><div><i aria-hidden="true" className="ti ti-world" /><span>Room time zone</span><strong>New York</strong></div></div>
        <button className="btn room-sound-test" disabled={disabled} onClick={() => { if (confirm('Play the alarm at full volume on your Mac speakers for 3 seconds?')) action('POST', '/alarm/preview', {}, 'Three-second sound test started'); }}><i aria-hidden="true" className="ti ti-player-play" />Test sound · 3 seconds</button>
        <p className="room-caption">Runs on your Mac, even with this page closed.</p>
      </section>
    </div>
    <section className="room-scenes-section"><div className="room-section-heading"><div><h2>Scenes</h2><p>A different mood, one touch away.</p></div><button className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => { setSceneName(''); setSaveScene(true); }}><i aria-hidden="true" className="ti ti-plus" />New scene</button></div>
      <div className="room-scenes">{presets.map((preset) => <div className="room-scene" key={preset.id}>
        <button className="room-scene-apply" disabled={disabled} onClick={() => action('POST', `/presets/${preset.id}/apply`, {}, `${preset.name} applied`)}>
          <span className="room-scene-icon" style={{ '--scene-color': !preset.power ? 'var(--text-secondary)' : preset.mode === 'color' ? preset.color : 'var(--accent)' }}><i aria-hidden="true" className={`ti ${!preset.power ? 'ti-moon' : preset.mode === 'color' ? 'ti-palette' : 'ti-sunrise'}`} /></span>
          <span><strong>{preset.name}</strong><small>{preset.power ? `${preset.brightness}% · ${preset.mode === 'white' ? `${preset.kelvin} K` : preset.color.toUpperCase()}` : 'All lights off'}</small></span><i aria-hidden="true" className="ti ti-player-play" />
        </button><button className="btn btn--ghost btn--icon room-scene-delete" disabled={disabled} aria-label={`Delete ${preset.name}`} onClick={() => { if (confirm(`Delete scene “${preset.name}”? Routines using it must be removed or changed first.`)) action('DELETE', `/presets/${preset.id}`, {}, 'Scene deleted'); }}><i aria-hidden="true" className="ti ti-x" /></button>
      </div>)}</div>
      {!presets.length && <p className="room-empty-inline">Your saved Room Control scenes appear here after connecting. You can also save a lighting setting as a new scene.</p>}
    </section>
    <RoomDevices snapshot={data} action={action} disabled={disabled} />
    <section className="card card--static room-routines"><div className="room-section-heading"><div><h2>Daily rhythm</h2><p>Lighting and alarms that follow your schedule.</p></div><button className="btn" disabled={disabled || !presets.length} onClick={() => setEditor({})}><i aria-hidden="true" className="ti ti-plus" />Add routine</button></div>
      <div className="room-routine-list">{[...schedules].sort((a,b) => a.time.localeCompare(b.time)).map((s) => <div className={`room-routine ${s.enabled ? '' : 'is-disabled'}`} key={s.id}>
        <span className="room-routine-time">{time(s.time)}</span><div className="room-routine-name"><strong>{s.name}{s.alarm && <i aria-hidden="true" className="ti ti-bell" title="Audible alarm" />}</strong><span>{routineLabel(s)} · {presets.find((p) => p.id === s.preset_id)?.name || 'Scene unavailable'}</span></div>
        <button role="switch" aria-checked={s.enabled} aria-label={`Enable ${s.name}`} className={`room-switch ${s.enabled ? 'is-on' : ''}`} disabled={disabled} onClick={() => action('PUT', `/schedules/${s.id}`, { ...s, enabled: !s.enabled }, `${s.name} ${s.enabled ? 'disabled' : 'enabled'}`)}><span /></button>
        <button className="btn btn--ghost btn--icon" disabled={disabled} aria-label={`Edit ${s.name}`} onClick={() => setEditor(s)}><i aria-hidden="true" className="ti ti-pencil" /></button>
        <button className="btn btn--ghost btn--icon" disabled={disabled} aria-label={`Delete ${s.name}`} onClick={() => { if (confirm(`Delete routine “${s.name}”?`)) action('DELETE', `/schedules/${s.id}`, {}, 'Routine deleted'); }}><i aria-hidden="true" className="ti ti-trash" /></button>
      </div>)}</div>
      {!schedules.length && <p className="room-empty-inline">No routines yet. Add a scene, then choose when it runs.</p>}
      <p className="room-routine-note"><i aria-hidden="true" className="ti ti-clock" />America/New_York · Keep the Mac awake and within Bluetooth range.</p>
    </section>
    <section className="room-activity"><div className="room-section-heading"><div><h2>Activity</h2><p>Command results from your room controller.</p></div><span className="room-caption">Last successful commands, not continuous device polling</span></div>
      {(data.history || []).slice(0, 12).map((entry, index) => <details className="room-activity-row" key={`${entry.time}-${index}`}><summary><i aria-hidden="true" className={`ti ${entry.results?.some((r) => !r.ok) ? 'ti-alert-circle room-error' : 'ti-point'}`} /><span>{entry.message}</span><time dateTime={entry.time}>{new Date(entry.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></summary><div>{entry.results?.length ? entry.results.map((result, i) => <p key={i}>{result.name || result.id || 'Light'}: {result.ok ? 'Sent successfully' : result.error || 'Failed'}</p>) : <p>{new Date(entry.time).toLocaleString()}</p>}</div></details>)}
      {!data.history?.length && <p className="room-empty-inline">Light commands, routine runs, and alarm events will appear here.</p>}
    </section>
    <footer className="room-page-footer"><i aria-hidden="true" className="ti ti-shield-lock" />Private to your CTRLpanel account. Your Mac handles the room.</footer>
    {connect && <RoomConnection paired={status?.paired} onClose={() => setConnect(false)} onRefresh={refresh} />}
    {editor && <RoutineEditor routine={editor.id ? editor : null} presets={presets} busy={busy} onClose={() => setEditor(null)} onSave={(value) => action(editor.id ? 'PUT' : 'POST', editor.id ? `/schedules/${editor.id}` : '/schedules', value, 'Routine saved')} />}
    {saveScene && <Modal title="Save a scene" onClose={busy ? undefined : () => setSaveScene(false)}><form className="room-form" onSubmit={async (e) => { e.preventDefault(); if (await action('POST', '/presets', { ...draft, name: sceneName.trim() }, 'Scene saved')) setSaveScene(false); }}>
      <label>Scene name<input autoFocus className="input" required maxLength={60} value={sceneName} onChange={(e) => setSceneName(e.target.value)} placeholder="Evening glow" /></label>
      <p className="room-caption">Saves the whole-room selection: {draft.power ? `${draft.brightness}% brightness, ${draft.mode === 'color' ? draft.color : `${draft.kelvin} K white`}` : 'all lights off'}.</p>
      <button type="submit" disabled={busy || !sceneName.trim()} className="btn btn--accent">Save scene</button>
    </form></Modal>}
  </div>;
}
