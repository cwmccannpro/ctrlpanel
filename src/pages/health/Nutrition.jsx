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
import { mockMacros, mockMicros, mockMeals, mockNutritionHistory } from '../../lib/mockData.js';
import { insert as sbInsert } from '../../lib/supabase.js';

const RING_COLORS = { Calories: '#e11d48', Protein: '#3b82f6', Carbs: '#f59e0b', Fat: '#10b981' };

function Ring({ label, current, goal, unit }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = Math.min(current / goal, 1);
  const color = RING_COLORS[label];
  return (
    <div className="ring">
      <div style={{ position: 'relative', width: 84, height: 84 }}>
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle className="ring-track" cx="42" cy="42" r={r} fill="none" strokeWidth="7" />
          <circle
            className="ring-fill"
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {Math.round(pct * 100)}%
        </div>
      </div>
      <span className="ring-label">{label}</span>
      <span className="ring-value">
        {current} / {goal}
        {unit}
      </span>
    </div>
  );
}

const RANGES = { '7D': 7, '30D': 30, '90D': 90 };

export default function Nutrition() {
  const [range, setRange] = useState('7D');
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const m = mockMacros;

  const data = mockNutritionHistory.slice(-RANGES[range]);

  const logWeight = () => {
    if (!weight) return;
    sbInsert('weight_logs', [{ weight: Number(weight), logged_at: new Date(date).toISOString() }]);
    setWeight('');
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Nutrition</h1>
          <div className="page-header-sub">Today's intake vs. goals · demo data</div>
        </div>
        <input className="input" type="date" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {/* Macro rings */}
      <Card className="card-section" static>
        <div className="rings-grid">
          <Ring label="Calories" current={m.calories.current} goal={m.calories.goal} />
          <Ring label="Protein" current={m.protein.current} goal={m.protein.goal} unit="g" />
          <Ring label="Carbs" current={m.carbs.current} goal={m.carbs.goal} unit="g" />
          <Ring label="Fat" current={m.fat.current} goal={m.fat.goal} unit="g" />
        </div>
      </Card>

      <div className="grid grid-2">
        {/* Micronutrients */}
        <Card className="card-section" static>
          <div className="card-section-title">Micronutrients</div>
          <div className="micros-grid">
            {mockMicros.map((mi) => (
              <div className="micro-pill" key={mi.name}>
                <div className="micro-pill-name">{mi.name}</div>
                <div className="micro-bar">
                  <div className="micro-bar-fill" style={{ width: `${Math.min(mi.value, 100)}%` }} />
                </div>
                <div className="list-row-meta" style={{ marginTop: 4 }}>{mi.value}%</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Meal log */}
        <Card className="card-section" static>
          <div className="card-section-title">Today's Meals</div>
          {mockMeals.map((meal) => (
            <div className="list-row" key={meal.id}>
              <span className="list-row-time">{meal.time}</span>
              <span className="list-row-title">{meal.meal_name}</span>
              <span className="list-row-meta">
                {meal.calories} kcal · {meal.protein}p
              </span>
            </div>
          ))}
        </Card>
      </div>

      {/* Time chart with weight overlay */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Trends</span>
          <div className="segmented">
            {Object.keys(RANGES).map((r) => (
              <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="date" stroke="#8a7070" fontSize={11} tickFormatter={(d) => d.slice(5)} />
            <YAxis yAxisId="left" stroke="#8a7070" fontSize={11} />
            <YAxis yAxisId="right" orientation="right" stroke="#8a7070" fontSize={11} domain={['dataMin - 2', 'dataMax + 2']} />
            <Tooltip
              contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="calories" stroke="#e11d48" dot={false} strokeWidth={2} />
            <Line yAxisId="left" type="monotone" dataKey="protein" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
            <Line yAxisId="left" type="monotone" dataKey="carbs" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
            <Line yAxisId="left" type="monotone" dataKey="fat" stroke="#10b981" dot={false} strokeWidth={1.5} />
            <Line yAxisId="right" type="monotone" dataKey="weight" stroke="#f0e8e8" strokeDasharray="4 3" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Weight input */}
      <Card className="card-section" static>
        <div className="card-section-title">Log Weight</div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <input
            className="input"
            type="number"
            placeholder="Weight (lbs)"
            style={{ width: 160 }}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
          <input className="input" type="date" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn--accent" onClick={logWeight}>
            <i className="ti ti-plus" /> Log
          </button>
        </div>
      </Card>
    </div>
  );
}
