import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';
import { lifeStats } from '../lib/helpers.js';

const MAX_EXPECTANCY = 120;

export default function LifeProgressPanel() {
  const navigate = useNavigate();
  const { settings } = useAuth();
  const birthdate = settings?.birthdate || localStorage.getItem('ctrlpanel-birthdate') || '';
  const expectancy = Math.min(
    MAX_EXPECTANCY,
    Math.max(1, Number(settings?.life_expectancy || localStorage.getItem('ctrlpanel-life-expectancy')) || 90)
  );
  const stats = lifeStats(birthdate, expectancy);
  if (!stats) return null;
  const pct = Math.min(100, Math.max(0, stats.pctLived));

  return (
    <div className="dash2-panel dash2-life-progress">
      <button className="dash2-life-progress-head" onClick={() => navigate('/habits')} type="button">
        <span>Life lived</span>
        <span>{pct.toFixed(1)}%</span>
      </button>
      <button
        className="dash2-life-track"
        onClick={() => navigate('/habits')}
        type="button"
        title={`${stats.ageYears} years lived of an estimated ${expectancy}`}
        aria-label={`${pct.toFixed(1)} percent of estimated life lived`}
      >
        <span className="dash2-life-fill" style={{ width: `${pct}%` }} />
      </button>
    </div>
  );
}
