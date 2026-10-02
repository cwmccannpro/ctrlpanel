import { useState, useEffect, useCallback } from 'react';
import Modal from './shared/Modal.jsx';
import { sheets } from '../lib/api.js';
import { clearSheetCache } from '../lib/sheetsCache.js';

const CONSOLE = 'https://console.cloud.google.com';

function Copyable({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the text is selectable, so the user can copy by hand */ }
  };
  return (
    <div className="row crm-share-address">
      <code>{text}</code>
      <button type="button" className="btn btn--ghost btn--icon" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label}`} title={copied ? 'Copied' : 'Copy'}>
        <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} />
      </button>
    </div>
  );
}

/** First-time setup: what to do in Google Cloud and where the key goes. */
function SetupSteps({ status, onRecheck, checking }) {
  return (
    <>
      <p className="body-text">
        CTRLpanel reads your sheets through a <strong>Google service account</strong> — a robot login you create once.
        It takes about five minutes and needs no consent screen.
      </p>
      {status.configError && <p className="body-text crm-error" role="alert">{status.configError}</p>}
      <ol className="crm-steps">
        <li>
          In <a href={`${CONSOLE}/apis/library/sheets.googleapis.com`} target="_blank" rel="noopener noreferrer">Google Cloud Console</a>,
          pick (or create) a project and click <strong>Enable</strong> on the Google Sheets API.
        </li>
        <li>
          Open <a href={`${CONSOLE}/iam-admin/serviceaccounts`} target="_blank" rel="noopener noreferrer">IAM &amp; Admin → Service Accounts</a> and
          create a service account (any name; it needs no roles).
        </li>
        <li>Open it → <strong>Keys</strong> → <strong>Add key</strong> → <strong>Create new key</strong> → <strong>JSON</strong>. A file downloads.</li>
        <li>
          Put the whole file in your <code>.env</code> as one value:
          <Copyable label="env line" text={"GOOGLE_SERVICE_ACCOUNT_JSON='<paste the file contents>'"} />
          For the deployed app run <code>npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON</code> and paste it.
        </li>
        <li>Restart the API server (<code>npm run server</code>), then press Check again.</li>
      </ol>
      <div className="modal-footer">
        <button className="btn btn--accent" onClick={onRecheck} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
      </div>
    </>
  );
}

export default function LinkSheetModal({ board, onClose, onLinked }) {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null); // result of the live connection check
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const s = await sheets.status();
      setStatus(s);
      // Credentials exist: prove they actually work (key valid, Sheets API enabled).
      setHealth(s.ready ? await sheets.check() : null);
    } catch (e) {
      setError(e.message || 'Could not reach the CTRLpanel server.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connect = async (e) => {
    e.preventDefault();
    if (busy || !health?.ok) return;
    const value = url.trim();
    const id = value.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:[/?#]|$)/)?.[1] || (/^[\w-]{8,}$/.test(value) ? value : '');
    if (!id) { setError('Paste a Google Sheets link or spreadsheet ID.'); return; }
    setBusy(true);
    setError('');
    try {
      const meta = await sheets.meta(id);
      if (!meta.sheets?.length) throw new Error('This spreadsheet has no tabs.');
      clearSheetCache(id);
      await onLinked({ spreadsheet_id: meta.id, spreadsheet_url: meta.url, spreadsheet_title: meta.title, sheet_name: meta.sheets[0].title });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not connect this spreadsheet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Connect Sheets · ${board.name}`} onClose={busy ? () => {} : onClose}>
      {error && <p className="body-text crm-error" role="alert">{error}</p>}
      {!status && !error && <p className="body-text" role="status">Checking connection…</p>}

      {status && !status.ready && <SetupSteps status={status} onRecheck={load} checking={checking} />}

      {status?.ready && health && !health.ok && (
        <>
          <p className="body-text crm-error" role="alert"><i className="ti ti-alert-triangle" /> {health.error}</p>
          <div className="modal-footer">
            <button className="btn btn--accent" onClick={load} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
          </div>
        </>
      )}

      {status?.ready && health?.ok && (
        <form onSubmit={connect}>
          <p className="crm-ok"><i className="ti ti-circle-check" /> Connected to Google as the service account.</p>
          <p className="body-text">Share your spreadsheet with this address:</p>
          <Copyable label="sharing address" text={status.serviceEmail} />
          <ul className="crm-share-help">
            <li><strong>Viewer</strong> — CTRLpanel shows the sheet; you edit it in Google Sheets.</li>
            <li><strong>Editor</strong> — you can also edit cells, add rows and delete rows right here.</li>
          </ul>
          <div className="field">
            <label className="field-label" htmlFor="crm-sheet-url">Google Sheets link</label>
            <input id="crm-sheet-url" className="input" autoFocus placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
          </div>
          <p className="list-row-meta">Row 1 becomes your columns. Every tab in the spreadsheet is available.</p>
          <div className="modal-footer">
            <button className="btn btn--accent" disabled={busy || !url.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
