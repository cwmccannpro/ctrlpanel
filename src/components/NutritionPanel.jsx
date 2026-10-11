import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';
import { useNutritionRows } from '../lib/useNutritionRows.js';
import { NUTRIENTS, nutritionDay, nutritionDayRange, nutritionGoals, nutritionTimeZone, nutritionTotals } from '../lib/nutrition.js';

export default function NutritionPanel({ cfg = {}, onCfg = () => {} }) {
  const { settings } = useAuth();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { timeZone = nutritionTimeZone(settings?.ui_preferences?.nutrition?.timeZone || timeZone); }
  catch { /* Fall back to the device timezone for an invalid saved preference. */ }
  const range = nutritionDayRange(now, timeZone);
  const meals = useNutritionRows('nutrition_logs', '*', 'logged_at', range);
  const goals = useNutritionRows('user_goals', '*', 'updated_at');
  const day = nutritionDay(now, timeZone);
  const today = meals.rows.filter((meal) => nutritionDay(meal.logged_at, timeZone) === day)
    .sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at)));
  const totals = nutritionTotals(today);
  const targets = goals.error ? null : nutritionGoals(goals.rows.at(-1));
  const showMeals = cfg.showMeals !== false;
  const display = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });

  return <>
    <div className="dash2-panel-head dash2-panel-head--wrap">
      <Link className="dash2-panel-title dash2-link" to="/health/nutrition">Nutrition today</Link>
      <span className="dash2-count">{today.length} {today.length === 1 ? 'meal' : 'meals'}</span>
    </div>
    {meals.loading ? <p className="dash2-panel-note" role="status">Loading meals…</p>
      : meals.error ? <div role="alert"><p className="dash2-panel-note">Couldn’t load your meal log.</p><button className="btn btn--sm" onClick={meals.reload}>Retry</button></div>
        : <>
          <div className="dash2-nutrition-stats">
            {NUTRIENTS.map(({ key, label, unit }) => {
              const goal = targets?.[key];
              const progress = goal > 0 ? Math.min(100, totals[key] / goal * 100) : 0;
              return <div key={key}>
                <div className="dash2-nutrition-label">{label}</div>
                <div className="dash2-nutrition-value">{display(totals[key])}<span> {unit}</span></div>
                <div className="dash2-nutrition-track" role={goal > 0 ? 'progressbar' : undefined}
                  aria-label={`${label} daily goal`} aria-valuemin={goal > 0 ? 0 : undefined}
                  aria-valuemax={goal > 0 ? goal : undefined} aria-valuenow={goal > 0 ? Math.min(totals[key], goal) : undefined}
                  aria-valuetext={goal > 0 ? `${display(totals[key])} of ${display(goal)} ${unit}` : undefined}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <span className="dash2-panel-note">{goals.loading ? 'Loading goal…' : goal > 0 ? `of ${display(goal)} ${unit}` : 'No goal set'}</span>
              </div>;
            })}
          </div>
          {goals.error && <p className="dash2-panel-note" role="alert">Goals couldn’t load. <button className="dash2-inline-action" onClick={goals.reload}>Retry</button></p>}
          {today.length === 0 ? <p className="dash2-panel-note">No meals today. Take a photo or describe what you ate.</p>
            : showMeals && <div className="dash2-nutrition-meals">
              {today.slice(0, 3).map((meal) => <Link key={meal.id} className="list-row" to="/health/nutrition">
                <span className="list-row-title">{meal.meal_name}</span>
                <span className="list-row-meta">{display(meal.calories)} kcal</span>
              </Link>)}
            </div>}
        </>}
    <div className="dash2-panel-actions">
      <Link className="btn btn--sm btn--accent" to="/health/nutrition?log=photo"><i className="ti ti-camera" aria-hidden="true" /> Log by photo</Link>
      <Link className="btn btn--sm" to="/health/nutrition?log=text"><i className="ti ti-message" aria-hidden="true" /> Describe meal</Link>
    </div>
    <label className="dash2-panel-setting">Display
      <select className="dash2-select" value={showMeals ? 'meals' : 'summary'} onChange={(event) => onCfg({ showMeals: event.target.value === 'meals' })}>
        <option value="meals">Summary + meals</option><option value="summary">Summary only</option>
      </select>
    </label>
  </>;
}
