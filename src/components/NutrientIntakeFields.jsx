import { MICRO_NUTRIENTS } from '../lib/nutrition.js';

export default function NutrientIntakeFields({ values = {}, onChange, disabled }) {
  return <details className="nutrition-intake-fields">
    <summary>Micronutrient amounts <span>· {Object.values(values).filter((value) => value != null && value !== '').length} reported</span></summary>
    <p className="list-row-meta">Amounts for the whole meal. Correct estimates using the nutrition label. Leave unknown values blank; enter 0 only when known. Vitamin A uses RAE, folate DFE, and niacin NE.</p>
    <div className="grid grid-2">{MICRO_NUTRIENTS.map(({ key, label, unit, max }) => <div className="field" key={key}>
      <label className="field-label" htmlFor={`meal-micro-${key}`}>{label} ({unit})</label>
      <input id={`meal-micro-${key}`} className="input" type="number" inputMode="decimal" min="0" max={max} step="0.01" placeholder="Unknown" value={values[key] ?? ''} disabled={disabled} onChange={(event) => onChange({ ...values, [key]: event.target.value })} />
    </div>)}</div>
  </details>;
}
