import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Card from '../components/shared/Card.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { queryTable } from '../lib/supabase.js';
import { gmail } from '../lib/api.js';
import { currency } from '../lib/helpers.js';

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function runTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Stat({ icon, label, value, meta }) {
  return (
    <Card className="stat-card">
      <div className="stat-card-head">
        <span className="section-label">{label}</span>
        <i className={`ti ${icon}`} />
      </div>
      <div className="stat-card-value">{value}</div>
      {meta && <div className="stat-card-meta">{meta}</div>}
    </Card>
  );
}

export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { agents } = useWorkspace();

  const agent = agents.rows.find((a) => a.id === id);

  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [triageBusy, setTriageBusy] = useState(false);
  const [triageNote, setTriageNote] = useState('');

  const loadRuns = useCallback(async () => {
    // Temp (optimistic) ids from useCrud.add aren't real rows yet — skip.
    if (!id || String(id).startsWith('tmp-')) {
      setRuns([]);
      setRunsLoading(false);
      return;
    }
    setRunsLoading(true);
    const { data } = await queryTable('agent_runs', {
      filters: { agent_id: id },
      order: 'run_at',
      ascending: false,
      limit: 50,
    });
    setRuns(Array.isArray(data) ? data : []);
    setRunsLoading(false);
  }, [id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  if (!agent) {
    return (
      <div className="placeholder fade-in">
        <i className="ti ti-robot-off" />
        <h2>{agents.loading ? 'Loading…' : 'Agent not found'}</h2>
        {!agents.loading && <button className="btn btn--accent" onClick={() => navigate('/agents')}>Back to Agents</button>}
      </div>
    );
  }

  const config = agent.config || {};
  const patch = (changes) => agents.patch(id, changes);
  const patchConfig = (changes) => patch({ config: { ...config, ...changes } });

  const toggle = () => {
    const status = agent.status === 'running' ? 'stopped' : 'running';
    patch({ status, last_run: status === 'running' ? new Date().toISOString() : agent.last_run });
  };
  const del = () => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    agents.remove(id);
    navigate('/agents');
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can select manually */ }
  };

  // Email Triage agent — "Run now" triggers the backend triage job directly.
  const isTriage = config.type === 'email_triage';
  const runTriageNow = async () => {
    setTriageBusy(true);
    setTriageNote('');
    try {
      const res = await gmail.runNow();
      setTriageNote(`Scanned ${res.emails_scanned} emails · ${res.needs_reply} need a reply.`);
      loadRuns();
    } catch (e) {
      setTriageNote(e.message);
    } finally {
      setTriageBusy(false);
    }
  };

  // ---- Stats derived from run history ----
  const weekAgo = Date.now() - 7 * 86400000;
  const runs7d = runs.filter((r) => new Date(r.run_at).getTime() >= weekAgo);
  const emails7d = runs7d.reduce((s, r) => s + (Number(r.emails_sent) || 0), 0);
  const cost7d = runs7d.reduce((s, r) => s + (Number(r.claude_cost_usd) || 0), 0);
  const sendsToday = Number(config.sends_today) || 0;
  const dailyLimit = Number(config.daily_limit) || 10;

  const nichesText = Array.isArray(config.niches)
    ? JSON.stringify(config.niches, null, 2)
    : (config.niches ? String(config.niches) : '');

  return (
    <div className="fade-in" style={{ maxWidth: 820 }}>
      <div className="page-header">
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/agents')} title="Back"><i className="ti ti-arrow-left" /></button>
          <div>
            <div className="row">
              <span className={`status-dot ${agent.status}`} />
              <h1 className="page-title">{agent.name}</h1>
            </div>
            <div className="page-header-sub">Last run: {timeAgo(agent.last_run)}</div>
          </div>
        </div>
        <button className="btn btn--danger" onClick={del}><i className="ti ti-trash" /> Delete</button>
      </div>

      {/* Status control */}
      <Card className="card-section" static style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <div className="section-label">Status</div>
            <div className="value-md" style={{ color: agent.status === 'running' ? 'var(--accent)' : 'var(--text-secondary)' }}>
              {agent.status === 'running' ? 'Running' : 'Stopped'}
            </div>
          </div>
          <div className="row gap-16">
            <div className={`switch ${agent.status === 'running' ? 'on' : ''}`} onClick={toggle} />
          </div>
        </div>
        <p className="list-row-meta mt-16">This toggle is saved to your database. A polling agent reads this status at the start of each scheduled run and starts or stops accordingly.</p>
      </Card>

      {/* Stats */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat icon="ti-send" label="Sent today" value={`${sendsToday} / ${dailyLimit}`} meta="resets daily" />
        <Stat icon="ti-mail" label="Emails · 7d" value={emails7d} meta="last 7 days" />
        <Stat icon="ti-coin" label="Claude cost · 7d" value={currency(cost7d, { cents: true })} meta="last 7 days" />
        <Stat icon="ti-clock" label="Last run" value={timeAgo(agent.last_run)} meta={runs.length ? `${runs.length} logged runs` : 'no runs yet'} />
      </div>

      {/* Activity / sent emails */}
      <Card className="card-section" static style={{ marginBottom: 16 }}>
        <div className="card-section-title">
          <span>Recent activity</span>
          <button className="btn btn--ghost btn--icon" onClick={loadRuns} title="Refresh"><i className="ti ti-refresh" /></button>
        </div>
        {runsLoading ? (
          <p className="list-row-meta">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="list-row-meta">No runs logged yet. When the agent sends an email or runs its pipeline, it shows up here.</p>
        ) : (
          runs.map((r) => (
            <div className="list-row" key={r.id}>
              <span className="list-row-time">{runTime(r.run_at)}</span>
              <span className={`badge ${r.action === 'email_sent' ? 'badge--green' : ''}`}>
                {r.action === 'email_sent' ? 'Email' : (r.action || 'run').replace('_', ' ')}
              </span>
              <div className="list-row-title" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{r.subject || r.lead_name || '—'}</span>
                <span className="list-row-meta">
                  {[r.lead_name, r.lead_email, [r.niche, r.city].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ')}
                </span>
              </div>
              {Number(r.claude_cost_usd) > 0 && (
                <span className="list-row-meta">{currency(r.claude_cost_usd, { cents: true })}</span>
              )}
            </div>
          ))
        )}
      </Card>

      {/* Config — editable */}
      <Card className="card-section" static>
        <div className="card-section-title">Configuration</div>
        <div className="field">
          <label className="field-label">Name</label>
          <input className="input" value={agent.name || ''} onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label">Description</label>
          <textarea className="textarea" value={agent.description || ''} onChange={(e) => patch({ description: e.target.value })} />
        </div>

        <div className="field">
          <label className="field-label">Agent ID</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" readOnly value={id} onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            <button className="btn btn--ghost" onClick={copyId}>
              <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="list-row-meta mt-16">Paste this into the agent's <code>.env</code> as <code>OUTREACH_AGENT_ID</code> so it knows which agent it is.</p>
        </div>

        {isTriage && (
          <>
            <div className="field">
              <label className="field-label">Daily schedule (UTC hour)</label>
              <select
                className="input"
                value={Number(config.schedule_hour ?? 13)}
                onChange={(e) => patchConfig({ schedule_hour: Number(e.target.value) })}
                style={{ maxWidth: 160 }}
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>{`${h}:00 UTC`}</option>
                ))}
              </select>
              <p className="list-row-meta mt-16">
                While the agent is running, unread mail from the last 24h is triaged daily at this hour across every
                account in Settings → Gmail Accounts. Suggested replies always wait for your approval.
              </p>
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 16 }}>
              <button className="btn btn--accent" onClick={runTriageNow} disabled={triageBusy}>
                <i className="ti ti-refresh" /> {triageBusy ? 'Scanning…' : 'Run now'}
              </button>
              <Link to="/reports/mail" className="btn">
                <i className="ti ti-report" /> Open Mail Triage brief
              </Link>
              {triageNote && <span className="list-row-meta">{triageNote}</span>}
            </div>
          </>
        )}

        {!isTriage && (
        <div className="field">
          <label className="field-label">Daily send limit</label>
          <input
            className="input"
            type="number"
            min="0"
            value={config.daily_limit ?? 10}
            onChange={(e) => patchConfig({ daily_limit: Number(e.target.value) })}
          />
        </div>
        )}

        {!isTriage && (
        <div className="field">
          <label className="field-label">Niches (JSON)</label>
          <textarea
            className="textarea"
            defaultValue={nichesText}
            placeholder='[ { "niche": "roofing contractor", "city": "Bridgeport", "state": "CT" } ]'
            style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 120 }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) { patchConfig({ niches: [] }); return; }
              try { patchConfig({ niches: JSON.parse(raw) }); }
              catch { /* leave last-saved value; invalid JSON ignored */ }
            }}
          />
          <p className="list-row-meta mt-16">List of niches the agent works, as JSON. Invalid JSON is ignored on save.</p>
        </div>
        )}

        <div className="field">
          <label className="field-label">Webhook URL <span className="list-row-meta">(optional — unused for polling agents)</span></label>
          <input className="input" placeholder="https://…" value={agent.webhook_url || ''} onChange={(e) => patch({ webhook_url: e.target.value })} />
        </div>
      </Card>
    </div>
  );
}
