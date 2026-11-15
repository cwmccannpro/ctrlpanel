// ============================================================
// CTRLpanel — Industry Problems Agent (/agents/industry-problems)
// Name an industry and Claude researches it on the web: it maps the value
// chain (shown as a mind map) and mines reviews, forums and job posts for
// narrow problems the user could realistically build a solution for, ranked by
// pain, attainability, demand, reach and gap. Results land in
// `industry_problems`, runs (with the map) in `industry_runs`. Statuses
// (Saved / Exploring / Dismissed) are the user's and survive later runs. The
// gear describes the builder (skills, time, buyers) — attainability is scored
// against it.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/shared/Card.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import MindMap from '../../components/MindMap.jsx';
import IndustryProblemCard from '../../components/IndustryProblemCard.jsx';
import IndustryConfigModal from '../../components/IndustryConfigModal.jsx';
import { useAuth } from '../../components/AuthProvider.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useWorkspace } from '../../components/WorkspaceProvider.jsx';
import { useCrud, useRows } from '../../lib/useData.js';
import { getAgentConfig } from '../../lib/supabase.js';
import { agentsApi } from '../../lib/api.js';
import { timeAgo, currency } from '../../lib/helpers.js';
import {
  INDUSTRY_AGENT_KEY,
  INDUSTRY_PRESETS,
  normalizeIndustryConfig,
  isIndustryConfigReady,
  cleanIndustry,
  cleanFocus,
  industrySlug,
} from '../../lib/industryConfig.js';
import { mapToMarkdown } from '../../lib/industryMap.js';
import {
  STATUS_FILTERS,
  industriesFromRuns,
  problemsFor,
  problemsByMapKey,
  problemToMarkdown,
  projectFromProblem,
} from '../../lib/industryProblems.js';
import '../../styles/agents.css';

const STALE_MS = 20 * 60 * 1000;
const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the user's timezone
const money = (n) => currency(n, { cents: true });

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

