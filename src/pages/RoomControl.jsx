import RoomLightControls from '../components/RoomLightControls.jsx';
import RoomBridgeSetup from '../components/RoomBridgeSetup.jsx';
import { useRoomControl } from '../lib/useRoomControl.js';
import '../styles/room.css';

const statusLabels = { queued: 'Queued', sending: 'Sending', sent: 'Sent over Bluetooth', partial: 'Partially sent', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled' };
const presets = [
  { id: 'day', name: 'Day Mode', color: '#ffffff', setting: 'Bright white', time: '7:00 AM' },
  { id: 'work', name: 'Work Mode', color: '#a020ff', setting: 'Bright purple', time: '5:00 PM' },
  { id: 'party', name: 'Party Mode', color: '#ff0000', setting: 'Red', time: '9:00 PM' },
  { id: 'night', name: 'Night Mode', color: 'transparent', setting: 'All lights off', time: '12:00 AM' },
  { id: 'relax', name: 'Relax Mode', color: '#ffbf80', setting: 'Warm white' },
];
export default function RoomControl() {
  const room = useRoomControl();
  const devices = room.controller?.devices || [];
  const names = Object.fromEntries(devices.map(d => [d.id, d.name]));
  return <div className="room-page">
    <header className="room-page-head"><div><span className="room-eyebrow">Your space</span><h1>Room Control</h1><p>Set the room, or adjust one light.</p></div>
      <div className="room-connection"><span className={`room-dot ${room.online ? 'is-online' : ''}`} /><span>{room.loading ? 'Checking desktop…' : room.online ? 'Desktop connected' : 'Desktop unavailable'}</span><button className="btn btn--sm" onClick={room.refresh} aria-label="Refresh room connection"><i className="ti ti-refresh" aria-hidden="true" /></button></div>
    </header>
    {room.error && <div className="room-notice" role="alert"><p>{room.error}</p><button className="btn" onClick={room.refresh}>Retry</button></div>}
    {room.loading ? <p role="status">Loading your room…</p> : room.controller ? <>
      {!room.online && <div className="room-notice" role="status">Wake your Windows desktop and check that the room bridge is running. Controls become available when it connects.</div>}
      <section className="room-presets" aria-labelledby="room-presets-title">
        <div className="room-section-heading">
          <h2 id="room-presets-title">Presets</h2>
          {room.presetScheduleEnabled && <span>Daily schedule · Eastern time</span>}
        </div>
        <div className="room-preset-buttons">
          {presets.map(preset => <button key={preset.id} type="button" className="btn room-preset" disabled={!room.online || room.busy} onClick={() => room.applyPreset(preset.id)}>
            <span className="room-preset-swatch" style={{ backgroundColor: preset.color }} aria-hidden="true" />
            <span><strong>{preset.name}</strong><small>{preset.setting}{room.presetScheduleEnabled && preset.time ? ` · ${preset.time}` : ''}</small></span>
          </button>)}
        </div>
      </section>
      <RoomLightControls title="Whole room" subtitle={`${devices.length} lights · one change at a time`} target="all" cct={devices.some(d => d.cct)} room disabled={!room.online || room.busy} send={room.send} />
      <div className="room-section-heading"><h2>Lights</h2><span>Settings show the last successful send, not live device readings.</span></div>
      <div className="room-light-grid">{devices.map(d => <RoomLightControls key={d.id} title={d.name} subtitle={d.bluetooth_name} target={d.id} cct={d.cct} state={room.controller.last_sent?.[d.id]} disabled={!room.online || room.busy} send={room.send} />)}</div>
      <section className="room-activity" aria-labelledby="room-activity-title"><h2 id="room-activity-title">Recent changes</h2>
        {!room.commands?.length ? <p>No changes sent yet. Pick a setting above to get started.</p> : <ul aria-live="polite">{room.commands.map(c => <li key={c.id}>
          <div><strong>{c.targets.map(id => names[id] || id).join(', ')}</strong><span>{Object.entries(c.patch).map(([key, value]) => `${key === 'temperature' ? 'White' : key}: ${typeof value === 'boolean' ? value ? 'on' : 'off' : value}${key === 'brightness' ? '%' : key === 'temperature' ? ' K' : ''}`).join(' · ')}</span>
            {c.results?.filter(r => !r.ok).map(r => <span className="room-failure" key={r.id}>{names[r.id]}: {r.error || 'Bluetooth send failed. Check range and close the phone app.'}</span>)}</div>
          <div className="room-receipt"><span className={`badge room-status-${c.status}`}>{statusLabels[c.status]}</span><time dateTime={c.created_at}>{new Date(c.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
        </li>)}</ul>}
      </section>
      <RoomBridgeSetup paired={room.controller.paired} refresh={room.refresh} />
    </> : null}
  </div>;
}
