// One ranked Industry Problems Agent result. Collapsed it shows the score, the
// problem and who has it; expanded it shows what to build, the first version,
// pricing, how to reach buyers, competition, risk, the score breakdown and the
// evidence. Save / Exploring / Dismiss call onStatus(problem, nextStatus).
// `focusToken` changes each time the user clicks this problem's pain on the
// mind map (0 = not targeted); it opens the card and scrolls it into view.
import { useEffect, useRef, useState } from 'react';
import Badge from './shared/Badge.jsx';
import { SCORE_PARTS, SOLUTION_LABEL, EVIDENCE_LABEL } from '../lib/industryConfig.js';
import { scoreTone } from '../lib/industryProblems.js';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Detail({ icon, label, children }) {
  if (!children) return null;
  return (
    <div className="ind-detail">
      <div className="ind-detail-label">
        <i className={`ti ${icon}`} />
        {label}
      </div>
      <p>{children}</p>
    </div>
  );
}

export default function IndustryProblemCard({ problem: p, onStatus, onCopy, onStartProject, focusToken = 0 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const saved = p.status === 'saved';
  const exploring = p.status === 'exploring';
  const dismissed = p.status === 'dismissed';
  const evidence = Array.isArray(p.evidence) ? p.evidence : [];
  const supported = p.evidence_verified > 0;

  useEffect(() => {
    if (!focusToken) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [focusToken]);

  return (
    <div ref={ref} className={`opp-row ind-card${dismissed ? ' opp-row--dim' : ''}${focusToken ? ' ind-card--active' : ''}`}>
      <div className={`opp-score opp-score--${scoreTone(p.score)}`} title="Overall score (0–100): pain, attainability, demand, reach, gap">
        {p.score}
      </div>

      <div className="opp-main">
        <button className="ind-title" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {p.title}
          <i className={`ti ti-chevron-right opp-chevron${open ? ' open' : ''}`} />
        </button>

        <div className="opp-badges">
          {p.stage && <Badge>{p.stage}</Badge>}
          {p.solution_type && <Badge>{SOLUTION_LABEL[p.solution_type] || p.solution_type}</Badge>}
          {p.build_weeks ? <Badge>~{p.build_weeks} wk</Badge> : null}
          {exploring && <Badge variant="accent">Exploring</Badge>}
          {supported ? (
            <Badge variant="green">
              {p.evidence_verified} source{p.evidence_verified === 1 ? '' : 's'}
            </Badge>
          ) : (
            <span className="opp-flag ind-flag" title="None of this problem's sources appeared in the agent's search results, so it earned no demand score.">
              <i className="ti ti-alert-triangle" /> Unverified
            </span>
          )}
        </div>

        <p className="ind-problem">{p.problem}</p>
        {p.who && (
          <div className="opp-meta">
            <span>
              <i className="ti ti-user" />
              {p.who}
            </span>
          </div>
        )}

        {open && (
          <div className="ind-body">
            <Detail icon="ti-hammer" label="What to build">{p.solution}</Detail>
            <Detail icon="ti-flag-3" label="First version">{p.mvp}</Detail>
            <Detail icon="ti-coin" label="Pricing & willingness to pay">{p.pricing}</Detail>
            <Detail icon="ti-speakerphone" label="Reaching buyers">{p.reach}</Detail>
            <Detail icon="ti-list-search" label="What exists today">{p.competition}</Detail>
            <Detail icon="ti-alert-triangle" label="Main risk">{p.risk}</Detail>

            {p.scores && (
              <div className="ind-scores" aria-label="Score breakdown">
                {SCORE_PARTS.map((s) => (
                  <div className="ind-score" key={s.id} title={s.hint}>
                    <div className="ind-score-head">
                      <span>{s.label}</span>
                      <span>
                        {p.scores[s.id] ?? 0}/{s.max}
                      </span>
                    </div>
                    <div className="ind-score-bar">
                      <span style={{ width: `${Math.min(100, ((p.scores[s.id] || 0) / s.max) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {evidence.length > 0 && (
              <div className="ind-detail">
                <div className="ind-detail-label">
                  <i className="ti ti-quote" />
                  Evidence
                </div>
                <ul className="ind-evidence">
                  {evidence.map((e, i) => (
                    <li key={i}>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.source || e.url}
                        </a>
                      ) : (
                        <span className="ind-evidence-src">{e.source || 'Source'}</span>
                      )}
                      <span className="list-row-meta"> · {EVIDENCE_LABEL[e.kind] || 'Other'}</span>
                      {e.url && !e.verified && (
                        <span className="opp-flag ind-flag" title="This link didn't appear in the agent's search results — double-check it.">
                          {' '}
                          <i className="ti ti-alert-triangle" /> check link
                        </span>
                      )}
                      <div>{e.note}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="ind-actions">
              <button className="btn btn--ghost btn--sm" onClick={() => onStartProject(p)}>
                <i className="ti ti-folder-plus" /> Start project
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => onCopy(p)}>
                <i className="ti ti-copy" /> Copy brief
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="opp-actions">
        <button
          className={`btn btn--ghost btn--icon${saved ? ' is-on' : ''}`}
          title={saved ? 'Unsave' : 'Save'}
          aria-pressed={saved}
          onClick={() => onStatus(p, saved ? 'new' : 'saved')}
        >
          <i className="ti ti-bookmark" />
        </button>
        <button
          className={`btn btn--ghost btn--icon${exploring ? ' is-on' : ''}`}
          title={exploring ? 'Stop exploring' : "I'm exploring this"}
          aria-pressed={exploring}
          onClick={() => onStatus(p, exploring ? 'saved' : 'exploring')}
        >
          <i className="ti ti-compass" />
        </button>
        <button
          className="btn btn--ghost btn--icon"
          title={dismissed ? 'Restore' : 'Dismiss'}
          onClick={() => onStatus(p, dismissed ? 'new' : 'dismissed')}
        >
          <i className={`ti ${dismissed ? 'ti-arrow-back-up' : 'ti-x'}`} />
        </button>
      </div>
    </div>
  );
}
