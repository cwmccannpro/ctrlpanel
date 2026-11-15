// ============================================================
// CTRLpanel — Opportunities Agent (/agents/opportunities)
// "Run now" asks the backend to search the web with Claude and rank jobs,
// internships, programs, events, certifications and competitions against the
// user's config; results land in `opportunities`, runs in `opportunity_runs`.
// The gear opens the config modal. Statuses (Saved / Applied / Dismissed) are
// the user's and survive later runs.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import OpportunityRow from '../../components/OpportunityRow.jsx';
import OpportunityConfigModal from '../../components/OpportunityConfigModal.jsx';
import { useAuth } from '../../components/AuthProvider.jsx';
import { useCrud, useRows } from '../../lib/useData.js';
import { getAgentConfig } from '../../lib/supabase.js';
import { agentsApi } from '../../lib/api.js';
import { timeAgo, currency } from '../../lib/helpers.js';
import { OPPORTUNITIES_AGENT_KEY, OPPORTUNITY_KINDS, normalizeConfig, isConfigReady } from '../../lib/opportunityConfig.js';
import '../../styles/agents.css';

const STALE_MS = 20 * 60 * 1000;
const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the user's timezone
const money = (n) => currency(n, { cents: true });

const STATUS_FILTERS = [
  { id: 'active', label: 'Active', test: (s) => s === 'new' || s === 'saved' },
  { id: 'saved', label: 'Saved', test: (s) => s === 'saved' },
  { id: 'applied', label: 'Applied', test: (s) => s === 'applied' },
  { id: 'dismissed', label: 'Dismissed', test: (s) => s === 'dismissed' },
];
const MODE_FILTERS = [
  { id: 'all', label: 'Anywhere', test: () => true },
  { id: 'remote', label: 'Remote', test: (m) => m === 'remote' },
  { id: 'in_person', label: 'In person', test: (m) => m === 'in_person' || m === 'hybrid' },
];
const KIND_TABS = [{ id: 'all', short: 'All' }, ...OPPORTUNITY_KINDS];

