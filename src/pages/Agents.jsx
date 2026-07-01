import { useState } from 'react';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useRows } from '../lib/useData.js';
import { update as sbUpdate, insert as sbInsert } from '../lib/supabase.js';
import { mockAgents } from '../lib/mockData.js';

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

let tmpId = 0;

export default function Agents() {
  const { rows: agents, setRows: setAgents, usingMock } = useRows('agents', mockAgents);
  const [adding, setAdding] = useState(null);

  const toggle = (a) => {
    const status = a.status === 'running' ? 'stopped' : 'running';
    const last_run = status === 'running' ? new Date().toISOString() : a.last_run;
    setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status, last_run } : x)));
    sbUpdate('agents', a.id, { status, last_run });
    // NOTE: webhook firing is a placeholder — status is toggled in the DB only (AGENTS.md).
  };

  const saveNew = () => {
    if (!adding.name?.trim()) return;
    const created = { ...adding, id: `new-${Date.now()}-${tmpId++}`, status: 'stopped', last_run: null };
    setAgents((prev) => [...prev, created]);
    sbInsert('agents', [{ name: adding.name, description: adding.description, webhook_url: adding.webhook_url, status: 'stopped' }]);
    setAdding(null);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <div className="page-header-sub">
            {agents.filter((a) => a.status === 'running').length} of {agents.length} running {usingMock && '· demo data'}
          </div>
        </div>
        <button className="btn btn--accent" onClick={() => setAdding({})}>
          <i className="ti ti-plus" /> Add Agent
        </button>
      </div>

      <div className="grid grid-3">
        {agents.map((a) => (
          <Card key={a.id} className="card-section">
            <div className="spread" style={{ marginBottom: 8 }}>
              <div className="row">
                <span className={`status-dot ${a.status}`} />
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{a.name}</span>
              </div>
              <div className={`switch ${a.status === 'running' ? 'on' : ''}`} onClick={() => toggle(a)} />
            </div>
            <p className="body-text" style={{ minHeight: 36 }}>{a.description}</p>
            <div className="spread mt-16">
              <span className="list-row-meta">Last run: {timeAgo(a.last_run)}</span>
              <span className={`badge ${a.status === 'running' ? 'badge--green' : ''}`}>
                {a.status === 'running' ? 'Running' : 'Stopped'}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {adding && (
        <Modal
          title="Add Agent"
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveNew}>Save</button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Name</label>
            <input className="input" value={adding.name || ''} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label className="field-label">Description</label>
            <textarea className="textarea" value={adding.description || ''} onChange={(e) => setAdding({ ...adding, description: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label">Webhook URL</label>
            <input className="input" placeholder="https://…" value={adding.webhook_url || ''} onChange={(e) => setAdding({ ...adding, webhook_url: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  );
}
