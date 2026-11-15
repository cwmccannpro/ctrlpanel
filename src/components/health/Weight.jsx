import { useEffect, useState } from 'react';
import Card from '../shared/Card.jsx';
import Modal from '../shared/Modal.jsx';
import { useToast } from '../Toaster.jsx';
import { useNutritionRows } from '../../lib/useNutritionRows.js';
import { useMealTimeZone } from '../../lib/useMealTimeZone.js';
import { deleteNutritionWeight, saveNutritionWeight } from '../../lib/nutritionClient.js';
import { nutritionDay, nutritionTimestamp } from '../../lib/nutrition.js';
import { formatDate } from '../../lib/helpers.js';
import '../../styles/nutrition.css';

export default function Weight() {
  const toast = useToast();
  const timeZone = useMealTimeZone();
  const weights = useNutritionRows('weight_logs');
  const [day, setDay] = useState(() => nutritionDay(new Date(), timeZone));
  const [weight, setWeight] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDay(nutritionDay(new Date(), timeZone)); }, [timeZone]);

  const logWeight = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await saveNutritionWeight(weight, nutritionTimestamp(day, timeZone)); setWeight(''); toast('Weight saved'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await deleteNutritionWeight(deleting.id); setDeleting(null); toast('Weight deleted'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return <div className="fade-in nutrition-page">
    <Card className="card-section" static>
      <form className="nutrition-toolbar" onSubmit={logWeight}>
        <label className="sr-only" htmlFor="weight-day">Weigh-in day</label><input id="weight-day" className="input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} required />
        <label className="sr-only" htmlFor="nutrition-weight">Weight (lb)</label><input id="nutrition-weight" className="input" type="number" inputMode="decimal" min="0.1" max="2000" step="0.1" placeholder="Weight (lb)" value={weight} onChange={(e) => setWeight(e.target.value)} required />
        <button className="btn" disabled={busy || Boolean(weights.error)}>{busy ? 'Saving…' : 'Log weight'}</button>
      </form>
      {weights.error && <p className="body-text text-red" role="alert">Could not load weights: {weights.error} <button className="btn btn--sm" onClick={weights.reload}>Retry</button></p>}
      {error && !deleting && <p className="body-text text-red" role="alert">{error}</p>}
      {weights.loading ? <p className="body-text">Loading weigh-ins…</p> : !weights.error && !weights.rows.length && <p className="body-text">No weigh-ins yet. Log your first one above.</p>}
      {[...weights.rows].reverse().slice(0, 6).map((w) => <div className="list-row" key={w.id}><span className="list-row-time">{formatDate(nutritionDay(w.logged_at, timeZone))}</span><span className="list-row-title">{w.weight} lb</span><button className="btn btn--ghost btn--icon" onClick={() => { setError(''); setDeleting({ id: w.id, name: `${w.weight} lb` }); }} aria-label={`Delete weight ${w.weight} lb`}><i className="ti ti-trash" aria-hidden="true" /></button></div>)}
    </Card>
    {deleting && <Modal title="Delete weigh-in?" onClose={() => !busy && setDeleting(null)} footer={<><button className="btn btn--ghost" onClick={() => setDeleting(null)} disabled={busy}>Cancel</button><button className="btn btn--danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button></>}><p className="body-text">Delete “{deleting.name}” from your log?</p>{error && <p className="body-text text-red" role="alert">{error}</p>}</Modal>}
  </div>;
}
