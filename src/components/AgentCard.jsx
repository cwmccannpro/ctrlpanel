// Overview card for one registry agent (src/lib/agentRegistry.js): name,
// description, last run and how many new results are waiting.
import { useNavigate } from 'react-router-dom';
import Card from './shared/Card.jsx';
import Badge from './shared/Badge.jsx';
import { useRows } from '../lib/useData.js';
import { timeAgo } from '../lib/helpers.js';

const STALE_MS = 20 * 60 * 1000;

export default function AgentCard({ agent }) {
  const navigate = useNavigate();
  const { rows: runs } = useRows(agent.runsTable, []);
  const { rows: items } = useRows(agent.itemsTable, []);
  const last = runs.reduce((a, r) => (!a || String(r.run_at) > String(a.run_at) ? r : a), null);
  const running = last?.status === 'running' && Date.now() - new Date(last.run_at).getTime() < STALE_MS;
  const fresh = items.filter((i) => i.status === 'new').length;

  return (
    <Card className="card-section agent-card" onClick={() => navigate(agent.to)} style={{ cursor: 'pointer' }}>
      <div className="spread" style={{ marginBottom: 8 }}>
        <div className="row">
          <i className={`ti ${agent.icon} agent-card-icon`} />
          <span className="agent-card-name">{agent.name}</span>
        </div>
        <span className={`status-dot ${running ? 'running' : 'stopped'}`} title={running ? 'Running' : 'Idle'} />
      </div>
      <p className="body-text" style={{ minHeight: 34 }}>{agent.description}</p>
      <div className="spread mt-16">
        <span className="list-row-meta">
          {running ? 'Running now…' : `Last run: ${last ? timeAgo(last.run_at) : 'never'}`}
          {!running && last?.status === 'error' ? ' · failed' : ''}
        </span>
        <Badge variant={fresh ? 'accent' : undefined}>
          {fresh} {agent.itemsLabel}
        </Badge>
      </div>
    </Card>
  );
}
