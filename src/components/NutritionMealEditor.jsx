import { useEffect, useRef, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { prepareMealPhoto } from '../lib/mealPhoto.js';
import { analyzeMealDescription, analyzeMealPhoto, saveNutritionMeal } from '../lib/nutritionClient.js';
import { NUTRIENTS, nutritionDay, nutritionTimestamp } from '../lib/nutrition.js';

export default function NutritionMealEditor({ meal, photoMode = false, date, timeZone, onClose, onSaved }) {
  const [mode, setMode] = useState(photoMode ? 'photo' : 'text');
  const [description, setDescription] = useState(meal?.meal_name || '');
  const [context, setContext] = useState('');
  const [mealDate, setMealDate] = useState(meal ? nutritionDay(meal.logged_at, timeZone) : date);
  const [photo, setPhoto] = useState(null);
  const [estimate, setEstimate] = useState(meal || null);
  const [cost, setCost] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const camera = useRef(null);
  const gallery = useRef(null);
  const active = useRef(true);
  const saving = useRef(false);
  const entryId = useRef(crypto.randomUUID());
  const savedTime = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const close = () => { if (!saving.current) onClose(); };
  const invalidate = () => { setEstimate(null); setCost(null); setError(''); };
  const switchMode = (next) => { if (!busy && next !== mode) { setMode(next); invalidate(); } };
  const choose = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    invalidate(); setBusy('photo'); setPhoto(null);
    try { const result = await prepareMealPhoto(file); if (active.current) setPhoto(result); }
    catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setBusy(''); }
  };
  const analyze = async () => {
    if (busy || (mode === 'photo' ? !photo : !description.trim())) return;
    setBusy('analyze'); setError('');
    try {
      const result = await (mode === 'photo' ? analyzeMealPhoto(photo, context) : analyzeMealDescription(description));
      if (!active.current) return;
      setEstimate(result.estimate);
      setCost(result.usage?.estimated_cost_usd ?? null);
    } catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setBusy(''); }
  };
  const save = async () => {
    if (saving.current || busy || !estimate) return;
    saving.current = true; setBusy('save'); setError('');
    try {
      if (!savedTime.current || savedTime.current.day !== mealDate) {
        const timestamp = meal && mealDate === nutritionDay(meal.logged_at, timeZone) ? meal.logged_at :
          mealDate === nutritionDay(new Date(), timeZone) ? new Date().toISOString() : nutritionTimestamp(mealDate, timeZone);
        savedTime.current = { day: mealDate, timestamp };
      }
      const draft = { ...estimate, id: meal?.id,
        notes: [estimate.notes, ...(estimate.assumptions || [])].filter(Boolean).join('\n').slice(0, 3000) };
      const row = await saveNutritionMeal(draft, { id: entryId.current, timestamp: savedTime.current.timestamp });
      onSaved(row);
    } catch (e) { if (active.current) setError(e.message); }
    finally { saving.current = false; if (active.current) setBusy(''); }
  };
  const canAnalyze = mode === 'photo' ? Boolean(photo) : Boolean(description.trim());

  return <Modal className="nutrition-meal-modal" title={meal ? 'Edit meal' : 'Log a meal'} onClose={close}
    footer={<>{error && <p className="body-text text-red nutrition-meal-error" role="alert">{error}</p>}
      <button className="btn btn--ghost" onClick={close} disabled={busy === 'save'}>Cancel</button>
      <button className="btn btn--accent" onClick={estimate ? save : analyze} disabled={Boolean(busy) || (!estimate && !canAnalyze)}>
        {busy === 'save' ? 'Saving…' : busy === 'analyze' ? 'Estimating…' : busy === 'photo' ? 'Preparing photo…' : estimate ? 'Save meal' : 'Estimate meal'}
      </button></>}>
    <div className="nutrition-meal-editor">
      <div className="segmented nutrition-log-method" aria-label="Meal logging method">
        <button type="button" className={mode === 'photo' ? 'active' : ''} aria-pressed={mode === 'photo'} onClick={() => switchMode('photo')} disabled={Boolean(busy)}><i className="ti ti-camera" aria-hidden="true" /> By photo</button>
        <button type="button" className={mode === 'text' ? 'active' : ''} aria-pressed={mode === 'text'} onClick={() => switchMode('text')} disabled={Boolean(busy)}><i className="ti ti-message" aria-hidden="true" /> Describe meal</button>
      </div>
      {mode === 'photo' ? <>
        {photo ? <img className="nutrition-photo-preview" src={photo.dataUrl} alt="Meal photo selected for analysis" /> :
          <div className="nutrition-photo-empty"><i className="ti ti-camera" aria-hidden="true" /><strong>Take a photo of your meal</strong><p className="body-text">We’ll estimate the calories and macros for you.</p></div>}
        <div className="nutrition-actions">
          <button className="btn" onClick={() => camera.current?.click()} disabled={Boolean(busy)}><i className="ti ti-camera" aria-hidden="true" /> Take photo</button>
          <button className="btn" onClick={() => gallery.current?.click()} disabled={Boolean(busy)}><i className="ti ti-photo" aria-hidden="true" /> Choose photo</button>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={choose} />
          <input ref={gallery} type="file" accept="image/*" hidden onChange={choose} />
        </div>
        <div className="field"><label className="field-label" htmlFor="meal-photo-context">Anything to add? (optional)</label><textarea id="meal-photo-context" className="input" rows={2} value={context} maxLength={2000} onChange={(e) => { setContext(e.target.value); invalidate(); }} placeholder="e.g. I ate half, plus a medium iced coffee" disabled={Boolean(busy)} /></div>
      </> : <div className="field">
        <label className="field-label" htmlFor="meal-description">What did you eat?</label>
        <textarea id="meal-description" className="input" rows={3} value={description} maxLength={2000} onChange={(e) => { setDescription(e.target.value); invalidate(); }} placeholder="Dunkin bacon, egg and cheese on a croissant" autoFocus={!photoMode} disabled={Boolean(busy)} />
        <p className="list-row-meta">Just the meal, restaurant and size if you know it. We’ll handle the nutrition numbers.</p>
      </div>}
      {busy === 'analyze' && <p className="body-text" role="status">Estimating your meal. This may take up to a minute.</p>}
      {estimate && <section className="nutrition-meal-estimate" aria-label="Meal estimate" aria-live="polite">
        <span className="field-label">{estimate.confidence ? 'Estimated nutrition' : 'Saved nutrition'}</span>
        <strong>{estimate.meal_name}</strong>
        <div className="nutrition-estimate-macros">{NUTRIENTS.map(({ key, label, unit }) => <div key={key}><span>{label}</span><strong>{Math.round(estimate[key])}<small> {unit}</small></strong></div>)}</div>
        {estimate.assumptions?.length > 0 && <p className="list-row-meta">{estimate.assumptions.join(' ')}</p>}
        {estimate.confidence === 'low' && <p className="list-row-meta">Some ingredients or portions are unclear. Add a detail above to improve the estimate.</p>}
        <p className="list-row-meta">Need a correction? Change the description or photo details, then estimate again.</p>
        {cost !== null && <p className="nutrition-analysis-cost">Estimated analysis cost: {(cost * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢ USD</p>}
      </section>}
      <details className="nutrition-meal-date"><summary>Meal date · {mealDate === nutritionDay(new Date(), timeZone) ? 'Today' : mealDate}</summary>
        <label className="field-label" htmlFor="meal-date">Date · {timeZone}</label><input id="meal-date" className="input" type="date" value={mealDate} onChange={(e) => e.target.value && setMealDate(e.target.value)} disabled={Boolean(busy)} />
      </details>
    </div>
  </Modal>;
}