export default function IndustryProblemsAgent() {
  const { connectorKey } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { projects } = useWorkspace();
  const problems = useCrud('industry_problems');
  const runs = useRows('industry_runs', [], 'run_at');
  const { reload: reloadProblems } = problems;
  const { reload: reloadRuns } = runs;

  const [config, setConfig] = useState(null); // null while loading
  const [configOpen, setConfigOpen] = useState(false);
  const [industryInput, setIndustryInput] = useState('');
  const [focusInput, setFocusInput] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [searches, setSearches] = useState(0);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState(null);
  const [selKey, setSelKey] = useState(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [focus, setFocus] = useState(null); // { id, n } — a problem targeted from the map
  const [showHistory, setShowHistory] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getAgentConfig(INDUSTRY_AGENT_KEY)
      .then((row) => alive && setConfig(normalizeIndustryConfig(row?.config)))
      .catch(() => alive && setConfig(normalizeIndustryConfig()));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const runRows = runs.rows;
  const latestRun = runRows[runRows.length - 1] || null;
  const serverRunning =
    !running && latestRun?.status === 'running' && Date.now() - new Date(latestRun.run_at).getTime() < STALE_MS;

  // A run started before navigating away (or in another tab) finishes on the
  // server — poll until its row leaves "running".
  useEffect(() => {
    if (!serverRunning) return undefined;
    const t = setInterval(() => {
      reloadRuns();
      reloadProblems();
    }, 10000);
    return () => clearInterval(t);
  }, [serverRunning, reloadRuns, reloadProblems]);

  const ready = Boolean(config && isIndustryConfigReady(config));
  const industries = useMemo(() => industriesFromRuns(runRows), [runRows]);
  const selected = industries.find((i) => i.key === selKey) || industries[0] || null;
  const summary = selected?.run?.summary || {};
  const map = summary.map || { stages: [] };

  const all = useMemo(() => (selected ? problemsFor(problems.rows, selected.key) : []), [problems.rows, selected]);
  const byMapKey = useMemo(() => (selected ? problemsByMapKey(all, selected.run.id) : new Map()), [all, selected]);
  const linkedKeys = useMemo(() => new Set(byMapKey.keys()), [byMapKey]);
  const statusTest = (STATUS_FILTERS.find((f) => f.id === statusFilter) || STATUS_FILTERS[0]).test;
  const visible = all.filter((p) => statusTest(p.status));
  const countFor = (f) => all.filter((p) => f.test(p.status)).length;
  const activeKey = focus ? [...byMapKey].find(([, p]) => p.id === focus.id)?.[0] : null;
  const activeCount = problems.rows.filter((p) => p.status !== 'dismissed').length;

  const run = async () => {
    const industry = cleanIndustry(industryInput);
    if (!industry) return;
    if (!ready) {
      setConfigOpen(true);
      return;
    }
    setRunning(true);
    setRunError('');
    setResult(null);
    setSearches(0);
    setLog([{ type: 'status', text: `Researching ${industry}…` }]);
    const push = (entry) => setLog((l) => (l.at(-1)?.text === entry.text ? l : [...l, entry].slice(-80)));
    try {
      await agentsApi.runIndustry(
        { apiKey: connectorKey('anthropic') || undefined, today: localToday(), industry, focus: cleanFocus(focusInput) },
        (ev) => {
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
            setSelKey(industrySlug(industry));
            setStatusFilter('active');
          } else if (ev.type === 'error') {
            setRunError(ev.message || 'Run failed');
          }
        }
      );
    } catch (e) {
      setRunError(e.message || 'Run failed');
    } finally {
      setRunning(false);
      reloadProblems();
      reloadRuns();
    }
  };

  const setStatus = (p, status) => problems.patch(p.id, { status });

  const selectFromMap = (key) => {
    const p = byMapKey.get(key);
    if (!p) return;
    if (!statusTest(p.status)) setStatusFilter(STATUS_FILTERS.find((f) => f.test(p.status))?.id || 'active');
    setFocus({ id: p.id, n: Date.now() });
  };

  const copy = async (text, done) => {
    try {
      await copyText(text);
      toast(done);
    } catch {
      toast({ tone: 'error', message: 'Could not copy to the clipboard.' });
    }
  };

  const startProject = async (p) => {
    const created = await projects.add(projectFromProblem(p));
    if (!created?.id || String(created.id).startsWith('tmp-')) {
      toast({ tone: 'error', message: 'Could not create the project.' });
      return;
    }
    if (p.status === 'new' || p.status === 'saved') setStatus(p, 'exploring');
    toast(`Project "${p.title}" created`);
    navigate(`/projects/${created.id}`);
  };

  const sub = latestRun
    ? [
        `${industries.length} ${industries.length === 1 ? 'industry' : 'industries'} researched`,
        `${activeCount} problem${activeCount === 1 ? '' : 's'} on file`,
        `Last run ${timeAgo(latestRun.run_at)}`,
      ].join(' · ')
    : 'Maps an industry and finds problems you could realistically build a solution for';

  const chips = industries.length ? industries.map((i) => i.name) : INDUSTRY_PRESETS.slice(0, 5);
  const busy = running || serverRunning;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Industry Problems Agent</h1>
          <div className="page-header-sub">{sub}</div>
        </div>
        <div className="row">
          <button className="btn btn--ghost btn--icon" title="Configure what you can build" aria-label="Configure" onClick={() => setConfigOpen(true)} disabled={!config}>
            <i className="ti ti-settings" />
          </button>
        </div>
      </div>

      {config && !ready && (
        <Card static className="card-section opp-setup">
          <i className="ti ti-hammer opp-setup-icon" />
          <div style={{ flex: 1 }}>
            <div className="opp-setup-title">Tell the agent what you can build</div>
            <p className="body-text">
              Describe your skills, how long a first version can take and who you can sell to. Every problem is scored for how attainable it is for you.
            </p>
          </div>
          <button className="btn btn--accent" onClick={() => setConfigOpen(true)}>
            <i className="ti ti-settings" /> Configure
          </button>
        </Card>
      )}

      <Card static className="card-section opp-section">
        <div className="section-label">Research an industry</div>
        <div className="ind-run">
          <input
            className="input ind-run-industry"
            value={industryInput}
            maxLength={120}
            placeholder="Industry — e.g. Independent insurance agencies"
            aria-label="Industry"
            onChange={(e) => setIndustryInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
          />
          <input
            className="input ind-run-focus"
            value={focusInput}
            maxLength={300}
            placeholder="Narrow it (optional) — e.g. 1–5 person shops, not chains"
            aria-label="Focus within the industry"
            onChange={(e) => setFocusInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
          />
          <button className="btn btn--accent" onClick={run} disabled={busy || !config || !cleanIndustry(industryInput)}>
            <i className={`ti ${running ? 'ti-loader-2 opp-spin' : 'ti-player-play'}`} />
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
        <div className="chip-group ind-run-chips" aria-label={industries.length ? 'Industries you have researched' : 'Suggestions'}>
          {chips.map((c) => (
            <button type="button" key={c} className="chip" onClick={() => setIndustryInput(c)}>
              {c}
            </button>
          ))}
        </div>
      </Card>

      {busy && (
        <Card static className="card-section opp-progress">
          <div className="spread">
            <div className="row">
              <Spinner />
              <span className="opp-progress-title">
                {running ? 'Researching the industry…' : `A run is in progress${latestRun?.industry ? ` for ${latestRun.industry}` : ''}…`}
              </span>
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
            Found {result.found} problems — {result.added} new, {result.updated} updated · {result.searches} searches · {money(result.cost_usd)}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => setResult(null)}>Dismiss</button>
        </Card>
      )}

      {!selected && !busy && !runs.loading && (
        <div className="placeholder">
          <i className="ti ti-sitemap" />
          <h2>No industries researched yet</h2>
          <p>{ready ? 'Name an industry above and press Run now.' : 'Configure the agent, name an industry, then run it.'}</p>
        </div>
      )}

      {selected && (
        <>
          {industries.length > 1 && (
            <div className="ind-switch">
              <div className="segmented" role="tablist" aria-label="Researched industries">
                {industries.map((i) => (
                  <button
                    key={i.key}
                    role="tab"
                    aria-selected={i.key === selected.key}
                    className={i.key === selected.key ? 'active' : ''}
                    onClick={() => {
                      setSelKey(i.key);
                      setFocus(null);
                    }}
                  >
                    {i.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Card static className="card-section opp-section">
            <div className="spread">
              <div className="card-section-title">{selected.name}</div>
              <span className="list-row-meta">
                Researched {timeAgo(selected.run.run_at)} · {selected.run.searches} searches · {money(selected.run.cost_usd)}
              </span>
            </div>
            {selected.run.focus && <p className="list-row-meta">Focus: {selected.run.focus}</p>}
            {summary.headline && <p className="body-text ind-headline">{summary.headline}</p>}
            {summary.where_to_start && (
              <div className="ind-detail">
                <div className="ind-detail-label">
                  <i className="ti ti-flag-3" />
                  Where to start
                </div>
                <p>{summary.where_to_start}</p>
              </div>
            )}
            {summary.market_notes && (
              <div className="ind-detail">
                <div className="ind-detail-label">
                  <i className="ti ti-building-store" />
                  How buyers here behave
                </div>
                <p>{summary.market_notes}</p>
              </div>
            )}
          </Card>

          <Card static className="card-section opp-section">
            <div className="spread">
              <div className="card-section-title">Industry map</div>
              <button
                className="btn btn--ghost btn--sm"
                title="Indented Markdown — paste into markmap.js.org or any Markdown mind-map tool"
                onClick={() => copy(mapToMarkdown(selected.name, map), 'Map copied as Markdown')}
                disabled={!map.stages.length}
              >
                <i className="ti ti-copy" /> Copy as Markdown
              </button>
            </div>
            <MindMap
              industry={selected.name}
              map={map}
              linkedKeys={linkedKeys}
              activeKey={activeKey}
              onSelectProblem={selectFromMap}
            />
          </Card>

          <Card static className="card-section opp-section">
            <div className="spread">
              <div className="card-section-title">Problems worth solving</div>
              <span className="list-row-meta">{all.length} found · ranked by score</span>
            </div>
            <div className="opp-filters ind-filters">
              <div className="segmented">
                {STATUS_FILTERS.map((f) => (
                  <button key={f.id} className={statusFilter === f.id ? 'active' : ''} onClick={() => setStatusFilter(f.id)}>
                    {f.label}
                    <span className="opp-tab-count">{countFor(f)}</span>
                  </button>
                ))}
              </div>
            </div>
            {problems.loading ? (
              <div className="opp-empty">
                <Spinner />
              </div>
            ) : visible.length === 0 ? (
              <div className="opp-empty">{all.length === 0 ? 'No problems came back for this run.' : 'Nothing matches this filter.'}</div>
            ) : (
              <div className="opp-list">
                {visible.map((p) => (
                  <IndustryProblemCard
                    key={p.id}
                    problem={p}
                    focusToken={focus?.id === p.id ? focus.n : 0}
                    onStatus={setStatus}
                    onCopy={(x) => copy(problemToMarkdown(x), 'Brief copied')}
                    onStartProject={startProject}
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}

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
                    {r.industry} ·{' '}
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
        <IndustryConfigModal initial={config} onClose={() => setConfigOpen(false)} onSaved={setConfig} />
      )}
    </div>
  );
}
