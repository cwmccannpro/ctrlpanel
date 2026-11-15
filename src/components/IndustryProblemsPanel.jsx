import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useRows } from '../lib/useData.js';

export default function IndustryProblemsPanel({ cfg = {}, onCfg = () => {} }) {
  const { rows, loading, usingMock, reload } = useRows('industry_problems', [], 'last_seen_at');
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  const industries = [...new Map(rows.map((row) => [row.industry_key, row.industry])).entries()]
    .filter(([key]) => key).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const selected = industries.some(([key]) => key === cfg.industryKey) ? cfg.industryKey : '';
  const active = rows.filter((row) => ['new', 'saved', 'exploring'].includes(row.status) && (!selected || row.industry_key === selected))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.last_seen_at).localeCompare(String(a.last_seen_at)));

  return <>
    <div className="dash2-panel-head dash2-panel-head--wrap">
      <Link className="dash2-panel-title dash2-link" to="/agents/industry-problems">Industry Problems</Link>
      <button className="btn btn--sm btn--ghost btn--icon" onClick={reload} disabled={loading} aria-label="Refresh industry problems"><i className="ti ti-refresh" aria-hidden="true" /></button>
    </div>
    {industries.length > 1 && <label className="dash2-panel-setting">Industry
      <select className="dash2-select" value={selected} onChange={(event) => onCfg({ industryKey: event.target.value })}>
        <option value="">All industries</option>{industries.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </label>}
    {loading ? <p className="dash2-panel-note" role="status">Loading ideas…</p>
      : usingMock ? <p className="dash2-panel-note" role="alert">Industry Problems couldn’t load. Open the agent to check its setup.</p>
        : active.length === 0 ? <p className="dash2-panel-note">No active ideas yet. Research an industry to find problems you could solve.</p>
          : <>
            <p className="dash2-panel-note">{active.length} active · {active.filter((row) => row.status === 'exploring').length} exploring</p>
            {active.slice(0, 4).map((problem) => <Link key={problem.id} className="list-row dash2-idea-row" to="/agents/industry-problems">
              <span className="dash2-idea-score" aria-label={`Score ${problem.score} out of 100`}>{problem.score}</span>
              <span className="list-row-title">{problem.title}<small>{problem.industry} · {problem.status}</small></span>
            </Link>)}
          </>}
    <div className="dash2-panel-actions"><Link className="btn btn--sm" to="/agents/industry-problems">Open agent</Link></div>
  </>;
}
