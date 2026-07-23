// ============================================================
// CTRLpanel — Report source detail (/reports/:sourceId)
// The received PDFs for one source (view / download / delete), plus the
// setup panel (endpoint + how to send) and a token regenerate action.
// ============================================================
import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { useCrud } from '../../lib/useData.js';
import { signedUrl, removeStorage } from '../../lib/supabase.js';
import { SetupHint, generateReportToken, timeAgo } from './Reports.jsx';

const BUCKET = 'reports';

function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const fmtDate = (ts) =>
  ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export default function ReportSourceDetail() {
  const { sourceId } = useParams();
  const navigate = useNavigate();
  const { reportSources } = useWorkspace();
  const reports = useCrud('reports'); // reads all own reports; filtered below

  const [busyId, setBusyId] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [regenBusy, setRegenBusy] = useState(false);

  const source = reportSources.rows.find((s) => s.id === sourceId);
  const items = useMemo(
    () =>
      reports.rows
        .filter((r) => r.source_id === sourceId)
        .sort((a, b) => new Date(b.received_at) - new Date(a.received_at)),
    [reports.rows, sourceId]
  );

  const open = async (r, download) => {
    setBusyId(r.id);
    try {
      const url = await signedUrl(BUCKET, r.file_path, 3600, download ? { download: `${r.title}.pdf` } : undefined);
      if (url) window.open(url, '_blank', 'noopener');
    } finally {
      setBusyId(null);
    }
  };

  const del = async (r) => {
    if (!confirm(`Delete "${r.title}"? This removes the PDF permanently.`)) return;
    setBusyId(r.id);
    try {
      await removeStorage(BUCKET, r.file_path);
      await reports.remove(r.id);
    } finally {
      setBusyId(null);
    }
  };

  const deleteSource = async () => {
    if (!source) return;
    if (!confirm(`Delete the report source “${source.name}” and all ${items.length} of its report${items.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    // Remove the PDFs from storage first (DB cascade drops the report rows).
    const paths = items.map((r) => r.file_path).filter(Boolean);
    if (paths.length) await removeStorage(BUCKET, paths);
    await reportSources.remove(source.id);
    navigate('/reports');
  };

  const regenerate = async () => {
    if (!source || regenBusy) return;
    if (!confirm('Regenerate the token? The old token stops working immediately.')) return;
    setRegenBusy(true);
    try {
      const { raw, hash, prefix } = await generateReportToken();
      await reportSources.patch(source.id, { key_hash: hash, key_prefix: prefix });
      setNewToken(raw);
    } finally {
      setRegenBusy(false);
    }
  };

  if (!source) {
    return (
      <div className="fade-in">
        <div className="placeholder">
          <i className="ti ti-report-off" />
          <h2>Report source not found</h2>
          <p>It may have been deleted. <Link to="/reports" style={{ color: 'var(--accent)' }}>Back to Reports</Link>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <Link to="/reports" className="btn btn--ghost btn--icon" title="Back to Reports"><i className="ti ti-arrow-left" /></Link>
            <h1 className="page-title" style={{ margin: 0 }}>{source.name}</h1>
          </div>
          <div className="page-header-sub">
            {items.length} report{items.length === 1 ? '' : 's'} · last received {timeAgo(source.last_received_at)}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--ghost" onClick={() => reports.reload()} title="Refresh"><i className="ti ti-refresh" /> Refresh</button>
          <button className="btn btn--accent" onClick={() => { setNewToken(null); setSetupOpen(true); }}>
            <i className="ti ti-plug" /> How to send
          </button>
          <button className="btn btn--ghost btn--icon" onClick={deleteSource} title="Delete source"><i className="ti ti-trash" /></button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-file-text" />
          <h2>No reports yet</h2>
          <p>Nothing has been sent to this source. Use “How to send” to get the endpoint and token, then have your tool POST a PDF.</p>
          <button className="btn btn--accent" onClick={() => { setNewToken(null); setSetupOpen(true); }}><i className="ti ti-plug" /> How to send</button>
        </div>
      ) : (
        <Card className="card-section" static>
          {items.map((r) => (
            <div className="list-row" key={r.id}>
              <i className="ti ti-file-type-pdf" style={{ color: 'var(--accent)', fontSize: 18, flexShrink: 0 }} />
              <div className="list-row-title" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span className="list-row-meta">{fmtDate(r.received_at)}{r.file_size ? ` · ${fileSize(r.file_size)}` : ''}</span>
              </div>
              <button className="btn btn--ghost btn--sm" disabled={busyId === r.id} onClick={() => open(r, false)} title="View PDF">
                <i className="ti ti-eye" /> View
              </button>
              <button className="btn btn--ghost btn--icon" disabled={busyId === r.id} onClick={() => open(r, true)} title="Download">
                <i className="ti ti-download" />
              </button>
              <button className="btn btn--ghost btn--icon" disabled={busyId === r.id} onClick={() => del(r)} title="Delete">
                <i className="ti ti-trash" />
              </button>
            </div>
          ))}
        </Card>
      )}

      {setupOpen && (
        <Modal title={`Send reports to “${source.name}”`} onClose={() => setSetupOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SetupHint token={newToken} />
            {!newToken && (
              <p className="list-row-meta">
                Token prefix on file: <code className="report-code">{source.key_prefix || 'ctpr_…'}</code>. Tokens are stored
                hashed and can't be shown again — if you've lost it, regenerate a new one below.
              </p>
            )}
            <div className="spread">
              <button className="btn btn--ghost" onClick={regenerate} disabled={regenBusy}>
                <i className="ti ti-refresh" /> {regenBusy ? 'Regenerating…' : 'Regenerate token'}
              </button>
              <button className="btn btn--accent" onClick={() => setSetupOpen(false)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
