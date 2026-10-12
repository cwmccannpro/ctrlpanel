import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Card from '../shared/Card.jsx';
import Modal from '../shared/Modal.jsx';
import NutritionMealEditor from '../NutritionMealEditor.jsx';
import NutritionOverview from '../NutritionOverview.jsx';
import { useToast } from '../Toaster.jsx';
import { useNutritionRows } from '../../lib/useNutritionRows.js';
import { useMealTimeZone } from '../../lib/useMealTimeZone.js';
import { deleteNutritionMeal } from '../../lib/nutritionClient.js';
import { nutritionDay } from '../../lib/nutrition.js';
import { formatDate } from '../../lib/helpers.js';
import '../../styles/nutrition.css';

const HISTORY_PAGE_DAYS = 14;

export default function Nutrition({ embedded = false }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const meals = useNutritionRows('nutrition_logs');
  const weights = useNutritionRows('weight_logs');
  const goals = useNutritionRows('user_goals', '*', 'updated_at');
  const timeZone = useMealTimeZone();
  const [date, setDate] = useState(() => nutritionDay(new Date(), timeZone));
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [past, setPast] = useState(null);
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
  const trend = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  // Newest first, grouped by local day, for the Past entries dialog.
  const pastDays = [];
  if (past) {
    [...meals.rows].reverse().forEach((m) => {
      const day = nutritionDay(m.logged_at, timeZone);
      if (!day) return;
      if (pastDays.at(-1)?.day === day) pastDays.at(-1).meals.push(m);
      else pastDays.push({ day, meals: [m] });
    });
  }
  const reload = () => { meals.reload(); weights.reload(); goals.reload(); };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await deleteNutritionMeal(deleting.id); setDeleting(null); toast('Meal deleted'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return <div className="fade-in nutrition-page">
    <div className="page-header" style={{ marginBottom: 0 }}>
      {!embedded && <h1 className="sr-only">Nutrition</h1>}
      <div className="nutrition-toolbar">
        <label className="sr-only" htmlFor="nutrition-day">Meal day</label><input id="nutrition-day" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn btn--accent" onClick={() => setEditor({ photo: true })}><i className="ti ti-camera" aria-hidden="true" /> Log meal by photo</button>
        <button className="btn" onClick={() => setEditor({ photo: false })}><i className="ti ti-message" aria-hidden="true" /> Describe a meal</button>
        <button className="btn" onClick={() => setPast({ days: HISTORY_PAGE_DAYS })}><i className="ti ti-history" aria-hidden="true" /> Past entries</button>
        <button className="btn btn--ghost btn--icon" onClick={reload} aria-label="Refresh nutrition log"><i className="ti ti-refresh" aria-hidden="true" /></button>
        <Link className="btn btn--ghost btn--icon" to="/settings#nutrition" aria-label="Nutrition settings"><i className="ti ti-settings" aria-hidden="true" /></Link>
      </div>
    </div>
    <p className="list-row-meta">{timeZone} · Click a nutrient to set your daily target. <Link to="/settings#nutrition">Connect your GPT</Link></p>
    {meals.error && <p className="body-text text-red" role="alert">Could not load meals: {meals.error} <button className="btn btn--sm" onClick={meals.reload}>Retry</button></p>}
    <NutritionOverview meals={todaysMeals} goalRow={goals.rows.at(-1)} loading={meals.loading} error={meals.error} goalsLoading={goals.loading} goalsError={goals.error} retryGoals={goals.reload} />
    <Card className="card-section" static>
      <div className="card-section-title">Trends</div>
      {!trend.length ? <p className="body-text">Log meals and weight to build your trend chart.</p> : <ResponsiveContainer width="100%" height={260}><LineChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} tickFormatter={(d) => d.slice(5)} />
        <YAxis yAxisId="left" stroke="var(--text-secondary)" fontSize={11} /><YAxis yAxisId="right" orientation="right" stroke="var(--text-secondary)" fontSize={11} domain={['dataMin - 2', 'dataMax + 2']} />
        <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="left" type="monotone" dataKey="calories" stroke="var(--accent)" dot={false} strokeWidth={2} /><Line yAxisId="left" type="monotone" dataKey="protein" stroke="var(--text-secondary)" dot={false} strokeWidth={1.5} /><Line yAxisId="right" type="monotone" dataKey="weight" stroke="var(--text-primary)" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls />
      </LineChart></ResponsiveContainer>}
    </Card>
    {past && <Modal wide title="Past entries" onClose={() => !editor && !deleting && setPast(null)}>
      {meals.loading ? <p className="body-text">Loading meals…</p> : meals.error ? <p className="body-text text-red" role="alert">Could not load meals: {meals.error}</p>
        : !pastDays.length ? <div className="nutrition-empty"><i className="ti ti-tools-kitchen-2" aria-hidden="true" /><p className="body-text">No meals logged yet. Take a photo or describe what you ate.</p></div>
        : <>
          {pastDays.slice(0, past.days).map(({ day, meals: dayMeals }) => <section className="nutrition-history-day" key={day} aria-label={formatDate(day)}>
            <div className="nutrition-history-day-head"><strong>{formatDate(day)}</strong><span className="list-row-meta">{dayMeals.length} {dayMeals.length === 1 ? 'meal' : 'meals'} · {Math.round(dayMeals.reduce((sum, m) => sum + (Number(m.calories) || 0), 0)).toLocaleString()} kcal</span></div>
            {dayMeals.map((m) => <div className="nutrition-meal-row" key={m.id}>
              <div><strong>{m.meal_name || 'Meal'}</strong><p className="list-row-meta">{Math.round(m.calories || 0)} kcal · {Math.round(m.protein || 0)} g protein · {Math.round(m.carbs || 0)} g carbs · {Math.round(m.fat || 0)} g fat</p>{m.notes && <p className="list-row-meta">{m.notes}</p>}</div>
              <button className="btn btn--ghost btn--icon" onClick={() => setEditor({ meal: m })} aria-label={`Edit ${m.meal_name || 'meal'}`}><i className="ti ti-pencil" aria-hidden="true" /></button>
              <button className="btn btn--ghost btn--icon" onClick={() => { setError(''); setDeleting({ id: m.id, name: m.meal_name }); }} aria-label={`Delete ${m.meal_name || 'meal'}`}><i className="ti ti-trash" aria-hidden="true" /></button>
            </div>)}
          </section>)}
          {pastDays.length > past.days && <button className="btn btn--sm" onClick={() => setPast({ days: past.days + HISTORY_PAGE_DAYS })}>Show earlier days</button>}
        </>}
    </Modal>}
    {editor && <NutritionMealEditor meal={editor.meal} photoMode={editor.photo} date={date} timeZone={timeZone} onClose={() => setEditor(null)} onSaved={(row) => { setEditor(null); setDate(nutritionDay(row.logged_at, timeZone)); toast('Meal saved to CTRLpanel'); }} />}
    {deleting && <Modal title="Delete meal?" onClose={() => !busy && setDeleting(null)} footer={<><button className="btn btn--ghost" onClick={() => setDeleting(null)} disabled={busy}>Cancel</button><button className="btn btn--danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button></>}><p className="body-text">Delete “{deleting.name || 'this meal'}” from your log?</p>{error && <p className="body-text text-red" role="alert">{error}</p>}</Modal>}
  </div>;
}