export default function OpportunitiesAgent() {
  const { connectorKey } = useAuth();
  const opps = useCrud('opportunities');
  const runs = useRows('opportunity_runs', [], 'run_at');
  const { reload: reloadOpps } = opps;
  const { reload: reloadRuns } = runs;

  const [config, setConfig] = useState(null); // null while loading
  const [configOpen, setConfigOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [searches, setSearches] = useState(0);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState(null);
  const [kind, setKind] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [mode, setMode] = useState('all');
  const [showHistory, setShowHistory] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getAgentConfig(OPPORTUNITIES_AGENT_KEY)
      .then((row) => alive && setConfig(normalizeConfig(row?.config)))
      .catch(() => alive && setConfig(normalizeConfig()));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const runRows = runs.rows;
  const latestRun = runRows[runRows.length - 1] || null;
  const latestComplete = useMemo(() => [...runRows].reverse().find((r) => r.status === 'complete') || null, [runRows]);
  const serverRunning =
    !running && latestRun?.status === 'running' && Date.now() - new Date(latestRun.run_at).getTime() < STALE_MS;

  // A run started before navigating away (or in another tab) finishes on the
  // server — poll until its row leaves "running".
  useEffect(() => {
    if (!serverRunning) return undefined;
    const t = setInterval(() => {
      reloadRuns();
      reloadOpps();
    }, 10000);
    return () => clearInterval(t);
  }, [serverRunning, reloadRuns, reloadOpps]);

  const ready = Boolean(config && isConfigReady(config));

  const run = async () => {
    if (!ready) {
      setConfigOpen(true);
      return;
    }
    setRunning(true);
    setRunError('');
    setResult(null);
    setSearches(0);
    setLog([{ type: 'status', text: 'Starting…' }]);
    const push = (entry) => setLog((l) => (l.at(-1)?.text === entry.text ? l : [...l, entry].slice(-80)));
    try {
      await agentsApi.runOpportunities({ apiKey: connectorKey('anthropic') || undefined, today: localToday() }, (ev) => {
        if (ev.type === 'start') {
          push({ type: 'status', text: 'Searching the web…' });
          reloadRuns();
        } else if (ev.type === 'search') {
          setSearches((n) => n + 1);
          push({ type: 'search', text: ev.query });
        } else if (ev.type === 'status') {
          push({ type: 'status', text: ev.message });
        } else if (ev.type === 'done') {
          setResult(ev);
        } else if (ev.type === 'error') {
          setRunError(ev.message || 'Run failed');
        }
      });
    } catch (e) {
      setRunError(e.message || 'Run failed');
    } finally {
      setRunning(false);
      reloadOpps();
      reloadRuns();
    }
  };

  const setStatus = (item, status) => opps.patch(item.id, { status });

  const sorted = useMemo(
    () =>
      [...opps.rows].sort(
        (a, b) => (b.score || 0) - (a.score || 0) || String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || ''))
      ),
    [opps.rows]
  );
  const statusTest = (STATUS_FILTERS.find((f) => f.id === statusFilter) || STATUS_FILTERS[0]).test;
  const modeTest = (MODE_FILTERS.find((f) => f.id === mode) || MODE_FILTERS[0]).test;
  const pool = sorted.filter((o) => statusTest(o.status) && modeTest(o.mode));
  const counts = pool.reduce((m, o) => ({ ...m, [o.kind]: (m[o.kind] || 0) + 1 }), { all: pool.length });
  const visible = kind === 'all' ? pool : pool.filter((o) => o.kind === kind);
  const topPicks = sorted.filter((o) => o.status === 'new' || o.status === 'saved').slice(0, 3);
  const summary = latestComplete?.summary || {};
  const skills = Array.isArray(summary.skill_gaps) ? summary.skill_gaps : [];
  const fresh = opps.rows.filter((o) => o.status === 'new').length;

  const sub = latestRun
    ? [`Last run ${timeAgo(latestRun.run_at)}`, `${fresh} new`, latestComplete ? `${money(latestComplete.cost_usd)} last run` : null]
        .filter(Boolean)
        .join(' · ')
    : 'Finds and ranks jobs, programs, events, certifications and competitions for you';
  const emptyText =
    opps.rows.length === 0
      ? ready
        ? 'No results yet — press Run now.'
        : 'Configure the agent, then run it.'
      : 'Nothing matches these filters.';

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Opportunities Agent</h1>
          <div className="page-header-sub">{sub}</div>
        </div>
        <div className="row">
          <button className="btn btn--ghost btn--icon" title="Configure interests" aria-label="Configure" onClick={() => setConfigOpen(true)} disabled={!config}>
            <i className="ti ti-settings" />
          </button>
          <button className="btn btn--accent" onClick={run} disabled={running || serverRunning || !config}>
            <i className={`ti ${running ? 'ti-loader-2 opp-spin' : 'ti-player-play'}`} />
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>

      {config && !ready && (
        <Card static className="card-section opp-setup">
          <i className="ti ti-user opp-setup-icon" />
          <div style={{ flex: 1 }}>
            <div className="opp-setup-title">Tell the agent about you</div>
            <p className="body-text">
              Import your resume, pick industries and where you can go. The agent uses this to find and rank what's worth applying for or attending.
            </p>
          </div>
          <button className="btn btn--accent" onClick={() => setConfigOpen(true)}>
            <i className="ti ti-settings" /> Configure
          </button>
        </Card>
      )}

      {(running || serverRunning) && (
        <Card static className="card-section opp-progress">
          <div className="spread">
            <div className="row">
              <Spinner />
              <span className="opp-progress-title">{running ? 'Searching the web…' : 'A run is in progress…'}</span>
            </div>
            {running && (
              <span className="list-row-meta">
                {searches} search{searches === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          {running ? (
            <>
              <ul className="opp-progress-log" ref={logRef}>
                {log.map((l, i) => (
                  <li key={i}>
                    <i className={`ti ${l.type === 'search' ? 'ti-search' : 'ti-point'}`} />
                    <span>{l.text}</span>
                  </li>
                ))}
              </ul>
              <p className="list-row-meta mt-16">Usually 2–5 minutes. Keep this tab open until it finishes.</p>
            </>
          ) : (
            <p className="body-text mt-16">Results appear here when it finishes.</p>
          )}
        </Card>
      )}

      {!running && runError && (
        <Card static className="card-section opp-banner opp-banner--error">
          <i className="ti ti-alert-triangle" />
          <span>{runError}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => setRunError('')}>Dismiss</button>
        </Card>
      )}

      {!running && result && (
        <Card static className="card-section opp-banner">
          <i className="ti ti-circle-check" />
          <span>
            Found {result.found} — {result.added} new, {result.updated} updated · {result.searches} searches · {money(result.cost_usd)}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => setResult(null)}>Dismiss</button>
        </Card>
      )}

      {topPicks.length > 0 && (
        <section className="opp-section">
          <div className="section-label">Top picks</div>
          <div className="opp-top">
            {topPicks.map((o) => (
              <OpportunityRow key={o.id} item={o} onStatus={setStatus} featured />
            ))}
          </div>
        </section>
      )}

      {skills.length > 0 && (
        <Card static className="card-section opp-section">
          <div className="spread">
            <div className="card-section-title">Skills to build</div>
            <span className="list-row-meta">From the run {timeAgo(latestComplete.run_at)}</span>
          </div>
          {summary.headline && <p className="body-text">{summary.headline}</p>}
          <div className="opp-skills">
            {skills.map((s, i) => (
              <div className="opp-skill" key={i}>
                <div className="opp-skill-name">
                  <i className="ti ti-school" />
                  {s.skill}
                </div>
                {s.why && <p>{s.why}</p>}
                {s.how_to_learn && (
                  <p>
                    <span className="opp-skill-how">How: </span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">{s.how_to_learn}</a>
                    ) : (
                      s.how_to_learn
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
          {summary.market_notes && <p className="list-row-meta mt-16">{summary.market_notes}</p>}
        </Card>
      )}

      <Card static className="card-section opp-section">
        <div className="tabs opp-tabs">
          {KIND_TABS.map((t) => (
            <button key={t.id} className={`tab ${kind === t.id ? 'active' : ''}`} onClick={() => setKind(t.id)}>
              {t.short}
              <span className="opp-tab-count">{counts[t.id] || 0}</span>
            </button>
          ))}
        </div>
        <div className="opp-filters">
          <div className="segmented">
            {STATUS_FILTERS.map((f) => (
              <button key={f.id} className={statusFilter === f.id ? 'active' : ''} onClick={() => setStatusFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="segmented">
            {MODE_FILTERS.map((f) => (
              <button key={f.id} className={mode === f.id ? 'active' : ''} onClick={() => setMode(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {opps.loading ? (
          <div className="opp-empty">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <div className="opp-empty">{emptyText}</div>
        ) : (
          <div className="opp-list">
            {visible.map((o) => (
              <OpportunityRow key={o.id} item={o} onStatus={setStatus} />
            ))}
          </div>
        )}
      </Card>

      {runRows.length > 0 && (
        <Card static className="card-section opp-section">
          <button className="opp-history-toggle" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            <i className={`ti ti-chevron-right opp-chevron${showHistory ? ' open' : ''}`} />
            Run history
            <span className="list-row-meta">({runRows.length})</span>
          </button>
          {showHistory && (
            <div className="opp-history">
              {[...runRows].reverse().map((r) => (
                <div className="list-row" key={r.id}>
                  <span className={`status-dot ${r.status === 'complete' ? 'running' : 'stopped'}`} />
                  <span className="list-row-title">
                    {new Date(r.run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="list-row-meta">
                    {r.status === 'complete'
                      ? `${r.found} found · ${r.added} new · ${r.searches} searches · ${money(r.cost_usd)}`
                      : r.status === 'running'
                        ? 'running…'
                        : r.error || 'failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {configOpen && config && (
        <OpportunityConfigModal initial={config} onClose={() => setConfigOpen(false)} onSaved={setConfig} />
      )}
    </div>
  );
}
