// ============================================================
// CTRLpanel — Agents overview (/agents)
// Lists every agent in src/lib/agentRegistry.js; each card opens its page.
// ============================================================
import AgentCard from '../../components/AgentCard.jsx';
import { AGENTS } from '../../lib/agentRegistry.js';
import '../../styles/agents.css';

export default function Agents() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="sr-only">Agents</h1>
          <div className="page-header-sub">
            {AGENTS.length} agent{AGENTS.length === 1 ? '' : 's'} · each runs on demand
          </div>
        </div>
      </div>

      {AGENTS.length === 0 ? (
        <div className="placeholder">
          <i className="ti ti-robot" />
          <h2>No agents yet</h2>
          <p>Agents added to the registry show up here and in the sidebar.</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {AGENTS.map((a) => (
            <AgentCard key={a.key} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}
