import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import NutritionSocial from './NutritionSocial.jsx';
import { useCrud } from '../../lib/useData.js';
import { formatDate } from '../../lib/helpers.js';

const RING_COLORS = { Calories: '#e11d48', Protein: '#3b82f6', Carbs: '#f59e0b', Fat: '#10b981', Water: '#14b8a6' };
const DEFAULT_GOALS = { calories: 2400, protein: 180, carbs: 250, fat: 80, water: 64 };
const day = (ts) => (ts || '').slice(0, 10);

function Ring({ label, current, goal, unit }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = goal ? Math.min(current / goal, 1) : 0;
  return (
    <div className="ring">
      <div style={{ position: 'relative', width: 84, height: 84 }}>
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle className="ring-track" cx="42" cy="42" r={r} fill="none" strokeWidth="7" />
          <circle className="ring-fill" cx="42" cy="42" r={r} fill="none" stroke={RING_COLORS[label]} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {Math.round(pct * 100)}%
        </div>
      </div>
      <span className="ring-label">{label}</span>
      <span className="ring-value">{Math.round(current)} / {goal}{unit}</span>
    </div>
  );
}

export default function Nutrition() {
  const meals = useCrud('nutrition_logs', 'logged_at');
  const weights = useCrud('weight_logs', 'logged_at');
  const water = useCrud('water_logs', 'logged_at');
  const goalsCrud = useCrud('user_goals');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState('');
  const [waterOz, setWaterOz] = useState('');
  const [addingMeal, setAddingMeal] = useState(null);

  const goalsRow = goalsCrud.rows[0];
  const goals = { ...DEFAULT_GOALS, ...(goalsRow || {}) };

  const setGoal = (key, value) => {
    const v = value === '' ? 0 : Number(value);
    if (goalsRow) goalsCrud.patch(goalsRow.id, { [key]: v });
    else goalsCrud.add({ ...DEFAULT_GOALS, [key]: v });
  };

  const todaysMeals = meals.rows.filter((m) => day(m.logged_at) === date);
  const todaysWater = water.rows
    .filter((w) => day(w.logged_at) === date)
    .reduce((t, w) => t + Number(w.amount || 0), 0);

  const logWater = (oz) => {
    const amount = Number(oz);
    if (!amount) return;
    water.add({ amount, logged_at: new Date(`${date}T12:00:00`).toISOString() });
    setWaterOz('');
  };
  const totals = todaysMeals.reduce(
    (t, m) => ({
      calories: t.calories + Number(m.calories || 0),
      protein: t.protein + Number(m.protein || 0),
      carbs: t.carbs + Number(m.carbs || 0),
      fat: t.fat + Number(m.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  // Aggregate history by day for the trend chart
  const byDay = {};
  meals.rows.forEach((m) => {
    const d = day(m.logged_at);
    if (!d) return;
    byDay[d] = byDay[d] || { date: d, calories: 0, protein: 0, carbs: 0, fat: 0 };
    byDay[d].calories += Number(m.calories || 0);
    byDay[d].protein += Number(m.protein || 0);
    byDay[d].carbs += Number(m.carbs || 0);
    byDay[d].fat += Number(m.fat || 0);
  });
  weights.rows.forEach((w) => {
    const d = day(w.logged_at);
    if (!d) return;
    byDay[d] = byDay[d] || { date: d, calories: 0, protein: 0, carbs: 0, fat: 0 };
    byDay[d].weight = Number(w.weight);
  });
  const history = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

  const logWeight = () => {
    if (!weight) return;
    weights.add({ weight: Number(weight), logged_at: new Date(`${date}T12:00:00`).toISOString() });
    setWeight('');
  };

  const saveMeal = () => {
    if (!addingMeal.meal_name?.trim()) return;
    meals.add({
      meal_name: addingMeal.meal_name,
      calories: Number(addingMeal.calories) || 0,
      protein: Number(addingMeal.protein) || 0,
      carbs: Number(addingMeal.carbs) || 0,
      fat: Number(addingMeal.fat) || 0,
      logged_at: new Date(`${date}T12:00:00`).toISOString(),
    });
    setAddingMeal(null);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Nutrition</h1>
          <div className="page-header-sub">Intake vs. goals</div>
        </div>
        <input className="input" type="date" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {/* Macro rings */}
      <Card className="card-section" static>
        <div className="rings-grid">
          <Ring label="Calories" current={totals.calories} goal={goals.calories} />
          <Ring label="Protein" current={totals.protein} goal={goals.protein} unit="g" />
          <Ring label="Carbs" current={totals.carbs} goal={goals.carbs} unit="g" />
          <Ring label="Fat" current={totals.fat} goal={goals.fat} unit="g" />
          <Ring label="Water" current={todaysWater} goal={goals.water} unit="oz" />
        </div>
      </Card>

      <div className="grid grid-2">
        {/* Goals — editable */}
        <Card className="card-section" static>
          <div className="card-section-title">Daily Goals</div>
          <div className="grid grid-2">
            {['calories', 'protein', 'carbs', 'fat', 'water'].map((k) => (
              <div className="field" key={k} style={{ marginBottom: 8 }}>
                <label className="field-label">{k}{k === 'calories' ? '' : k === 'water' ? ' (oz)' : ' (g)'}</label>
                <input className="input" type="number" value={goals[k] ?? ''} onChange={(e) => setGoal(k, e.target.value)} />
              </div>
            ))}
          </div>
        </Card>

        {/* Meals */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Meals</span>
            <button className="btn btn--sm btn--accent" onClick={() => setAddingMeal({})}><i className="ti ti-plus" /> Log Meal</button>
          </div>
          {todaysMeals.length === 0 && <p className="body-text">No meals logged for this day.</p>}
          {todaysMeals.map((m) => (
            <div className="list-row" key={m.id}>
              <span className="list-row-title">{m.meal_name}</span>
              <span className="list-row-meta">{Math.round(m.calories)} kcal · {Math.round(m.protein)}p</span>
              <button className="btn btn--ghost btn--icon" onClick={() => meals.remove(m.id)} title="Delete"><i className="ti ti-x" /></button>
            </div>
          ))}
        </Card>
      </div>

      {/* Water */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Water</span>
          <span className="list-row-meta">{Math.round(todaysWater)} / {goals.water} oz</span>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn" onClick={() => logWater(8)}><i className="ti ti-droplet" /> +8 oz</button>
          <button className="btn" onClick={() => logWater(16)}><i className="ti ti-droplet" /> +16 oz</button>
          <input
            className="input"
            type="number"
            placeholder="Custom (oz)"
            style={{ width: 130 }}
            value={waterOz}
            onChange={(e) => setWaterOz(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && logWater(waterOz)}
          />
          <button className="btn btn--accent" onClick={() => logWater(waterOz)} disabled={!waterOz}><i className="ti ti-plus" /> Log</button>
        </div>
        {water.rows.filter((w) => day(w.logged_at) === date).map((w) => (
          <div className="list-row" key={w.id}>
            <i className="ti ti-droplet" style={{ color: '#14b8a6' }} />
            <span className="list-row-title">{Math.round(w.amount)} oz</span>
            <button className="btn btn--ghost btn--icon" onClick={() => water.remove(w.id)} title="Delete"><i className="ti ti-x" /></button>
          </div>
        ))}
      </Card>

      {/* Trend chart */}
      <Card className="card-section" static>
        <div className="card-section-title">Trends</div>
        {history.length === 0 ? (
          <p className="body-text">Log meals and weight to build your trend chart.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={history} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#1e1818" vertical={false} />
              <XAxis dataKey="date" stroke="#8a7070" fontSize={11} tickFormatter={(d) => d.slice(5)} />
              <YAxis yAxisId="left" stroke="#8a7070" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke="#8a7070" fontSize={11} domain={['dataMin - 2', 'dataMax + 2']} />
              <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="calories" stroke="#e11d48" dot={false} strokeWidth={2} />
              <Line yAxisId="left" type="monotone" dataKey="protein" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
              <Line yAxisId="right" type="monotone" dataKey="weight" stroke="#f0e8e8" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Weight */}
      <Card className="card-section" static>
        <div className="card-section-title">Weight Log</div>
        <div className="toolbar" style={{ marginBottom: todaysMeals ? 12 : 0 }}>
          <input className="input" type="number" placeholder="Weight (lbs)" style={{ width: 160 }} value={weight} onChange={(e) => setWeight(e.target.value)} />
          <input className="input" type="date" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn--accent" onClick={logWeight}><i className="ti ti-plus" /> Log</button>
        </div>
        {[...weights.rows].reverse().slice(0, 6).map((w) => (
          <div className="list-row" key={w.id}>
            <span className="list-row-time">{formatDate(w.logged_at)}</span>
            <span className="list-row-title">{w.weight} lbs</span>
            <button className="btn btn--ghost btn--icon" onClick={() => weights.remove(w.id)} title="Delete"><i className="ti ti-x" /></button>
          </div>
        ))}
      </Card>

      {/* Friends, leaderboard + challenges */}
      <NutritionSocial />

      {addingMeal && (
        <Modal
          title="Log Meal"
          onClose={() => setAddingMeal(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAddingMeal(null)}>Cancel</button><button className="btn btn--accent" onClick={saveMeal}>Save</button></>}
        >
          <div className="field"><label className="field-label">Meal</label><input className="input" value={addingMeal.meal_name || ''} onChange={(e) => setAddingMeal({ ...addingMeal, meal_name: e.target.value })} autoFocus /></div>
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Calories</label><input className="input" type="number" value={addingMeal.calories || ''} onChange={(e) => setAddingMeal({ ...addingMeal, calories: e.target.value })} /></div>
            <div className="field"><label className="field-label">Protein (g)</label><input className="input" type="number" value={addingMeal.protein || ''} onChange={(e) => setAddingMeal({ ...addingMeal, protein: e.target.value })} /></div>
            <div className="field"><label className="field-label">Carbs (g)</label><input className="input" type="number" value={addingMeal.carbs || ''} onChange={(e) => setAddingMeal({ ...addingMeal, carbs: e.target.value })} /></div>
            <div className="field"><label className="field-label">Fat (g)</label><input className="input" type="number" value={addingMeal.fat || ''} onChange={(e) => setAddingMeal({ ...addingMeal, fat: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
