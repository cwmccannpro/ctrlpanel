import { nutrientProgress } from '../lib/nutrition.js';

const RINGS = [
  { key: 'calories', label: 'CAL', name: 'Calories', unit: '', color: 'var(--accent)' },
  { key: 'protein', label: 'PRO', name: 'Protein', unit: 'g', color: 'var(--blue)' },
  { key: 'carbs', label: 'CAR', name: 'Carbs', unit: 'g', color: 'var(--amber)' },
  { key: 'fat', label: 'FAT', name: 'Fat', unit: 'g', color: 'var(--green)' },
];
const R = 18;
const C = 2 * Math.PI * R;
const whole = (n) => Math.round(n).toLocaleString();

/** Today's macros as four rings to close. A target of 0 turns that ring's goal off. */
export default function DriveMacroRings({ totals, goals, loading, error }) {
  const ready = !loading && !error;
  return (
    <div className="drive-macros" role="group" aria-label="Today's macros">
      {RINGS.map((ring) => {
        const amount = ready ? totals?.[ring.key] : null;
        const target = goals?.[ring.key];
        const p = nutrientProgress(amount, target);
        const label = `${ring.name}: ${p.known ? `${whole(amount)}${ring.unit}` : 'unknown'}${p.hasTarget ? ` of ${whole(target)}${ring.unit}` : ''}`;
        return (
          <div key={ring.key} className={`drive-ring ${p.percent >= 100 ? 'is-closed' : ''}`} style={{ '--ring': ring.color }}>
            <div className="drive-ring-dial">
              <svg viewBox="0 0 44 44" role="img" aria-label={label}>
                <circle className="drive-ring-track" cx="22" cy="22" r={R} />
                {p.hasTarget && <circle className="drive-ring-fill" cx="22" cy="22" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - p.width / 100)} transform="rotate(-90 22 22)" />}
              </svg>
              <strong aria-hidden="true">{p.known ? whole(amount) : '—'}</strong>
            </div>
            <span className="drive-ring-label">{ring.label}</span>
            <small>{p.hasTarget ? `/ ${whole(target)}${ring.unit}` : 'no goal'}</small>
          </div>
        );
      })}
    </div>
  );
}
