import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import NutritionMealEditor from '../../components/NutritionMealEditor.jsx';
import NutritionGoalEditor from '../../components/NutritionGoalEditor.jsx';
import { useAuth } from '../../components/AuthProvider.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useNutritionRows } from '../../lib/useNutritionRows.js';
import { deleteNutritionMeal, deleteNutritionWeight, saveNutritionWeight } from '../../lib/nutritionClient.js';
import { NUTRIENTS, nutritionDay, nutritionTimeZone, nutritionTimestamp, nutritionTotals } from '../../lib/nutrition.js';
import { formatDate } from '../../lib/helpers.js';
import '../../styles/nutrition.css';

export default function Nutrition() {
  const { settings } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const meals = useNutritionRows('nutrition_logs');
  const weights = useNutritionRows('weight_logs');
  const goals = useNutritionRows('user_goals', '*', 'updated_at');
  let timeZone;
  try { timeZone = nutritionTimeZone(settings?.ui_preferences?.nutrition?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone); }
  catch { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; }
  const [date, setDate] = useState(() => nutritionDay(new Date(), timeZone));
  const [weight, setWeight] = useState('');
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDate(nutritionDay(new Date(), timeZone)); }, [timeZone]);
  useEffect(() => {
    if (params.get('photo') === '1' || ['photo', 'text'].includes(params.get('log'))) {
      setEditor({ photo: params.get('photo') === '1' || params.get('log') === 'photo' });
      const next = new URLSearchParams(params); next.delete('photo'); next.delete('log'); setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const todaysMeals = meals.rows.filter((m) => nutritionDay(m.logged_at, timeZone) === date);
  const totals = nutritionTotals(todaysMeals);
  const byDay = {};
  meals.rows.forEach((m) => {
    const day = nutritionDay(m.logged_at, timeZone);
    if (!day) return;
    const group = byDay[day] || { date: day, calories: 0, protein: 0 };
    group.calories += Number(m.calories) || 0;
    group.protein += Number(m.protein) || 0;
    byDay[day] = group;
  });
  weights.rows.forEach((w) => {
    const day = nutritionDay(w.logged_at, timeZone);
    if (day) byDay[day] = { ...(byDay[day] || { date: day }), weight: Number(w.weight) };
  });
  const history = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  const reload = () => { meals.reload(); weights.reload(); goals.reload(); };
  const logWeight = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await saveNutritionWeight(weight, nutritionTimestamp(date, timeZone)); setWeight(''); toast('Weight saved'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await (deleting.type === 'meal' ? deleteNutritionMeal(deleting.id) : deleteNutritionWeight(deleting.id));
      setDeleting(null); toast('Log entry deleted');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return <div className="fade-in nutrition-page">
    <div className="page-header" style={{ marginBottom: 0 }}>
      <h1 className="sr-only">Nutrition</h1>
      <div className="nutrition-toolbar">
        <label className="sr-only" htmlFor="nutrition-day">Meal day</label><input id="nutrition-day" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn btn--accent" onClick={() => setEditor({ photo: true })}><i className="ti ti-camera" aria-hidden="true" /> Log meal by photo</button>
        <button className="btn" onClick={() => setEditor({ photo: false })}><i className="ti ti-message" aria-hidden="true" /> Describe a meal</button>
        <button className="btn btn--ghost btn--icon" onClick={reload} aria-label="Refresh nutrition log"><i className="ti ti-refresh" aria-hidden="true" /></button>
        <Link className="btn btn--ghost btn--icon" to="/settings#nutrition" aria-label="Nutrition settings"><i className="ti ti-settings" aria-hidden="true" /></Link>
      </div>
    </div>
    <p className="list-row-meta">{timeZone} · GPT uploads refresh here automatically. <Link to="/settings#nutrition">Connect your GPT</Link></p>
    {meals.error && <p className="body-text text-red" role="alert">Could not load meals: {meals.error} <button className="btn btn--sm" onClick={meals.reload}>Retry</button></p>}
    <div className="nutrition-summary">{NUTRIENTS.map(({ key, label, unit }) => <div key={key}><span>{label}</span><strong>{meals.loading || meals.error ? '—' : Math.round(totals[key])}<small> {unit}</small></strong></div>)}</div>
    <div className="grid grid-2">
      <Card className="card-section" static>
        <div className="card-section-title">Meals</div>
        {meals.loading ? <p className="body-text">Loading meals…</p> : !meals.error && !todaysMeals.length && <div className="nutrition-empty"><i className="ti ti-tools-kitchen-2" aria-hidden="true" /><p className="body-text">No meals for this day. Take a photo or describe what you ate. Calories and macros are estimated for you.</p></div>}
        {todaysMeals.map((m) => <div className="nutrition-meal-row" key={m.id}>
          <div><strong>{m.meal_name || 'Meal'}</strong><p className="list-row-meta">{Math.round(m.calories || 0)} kcal · {Math.round(m.protein || 0)} g protein · {Math.round(m.carbs || 0)} g carbs · {Math.round(m.fat || 0)} g fat</p>{m.notes && <p className="list-row-meta">{m.notes}</p>}</div>
          <button className="btn btn--ghost btn--icon" onClick={() => setEditor({ meal: m })} aria-label={`Edit ${m.meal_name || 'meal'}`}><i className="ti ti-pencil" aria-hidden="true" /></button>
          <button className="btn btn--ghost btn--icon" onClick={() => { setError(''); setDeleting({ type: 'meal', id: m.id, name: m.meal_name }); }} aria-label={`Delete ${m.meal_name || 'meal'}`}><i className="ti ti-trash" aria-hidden="true" /></button>
        </div>)}
      </Card>
      <Card className="card-section" static><div className="card-section-title">Daily goals</div><NutritionGoalEditor row={goals.rows.at(-1)} loading={goals.loading} error={goals.error} /></Card>
    </div>
    <Card className="card-section" static>
      <div className="card-section-title">Trends</div>
      {!history.length ? <p className="body-text">Log meals and weight to build your trend chart.</p> : <ResponsiveContainer width="100%" height={260}><LineChart data={history} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} tickFormatter={(d) => d.slice(5)} />
        <YAxis yAxisId="left" stroke="var(--text-secondary)" fontSize={11} /><YAxis yAxisId="right" orientation="right" stroke="var(--text-secondary)" fontSize={11} domain={['dataMin - 2', 'dataMax + 2']} />
        <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="left" type="monotone" dataKey="calories" stroke="var(--accent)" dot={false} strokeWidth={2} /><Line yAxisId="left" type="monotone" dataKey="protein" stroke="var(--text-secondary)" dot={false} strokeWidth={1.5} /><Line yAxisId="right" type="monotone" dataKey="weight" stroke="var(--text-primary)" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls />
      </LineChart></ResponsiveContainer>}
    </Card>
    <Card className="card-section" static>
      <div className="card-section-title">Weight log</div>
      <form className="nutrition-toolbar" onSubmit={logWeight}><label className="sr-only" htmlFor="nutrition-weight">Weight (lb)</label><input id="nutrition-weight" className="input" type="number" inputMode="decimal" min="0.1" max="2000" step="0.1" placeholder="Weight (lb)" value={weight} onChange={(e) => setWeight(e.target.value)} required /><button className="btn" disabled={busy || Boolean(weights.error)}>{busy ? 'Saving…' : 'Log weight'}</button></form>
      {weights.error && <p className="body-text text-red" role="alert">Could not load weights: {weights.error}</p>}
      {error && !deleting && <p className="body-text text-red" role="alert">{error}</p>}
      {[...weights.rows].reverse().slice(0, 6).map((w) => <div className="list-row" key={w.id}><span className="list-row-time">{formatDate(nutritionDay(w.logged_at, timeZone))}</span><span className="list-row-title">{w.weight} lb</span><button className="btn btn--ghost btn--icon" onClick={() => { setError(''); setDeleting({ type: 'weight', id: w.id, name: `${w.weight} lb` }); }} aria-label={`Delete weight ${w.weight} lb`}><i className="ti ti-trash" aria-hidden="true" /></button></div>)}
    </Card>
    {editor && <NutritionMealEditor meal={editor.meal} photoMode={editor.photo} date={date} timeZone={timeZone} onClose={() => setEditor(null)} onSaved={(row) => { setEditor(null); setDate(nutritionDay(row.logged_at, timeZone)); toast('Meal saved to CTRLpanel'); }} />}
    {deleting && <Modal title="Delete log entry?" onClose={() => !busy && setDeleting(null)} footer={<><button className="btn btn--ghost" onClick={() => setDeleting(null)} disabled={busy}>Cancel</button><button className="btn btn--danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button></>}><p className="body-text">Delete “{deleting.name}” from your log?</p>{error && <p className="body-text text-red" role="alert">{error}</p>}</Modal>}
  </div>;
}
