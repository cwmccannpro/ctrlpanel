import { useEffect, useRef, useState } from 'react';
import { NUTRIENTS, nutritionGoals } from '../lib/nutrition.js';
import { saveNutritionGoals } from '../lib/nutritionClient.js';
import { useToast } from './Toaster.jsx';

export default function NutritionGoalEditor({ row, loading, error: loadError }) {
  const [draft, setDraft] = useState(() => nutritionGoals(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const toast = useToast();
  useEffect(() => { if (!dirty.current) setDraft(nutritionGoals(row)); }, [row]);
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await saveNutritionGoals(row?.id, draft); dirty.current = false; toast('Daily nutrition goals saved'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <form className="nutrition-goals" onSubmit={save}>
    <div className="grid grid-2">{NUTRIENTS.map(({ key, label, unit, max }) => <div className="field" key={key}>
      <label className="field-label" htmlFor={`nutrition-goal-${key}`}>{label} ({unit})</label>
      <input id={`nutrition-goal-${key}`} className="input" type="number" inputMode="decimal" min="0" max={max} step="0.01" value={draft[key]} required disabled={busy || loading || Boolean(loadError)} onChange={(e) => { dirty.current = true; setDraft((prev) => ({ ...prev, [key]: e.target.value })); }} />
    </div>)}</div>
    <button className="btn" disabled={busy || loading || Boolean(loadError)}>{busy ? 'Saving…' : 'Save goals'}</button>
    {(error || loadError) && <p className="body-text text-red" role="alert">{error || loadError}</p>}
  </form>;
}
