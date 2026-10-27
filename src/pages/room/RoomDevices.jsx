import { useState } from 'react';
import LightControls from './LightControls.jsx';
import Modal from './RoomDialog.jsx';

export default function RoomDevices({ snapshot, action, disabled }) {
  const [editing, setEditing] = useState(null);
  const [binding, setBinding] = useState({ name: '', address: '', driver: '' });
  const [inspection, setInspection] = useState(null);
  const devices = snapshot.devices || [];
  function edit(device) {
    setBinding({ name: device.name, address: device.address || '', driver: device.driver || '' });
    setInspection(null); setEditing(device);
  }
  async function save(e) {
    e.preventDefault();
    if (await action('PUT', `/devices/${editing.id}`, { ...binding, address: binding.address || null, driver: binding.driver || null }, 'Light assignment saved')) setEditing(null);
  }
  return <>
    <div className="room-section-heading"><div><h2>Your lights</h2><p>Fine-tune each light in the room.</p></div><button className="btn" disabled={disabled} onClick={() => action('POST', '/scan', {}, 'Discovery finished')}><i aria-hidden="true" className="ti ti-bluetooth" />Find lights</button></div>
    <div className="room-device-grid">{devices.map((device) => <article className="card card--static room-device" key={device.id}>
      <div className="room-device-title"><span className={`room-device-icon ${device.last_command?.power ? 'is-on' : ''}`}><i aria-hidden="true" className={`ti ${device.driver === 'lotus' ? 'ti-lamp' : 'ti-bulb'}`} /></span><div><h3>{device.name}</h3><span className="room-caption">{!device.address ? 'Not assigned' : device.last_command ? device.last_command.power ? 'Last set on' : 'Last set off' : 'Ready for a command'}</span></div><button className="btn btn--ghost btn--icon" disabled={disabled} onClick={() => edit(device)} aria-label={`Configure ${device.name}`}><i aria-hidden="true" className="ti ti-dots" /></button></div>
      <LightControls compact initial={device.last_command} disabled={disabled || !device.address} white={device.driver !== 'lotus'} onSend={(command) => action('POST', `/devices/${device.id}/command`, command, `${device.name} updated`)} />
      {device.last_error && <p className="room-error">{device.last_error}</p>}
      <p className="room-device-foot"><i aria-hidden="true" className={`ti ${device.driver === 'lotus' ? 'ti-send' : 'ti-checks'}`} />{!device.address ? 'Assign a light to start controlling it' : device.driver === 'lotus' ? 'Sent without physical state confirmation' : 'Bulb state checked after each command'}</p>
    </article>)}</div>
    {!devices.length && <div className="room-empty"><i aria-hidden="true" className="ti ti-bulb" /><h3>No active lights</h3><p>Connect your existing Room Control service to load its assigned lights.</p></div>}
    {snapshot.scan_error && <p className="room-error" role="alert">{snapshot.scan_error}</p>}
    {!!snapshot.nearby?.length && <details className="room-discovery"><summary>{snapshot.nearby.length} nearby devices · manage assignments</summary><div>{snapshot.nearby.map((item) => <div className="room-nearby" key={item.address}><span><strong>{item.name}</strong><small>{item.driver || 'Unknown protocol'}{item.rssi != null ? ` · ${item.rssi} dBm` : ''}</small></span><button className="btn btn--sm" disabled={disabled || !devices.length} onClick={() => { edit(devices[0]); setBinding({ name: devices[0].name, address: item.address, driver: item.driver || '' }); }}>Assign</button></div>)}</div></details>}
    {editing && <Modal title="Light settings" onClose={disabled ? undefined : () => setEditing(null)}><form className="room-form" onSubmit={save}>
      <label>Room light<select className="select" value={editing.id} onChange={(e) => { const d = devices.find((v) => v.id === e.target.value); setEditing(d); setBinding((b) => ({ ...b, name: d.name })); }}>{devices.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
      <label>Name<input className="input" required maxLength={60} value={binding.name} onChange={(e) => setBinding({ ...binding, name: e.target.value })} /></label>
      <label>Device address<input className="input" value={binding.address} onChange={(e) => setBinding({ ...binding, address: e.target.value })} placeholder="Scanned Bluetooth address or local bulb IP" /></label>
      <label>Driver<select className="select" value={binding.driver} onChange={(e) => setBinding({ ...binding, driver: e.target.value })}><option value="">Select a driver</option><option value="lednetwf">LEDnetWF bulb</option><option value="lotus">Lotus light bar</option><option value="briturn_lan">Briturn / Zengge Wi-Fi</option></select></label>
      <p className="room-caption">Bluetooth assignments must match a supported device from Find lights. Wi-Fi addresses are verified locally before assignment. Clear the address to unassign.</p>
      <div className="room-actions"><button className="btn btn--accent" type="submit" disabled={disabled}>Save light</button><button className="btn" type="button" disabled={disabled || !binding.address || binding.driver === 'briturn_lan'} onClick={async () => {
        const result = await action('POST', `/inspect/${binding.address}`, {}, 'Device inspected'); if (result) setInspection(result);
      }}>Inspect device</button></div>
      {inspection && <pre className="room-inspection">{JSON.stringify(inspection, null, 2)}</pre>}
      <button className="btn btn--danger" type="button" disabled={disabled} onClick={async () => {
        if (confirm(`Remove ${editing.name} from all room controls and routines?`)) {
          if (await action('DELETE', `/devices/${editing.id}`, {}, 'Light removed')) setEditing(null);
        }
      }}>Remove from room</button>
    </form></Modal>}
  </>;
}
