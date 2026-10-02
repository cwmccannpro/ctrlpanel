// One ranked Opportunities Agent result. `featured` renders the larger
// Top-picks card. Save / Applied / Dismiss call onStatus(item, nextStatus).
import Badge from './shared/Badge.jsx';
import { KIND_BADGE } from '../lib/opportunityConfig.js';

const MODE_LABEL = { remote: 'Remote', in_person: 'In person', hybrid: 'Hybrid' };
const tone = (score) => (score >= 80 ? 'top' : score >= 65 ? 'good' : 'ok');

// Date-only columns ("2026-10-02") — pin to midday so the local date never shifts.
function day(d) {
  const date = new Date(`${d}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const opts = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

function whenLabel(item) {
  if (item.deadline) return `Apply by ${day(item.deadline)}`;
  if (item.starts_on) return item.kind === 'event' ? day(item.starts_on) : `Starts ${day(item.starts_on)}`;
  return null;
}

export default function OpportunityRow({ item, onStatus, featured = false }) {
  const saved = item.status === 'saved';
  const applied = item.status === 'applied';
  const dismissed = item.status === 'dismissed';
  const when = whenLabel(item);

  return (
    <div className={`opp-row${featured ? ' opp-row--featured' : ''}${dismissed ? ' opp-row--dim' : ''}`}>
      <div className={`opp-score opp-score--${tone(item.score)}`} title="Fit score (0–100)">
        {item.score}
      </div>

      <div className="opp-main">
        {item.url ? (
          <a className="opp-title" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
            <i className="ti ti-external-link" />
          </a>
        ) : (
          <span className="opp-title">{item.title}</span>
        )}

        <div className="opp-badges">
          <Badge>{KIND_BADGE[item.kind] || item.kind}</Badge>
          {item.mode && <Badge>{MODE_LABEL[item.mode]}</Badge>}
          {item.is_free ? <Badge variant="green">Free</Badge> : item.cost ? <Badge>{item.cost}</Badge> : null}
          {item.industry && <Badge>{item.industry}</Badge>}
          {applied && <Badge variant="accent">Applied</Badge>}
        </div>

        <div className="opp-meta">
          {item.org && (
            <span>
              <i className="ti ti-building" />
              {item.org}
            </span>
          )}
          {item.location && (
            <span>
              <i className="ti ti-map-pin" />
              {item.location}
            </span>
          )}
          {when && (
            <span>
              <i className="ti ti-calendar" />
              {when}
            </span>
          )}
          {item.url && !item.source_verified && (
            <span className="opp-flag" title="This link didn't appear in the agent's search results — double-check it.">
              <i className="ti ti-alert-triangle" />
              Check link
            </span>
          )}
        </div>

        {item.reasons?.length > 0 && (
          <ul className="opp-reasons">
            {item.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="opp-actions">
        <button
          className={`btn btn--ghost btn--icon${saved ? ' is-on' : ''}`}
          title={saved ? 'Unsave' : 'Save'}
          aria-pressed={saved}
          onClick={() => onStatus(item, saved ? 'new' : 'saved')}
        >
          <i className="ti ti-bookmark" />
        </button>
        <button
          className={`btn btn--ghost btn--icon${applied ? ' is-on' : ''}`}
          title={applied ? 'Mark not applied' : 'Mark applied / registered'}
          aria-pressed={applied}
          onClick={() => onStatus(item, applied ? 'saved' : 'applied')}
        >
          <i className="ti ti-circle-check" />
        </button>
        <button
          className="btn btn--ghost btn--icon"
          title={dismissed ? 'Restore' : 'Dismiss'}
          onClick={() => onStatus(item, dismissed ? 'new' : 'dismissed')}
        >
          <i className={`ti ${dismissed ? 'ti-arrow-back-up' : 'ti-x'}`} />
        </button>
      </div>
    </div>
  );
}
