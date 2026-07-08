import { useNavigate } from 'react-router-dom';
import Card from '../components/shared/Card.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Agents() {
  const { agents } = useWorkspace();
  const navigate = useNavigate();

  const toggle = (a, e) => {
    e.stopPropagation();
    const status = a.status === 'running' ? 'stopped' : 'running';
    const last_run = status === 'running' ? new Date().toISOString() : a.last_run;
    agents.patch(a.id, { status, last_run });
  };

  const addAgent = async () => {
    const name = prompt('Agent name?');
    if (!name) return;
    const created = await agents.add({ name, description: '', webhook_url: null, status: 'stopped' });
    if (created?.id) navigate(`/agents/${created.id}`);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <div className="page-header-sub">{agents.rows.filter((a) => a.status === 'running').length} of {agents.rows.length} running</div>
        </div>
        <button className="btn btn--accent" onClick={addAgent}><i className="ti ti-plus" /> Add Agent</button>
      </div>

      {agents.rows.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-robot" />
          <h2>No agents yet</h2>
          <p>Add an agent to automate outreach, finances, content, and more. Each agent gets its own page — selectable from the sidebar.</p>
          <button className="btn btn--accent" onClick={addAgent}><i className="ti ti-plus" /> Add Agent</button>
        </div>
      ) : (
        <div className="grid grid-3">
          {agents.rows.map((a) => (
            <Card key={a.id} className="card-section" onClick={() => navigate(`/agents/${a.id}`)} style={{ cursor: 'pointer' }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <div className="row">
                  <span className={`status-dot ${a.status}`} />
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{a.name}</span>
                </div>
                <div className={`switch ${a.status === 'running' ? 'on' : ''}`} onClick={(e) => toggle(a, e)} />
              </div>
              <p className="body-text" style={{ minHeight: 36 }}>{a.description || 'No description yet.'}</p>
              <div className="spread mt-16">
                <span className="list-row-meta">Last run: {timeAgo(a.last_run)}</span>
                <span className={`badge ${a.status === 'running' ? 'badge--green' : ''}`}>{a.status === 'running' ? 'Running' : 'Stopped'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
