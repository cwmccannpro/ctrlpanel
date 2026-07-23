// ============================================================
// CTRLpanel — Reports (overview)
// Report "sources" are named inbound channels. Each has its own token; an
// external tool (e.g. a Claude routine doing email triage) POSTs a PDF to
// /api/reports/ingest and it lands as a report the user reads in-app. The
// token's SHA-256 hash is stored (report_sources.key_hash); the plaintext is
// shown exactly once here, on creation.
// ============================================================
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { useRows } from '../../lib/useData.js';

export const INGEST_URL = () => `${window.location.origin}/api/reports/ingest`;

export function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Random token + its SHA-256 hash (Web Crypto). The plaintext is shown once;
// only the hash is persisted, exactly like the Nutrition API keys.
export async function generateReportToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = 'ctpr_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hash, prefix: raw.slice(0, 13) };
}

export function SetupHint({ token }) {
  const [copied, setCopied] = useState('');
  const origin = window.location.origin;
  const shown = token || 'ctpr_YOUR_TOKEN';
  const cmd = `curl -X POST "${origin}/api/reports/ingest" \\
  -H "Authorization: Bearer ${shown}" \\
  -H "Content-Type: application/pdf" \\
  -H "X-Report-Title: My report" \\
  --data-binary @report.pdf`;

  const copy = (text, what) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div className="section-label" style={{ marginBottom: 4 }}>Endpoint</div>
        <div className="row" style={{ gap: 8 }}>
          <code className="report-code" style={{ flex: 1 }}>{origin}/api/reports/ingest</code>
          <button className="btn btn--ghost btn--sm" onClick={() => copy(`${origin}/api/reports/ingest`, 'endpoint')}>
            <i className="ti ti-copy" /> {copied === 'endpoint' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {token && (
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Token — copy it now, it won't be shown again</div>
          <div className="row" style={{ gap: 8 }}>
            <code className="report-code" style={{ flex: 1, color: 'var(--accent)' }}>{token}</code>
            <button className="btn btn--accent btn--sm" onClick={() => copy(token, 'token')}>
              <i className="ti ti-copy" /> {copied === 'token' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      <div>
        <div className="section-label" style={{ marginBottom: 4 }}>Send a PDF</div>
        <pre className="report-code" style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>{cmd}</pre>
      </div>
      <p className="list-row-meta">
        Point any tool that can make an HTTP request at this endpoint with the token — a Claude routine, a Zapier/Make
        step, a cron script. Send the PDF as the raw request body. The optional <code>X-Report-Title</code> header sets
        the title shown in your list.
      </p>
    </div>
  );
}

export default function Reports() {
  const { reportSources } = useWorkspace();
  const navigate = useNavigate();
  const { rows: reports } = useRows('reports');

  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // { token } shown once

  const countBySource = useMemo(() => {
    const m = {};
    reports.forEach((r) => { m[r.source_id] = (m[r.source_id] || 0) + 1; });
    return m;
  }, [reports]);

  const openAdd = () => { setName(''); setCreated(null); setModal(true); };

  const addSource = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { raw, hash, prefix } = await generateReportToken();
      await reportSources.add({ name: name.trim(), key_hash: hash, key_prefix: prefix });
      setCreated({ token: raw });
    } finally {
      setBusy(false);
    }
  };

  const sources = reportSources.rows;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-header-sub">Inbound PDF reports sent to CTRLpanel from your own tools</div>
        </div>
        <button className="btn btn--accent" onClick={openAdd}><i className="ti ti-plus" /> Add report source</button>
      </div>

      {sources.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-report" />
          <h2>No report sources yet</h2>
          <p>
            A report source is an inbox for PDFs. Create one to get a private endpoint + token, then have any tool —
            like a Claude routine that triages your email — send a PDF report to it. They'll collect here for you to read.
          </p>
          <button className="btn btn--accent" onClick={openAdd}><i className="ti ti-plus" /> Add report source</button>
        </div>
      ) : (
        <div className="grid grid-3">
          {sources.map((s) => (
            <Card key={s.id} className="card-section" onClick={() => navigate(`/reports/${s.id}`)} style={{ cursor: 'pointer' }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <i className="ti ti-report" style={{ color: 'var(--accent)', fontSize: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{s.name}</span>
              </div>
              <div className="spread mt-16">
                <span className="list-row-meta">{countBySource[s.id] || 0} report{(countBySource[s.id] || 0) === 1 ? '' : 's'}</span>
                <span className="list-row-meta">Last: {timeAgo(s.last_received_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={created ? 'Report source created' : 'Add a report source'} onClose={() => setModal(false)}>
          {!created ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p className="body-text">
                Give this source a name (e.g. <em>Email Triage</em>, <em>Weekly Finance</em>). You'll get an endpoint and
                a one-time token to send PDFs to.
              </p>
              <input
                className="input"
                placeholder="Source name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSource()}
              />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn--ghost" onClick={() => setModal(false)}>Cancel</button>
                <button className="btn btn--accent" onClick={addSource} disabled={!name.trim() || busy}>
                  {busy ? 'Creating…' : 'Create source'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SetupHint token={created.token} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn--accent" onClick={() => setModal(false)}>Done</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
