import { useState } from 'react';
import NutrientProgress from './NutrientProgress.jsx';
import NutrientTargetEditor from './NutrientTargetEditor.jsx';
import { NUTRIENTS, MICRO_NUTRIENTS, nutritionTotals, nutritionGoals, micronutrientTotals, micronutrientGoals } from '../lib/nutrition.js';
import '../styles/nutrition.css';

export default function NutritionOverview({ meals = [], goalRow, detailed = true, compact = false, loading, error, goalsLoading, goalsError, retryGoals }) {
  const [editing, setEditing] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [group, setGroup] = useState('All');
  const totals = nutritionTotals(meals);
  const micros = micronutrientTotals(meals);
  const targets = { ...nutritionGoals(goalRow), ...micronutrientGoals(goalRow) };
  const available = !loading && !error;
  const editable = !goalsLoading && !goalsError;
  const fields = (showAll ? MICRO_NUTRIENTS : MICRO_NUTRIENTS.slice(0, 10)).filter((field) => group === 'All' || field.group === group);
  const reported = MICRO_NUTRIENTS.filter(({ key }) => micros[key].amount != null).length;
  const render = (nutrient, micro = false) => <NutrientProgress key={nutrient.key} nutrient={nutrient}
    amount={available ? micro ? micros[nutrient.key].amount : totals[nutrient.key] : null}
    target={editable ? targets[nutrient.key] : null} compact={compact} disabled={!editable}
    reported={micro ? micros[nutrient.key].reported : undefined} meals={meals.length} onEdit={setEditing} />;

  return <div className={`nutrition-overview${compact ? ' nutrition-overview--compact' : ''}`}>
    <div className="nutrition-macro-grid">{NUTRIENTS.map((field) => render(field))}</div>
    {goalsLoading && <p className="list-row-meta" role="status">Loading saved targets…</p>}
    {goalsError && <p className="body-text text-red" role="alert">Targets couldn’t load. {retryGoals && <button className="btn btn--sm" onClick={retryGoals}>Retry</button>}</p>}
    {detailed && <section className="nutrition-micros" aria-label="Micronutrient progress">
      <div className="nutrition-micros-head"><div><h3>Micronutrients & daily limits</h3><span className="list-row-meta">{available ? `${reported}/${MICRO_NUTRIENTS.length} nutrients reported` : 'Waiting for intake data'} · From logged meals</span></div>
        <button className="btn btn--ghost btn--sm" onClick={() => { setShowAll(!showAll); setGroup('All'); }} aria-expanded={showAll}>{showAll ? 'Show essentials' : `All ${MICRO_NUTRIENTS.length} nutrients`}<i className={`ti ${showAll ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" /></button>
      </div>
      {showAll && <div className="segmented nutrition-micro-filter" aria-label="Nutrient group">{['All', 'Vitamins', 'Minerals', 'Other'].map((name) => <button key={name} className={group === name ? 'active' : ''} aria-pressed={group === name} onClick={() => setGroup(name)}>{name}</button>)}</div>}
      <div className="nutrition-micro-grid">{fields.map((field) => render(field, true))}</div>
      <p className="nutrition-reference">Click any nutrient to edit its target. Starting micro targets use <a href="https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels" target="_blank" rel="noreferrer">FDA Daily Values</a>; adjust for your needs. A dash means unreported. Partial totals cover only meals with that nutrient.</p>
    </section>}
    {editing && <NutrientTargetEditor nutrient={editing} target={targets[editing.key]} onClose={() => setEditing(null)} />}
  </div>;
}
