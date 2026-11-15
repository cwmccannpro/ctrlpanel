import { useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './shared/Modal.jsx';
import { saveNutritionTarget } from '../lib/nutritionClient.js';
import { useToast } from './Toaster.jsx';

export default function NutrientTargetEditor({ nutrient, target, onClose }) {
  const [value, setValue] = useState(target ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await saveNutritionTarget(nutrient.key, value); toast(`${nutrient.label} target saved`); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return createPortal(<Modal title={`${nutrient.label} daily ${nutrient.limit ? 'limit' : 'target'}`} onClose={() => !busy && onClose()}
    footer={<><button className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn--accent" type="submit" form="nutrient-target-form" disabled={busy}>{busy ? 'Saving…' : 'Save target'}</button></>}>
    <form id="nutrient-target-form" onSubmit={save} className="nutrition-goals">
      <label className="field-label" htmlFor="nutrient-target">Daily amount ({nutrient.unit})</label>
      <input id="nutrient-target" className="input" type="number" inputMode="decimal" min="0" max={nutrient.max} step="0.01" required autoFocus value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} />
      <p className="list-row-meta">Applies to every day and both nutrition dashboard panels. Set 0 to turn this target off.</p>
      {nutrient.target && <p className="list-row-meta">FDA label reference: {nutrient.target} {nutrient.unit}. Adjust for your own needs.</p>}
      {nutrient.limit && <p className="list-row-meta">This is a daily limit. The bar shows how much of it you’ve used.</p>}
      {error && <p className="body-text text-red" role="alert">{error}</p>}
    </form>
  </Modal>, document.body);
}
