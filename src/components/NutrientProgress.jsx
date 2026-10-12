import { formatNutrient, nutrientProgress } from '../lib/nutrition.js';

export default function NutrientProgress({ nutrient, amount, target, reported, meals, onEdit, disabled, compact = false }) {
  const { known, hasTarget, percent, width } = nutrientProgress(amount, target);
  const partial = reported > 0 && reported < meals;
  const over = nutrient.limit && percent > 100;
  return <button type="button" className={`nutrient-box${compact ? ' nutrient-box--compact' : ''}${over ? ' nutrient-box--over' : ''}${!known ? ' nutrient-box--unknown' : ''}`}
    onClick={() => onEdit(nutrient)} disabled={disabled} aria-label={`Edit ${nutrient.label} daily ${nutrient.limit ? 'limit' : 'target'}. ${known ? `${formatNutrient(amount)} ${nutrient.unit} logged` : 'No intake data'}. ${hasTarget ? `${formatNutrient(target)} ${nutrient.unit} ${nutrient.limit ? 'limit' : 'target'}` : 'Target off'}`}>
    <span className="nutrient-track" role={known && hasTarget ? 'progressbar' : undefined} aria-label={`${nutrient.label} ${nutrient.limit ? 'limit' : 'progress'}`}
      aria-valuemin={known && hasTarget ? 0 : undefined} aria-valuemax={known && hasTarget ? target : undefined} aria-valuenow={known && hasTarget ? Math.min(amount, target) : undefined}
      aria-valuetext={known && hasTarget ? `${formatNutrient(amount)} of ${formatNutrient(target)} ${nutrient.unit}${partial ? ', partial meal data' : ''}` : undefined}><span style={{ width: `${width}%` }} /></span>
    <span className="nutrient-box-head"><span>{nutrient.label}</span><i className="ti ti-pencil" aria-hidden="true" /></span>
    <span className="nutrient-box-value">{formatNutrient(amount)}<small> {nutrient.unit}</small></span>
    <span className="nutrient-box-target">{hasTarget ? `${nutrient.limit ? 'limit' : 'of'} ${formatNutrient(target)} ${nutrient.unit}` : 'Target off'}</span>
    <span className="nutrient-box-status">{!known ? 'No intake data' : partial ? `${reported}/${meals} meals${percent == null ? '' : ` · ${Math.round(percent)}% logged`}` : percent == null ? 'Edit target' : `${Math.round(percent)}%${over ? ' · over limit' : nutrient.limit ? ' of limit' : ' of target'}`}</span>
  </button>;
}
