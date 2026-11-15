import { useState } from 'react';
import { authApi } from '../lib/api.js';

export default function RoomBridgeSetup({ paired, refresh }) {
  const [credential, setCredential] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const change = async action => {
    setBusy(true); setError('');
    try { const result = await authApi.post(`/room/${action}`, {}); setCredential(result.credential || ''); setConfirm(''); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <details className="room-setup"><summary>Desktop connection</summary>
    <p>The Windows desktop must stay awake, online, and within Bluetooth range. The bridge starts when you sign in to Windows.</p>
    <p>To reconnect, create a key and paste it into the desktop installer’s secure prompt. The key can only receive commands for this room.</p>
    <code>powershell -File tools/room-install.ps1</code>
    <div className="room-setup-actions">
      <button className="btn" disabled={busy} onClick={() => paired ? setConfirm('pair') : change('pair')}>{paired ? 'Replace desktop key' : 'Create desktop key'}</button>
      {paired && <button className="btn" disabled={busy} onClick={() => setConfirm('revoke')}>Disconnect desktop</button>}
    </div>
    {confirm && <div className="room-notice"><p>{confirm === 'pair' ? 'Replace the current key? The desktop will stop until you install the new key.' : 'Disconnect this desktop? Room controls will stop until you reconnect it.'}</p>
      <button className="btn btn--accent" disabled={busy} onClick={() => change(confirm)}>Confirm</button> <button className="btn" onClick={() => setConfirm('')}>Cancel</button></div>}
    {credential && <div className="room-notice"><label htmlFor="room-key">Desktop key · shown once</label><input className="input" id="room-key" readOnly value={credential} onFocus={e => e.target.select()} />
      <button className="btn" onClick={() => setCredential('')}>Hide key</button></div>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
