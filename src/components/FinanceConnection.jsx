import { useEffect, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { useAuth } from './AuthProvider.jsx';
import { financeSheets } from '../lib/api.js';

export default function FinanceConnection({ finance, initialUrl = '', onClose }) {
  const { user } = useAuth();
  const [url, setUrl] = useState(initialUrl || finance.connection?.url || '');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; financeSheets.status().then((s) => active && setStatus(s)).catch((e) => active && setError(e.message)); return () => { active = false; }; }, []);
  const submit = async (e) => {
    e.preventDefault();
    const id = url.trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/)?.[1] || (/^[\w-]{8,200}$/.test(url.trim()) ? url.trim() : '');
    if (!id) { setError('Paste a Google Sheets link or spreadsheet ID.'); return; }
    setBusy(true); setError('');
    try { await finance.connect(id); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <Modal title="Connect your finance workbook" onClose={() => !busy && onClose()}>
    <form onSubmit={submit} className="fin-connect">
      <p>Your workbook powers every finance view and dashboard widget. Edits made here are saved directly to Google Sheets.</p>
      <ol className="fin-setup-steps">
        <li>Use the Accounts, Income, Budget, Transactions, Holdings, History and Goals tabs from the finance template.</li>
        <li>In the workbook’s <strong>_CTRLpanel</strong> tab, set <strong>owner_email</strong> to <strong>{user?.email}</strong>.</li>
        <li>{status?.ready ? <>Share the workbook as an <strong>Editor</strong> with <code className="fin-service-email">{status.serviceEmail}</code></> : status ? 'Configure a Google Sheets service account on the server before connecting.' : 'Checking the Google Sheets connection…'}</li>
      </ol>
      <label className="field"><span className="field-label">Google Sheets link</span><input className="input" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoFocus /></label>
      <p className="fin-caption">Row 1 defines the fields. Permanent IDs keep edits safe when you sort rows or move columns. Existing CTRLpanel finance records are retained.</p>
      {error && <p className="fin-error" role="alert">{error}</p>}
      <div className="fin-form-actions"><button className="btn btn--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn--accent" disabled={busy || !status?.ready}>{busy ? 'Connecting…' : 'Connect workbook'}</button></div>
    </form>
  </Modal>;
}
