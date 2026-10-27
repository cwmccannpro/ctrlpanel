import { useState } from 'react';
import Modal from './RoomDialog.jsx';
import { room } from '../../lib/room.js';

export default function RoomConnection({ paired, onClose, onRefresh }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (paired && !confirm('Replace this connection? The previous Mac key and queued actions will be revoked. Existing local routines continue.')) return;
    setBusy(true); setError('');
    try { setKey((await room.connect()).key); await onRefresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!confirm('Disconnect this Mac from CTRLpanel? Local routines and alarms continue on the Mac.')) return;
    setBusy(true);
    try { await room.disconnect(); await onRefresh(); onClose(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ server: window.location.origin, key }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ctrlpanel-room-connection.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Modal title="Connect your room" onClose={busy ? undefined : onClose}>
    <div className="room-form">
      <p>Your Mac runs the lights, schedules, and speaker alarm. Connect it once to control the room from any device signed into your CTRLpanel account.</p>
      <ol className="room-steps">
        <li><strong>Keep Room Control running.</strong><span>The existing Mac login service keeps your saved lights and routines.</span></li>
        <li><strong>Create a private connection.</strong><span>Download the connection file below. It contains a secret key shown only during setup.</span></li>
        <li><strong>Set up the Mac bridge.</strong><span>From the CTRLpanel project folder, run these commands. When prompted for a file, use the downloaded connection file.</span>
          <code>python3 room-bridge/bridge.py configure --from-file ~/Downloads/ctrlpanel-room-connection.json</code>
          <code>python3 room-bridge/bridge.py install</code>
        </li>
      </ol>
      <p className="room-caption">Delete the downloaded file after setup. Keep your Mac logged in, powered, awake, and within Bluetooth range. The screen can be locked.</p>
      {key ? <div className="room-key-result"><p>Connection created. Download the file now; its key cannot be retrieved later.</p><button className="btn btn--accent" onClick={download}>Download connection file</button></div>
        : <button className="btn btn--accent" disabled={busy} onClick={create}>{busy ? 'Connecting…' : paired ? 'Replace connection' : 'Create connection'}</button>}
      {paired && !key && <button className="btn btn--ghost" disabled={busy} onClick={disconnect}>Disconnect this Mac</button>}
      {error && <p role="alert" className="room-error">{error}</p>}
    </div>
  </Modal>;
}
