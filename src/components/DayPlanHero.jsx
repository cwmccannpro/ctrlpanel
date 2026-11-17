import { durationLabel, tintFor } from '../lib/taskBlocks.js';
import '../styles/dayplan.css';

const clock = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const span = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
};

/**
 * The Day Plan's Now / Next card. `plan` comes from upNext() (lib/upNext.js);
 * `free` is the day's free minutes, shown when nothing else is scheduled.
 * Used by the dashboard Day Plan panel and the Drive dashboard, so both read the same.
 */
export default function DayPlanHero({ plan, now = new Date(), isToday = true, free = 0, hint = 'drag a task here to plan it', className = '' }) {
  const { current, hero, progress } = plan;
  return (
    <div className={`dp-hero ${className}`} style={hero ? { '--event-color': hero.kind === 'task' ? tintFor(hero.priority) : hero.color || 'var(--accent)' } : undefined}>
      {hero ? (
        <>
          <span className="dp-hero-label">{current ? 'Now' : 'Next'}</span>
          <strong>{hero.title}</strong>
          <span className="dp-hero-meta">
            {current
              ? `until ${clock(hero.ends_at)} · ${span(Date.parse(hero.ends_at) - +now)} left`
              : isToday
                ? `${clock(hero.starts_at)} · in ${span(Date.parse(hero.starts_at) - +now)}`
                : `${clock(hero.starts_at)}${hero.ends_at ? ` – ${clock(hero.ends_at)}` : ''}`}
            {hero.kind === 'task' ? ' · task' : hero.calendar ? ` · ${hero.calendar}` : ''}
          </span>
          {current && <div className="dp-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress * 100}%` }} /></div>}
        </>
      ) : (
        <>
          <span className="dp-hero-label">{isToday ? 'Clear' : 'Open day'}</span>
          <strong>{isToday ? 'Nothing else on the calendar' : 'Nothing scheduled'}</strong>
          <span className="dp-hero-meta">{durationLabel(Math.max(0, free))} free{hint ? ` · ${hint}` : ''}</span>
        </>
      )}
    </div>
  );
}
