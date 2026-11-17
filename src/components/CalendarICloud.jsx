import { useEffect, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { icloud } from '../lib/api.js';
import '../styles/calendar-edit.css';

/**
 * Connect / disconnect the iCloud calendar (CalDAV). Apple requires an
 * app-specific password for this; the server checks it against iCloud before
 * saving it (encrypted), so a typo fails here instead of later.
 */
export default function CalendarICloud({ status, onChanged, onClose }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [calendars, setCalendars] = useState(null);
  const connected = Boolean(status?.connected);

  useEffect(() => {
    if (!connected) return undefined;
    let on = true;
    icloud.calendars({ fresh: true })
      .then((list) => { if (on) setCalendars(list); })
      .catch((e) => { if (on) { setCalendars([]); setError(e.message || 'Couldn’t load your iCloud calendars.'); } });
    return () => { on = false; };
  }, [connected]);

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await icloud.connect(username.trim(), password);
      setPassword('');
      setCalendars(res.calendars || []);
      onChanged?.({ connected: true, configured: true, username: res.username });
    } catch (err) {
      setError(err.message || 'Couldn’t connect to iCloud.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await icloud.disconnect();
      setCalendars(null);
      onChanged?.({ connected: false, configured: true, username: null });
    } catch (err) {
      setError(err.message || 'Couldn’t disconnect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="iCloud Calendar" onClose={busy ? undefined : onClose}>
      <div className="cal-icloud">
        {status?.configured === false ? (
          <p className="cal-icloud-bad" role="alert">
            iCloud sync isn’t set up on the server yet. Apply <code>migrations/20261116-icloud-caldav.sql</code> in Supabase and make sure the
            backend has <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </p>
        ) : connected ? (
          <>
            <div className="cal-icloud-account">
              <i className="ti ti-brand-apple" />
              <div>
                <strong>{status.username}</strong>
                <small>Read and write · events you add or edit here save to iCloud</small>
              </div>
              <button className="btn btn--sm btn--ghost" onClick={disconnect} disabled={busy}>{busy ? 'Disconnecting…' : 'Disconnect'}</button>
            </div>
            {calendars === null ? (
              <p className="cal-icloud-help">Loading calendars…</p>
            ) : calendars.length > 0 && (
              <ul className="cal-icloud-cals" aria-label="iCloud calendars">
                {calendars.map((c) => (
                  <li key={c.id} style={{ '--c': c.color }}>
                    <i />
                    <span>{c.name}</span>
                    {!c.writable && <small>Read only</small>}
                  </li>
                ))}
              </ul>
            )}
            <p className="cal-icloud-help">
              Repeating events show here but are edited in Apple Calendar. If you also added one of these calendars as a public feed, its
              events appear once, from iCloud. You can remove that feed under <strong>Feeds</strong>.
            </p>
          </>
        ) : (
          <>
            <div className="cal-icloud-help">
              Apple needs an <strong>app-specific password</strong> for this. Your normal Apple ID password won’t work.
              <ol>
                <li>Go to <a href="https://account.apple.com/account/manage" target="_blank" rel="noopener noreferrer">account.apple.com</a> → Sign-In and Security → App-Specific Passwords.</li>
                <li>Create one called “CTRLpanel” and paste it below.</li>
              </ol>
              It’s stored encrypted on the CTRLpanel server and never shown again. Revoke it on that Apple page at any time.
            </div>
            <form className="cal-icloud-form" onSubmit={connect}>
              <input className="input" type="email" placeholder="Apple ID email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="Apple ID email" required />
              <input className="input" type="password" placeholder="App-specific password (xxxx-xxxx-xxxx-xxxx)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} aria-label="App-specific password" required />
              <button className="btn btn--accent" disabled={busy || !username.trim() || !password.trim()}>{busy ? 'Checking with iCloud…' : 'Connect iCloud'}</button>
            </form>
          </>
        )}
        {error && <p className="cal-icloud-bad" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
