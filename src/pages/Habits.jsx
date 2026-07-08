import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useCrud } from '../lib/useData.js';
import { useAuth } from '../components/AuthProvider.jsx';
import { saveUserSettings } from '../lib/supabase.js';
import { lifeStats, ageToBirthdate, compactNumber } from '../lib/helpers.js';

const dayKey = (d) => d.toISOString().slice(0, 10);
const TRACK_DAYS = 14; // toggle columns shown in the tracking table

// Build the last N calendar days (oldest → newest).
function recentDays(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d);
  }
  return out;
}

/* ============================================================
   Habit tracking tab
   ============================================================ */
function HabitTracker() {
  const habits = useCrud('habits', 'created_at');
  const logs = useCrud('habit_logs');
  const [adding, setAdding] = useState('');
  const [chartHabit, setChartHabit] = useState(null);

  const activeHabits = habits.rows.filter((h) => h.active !== false);
  const days = recentDays(TRACK_DAYS);

  // Fast lookup: `${habit_id}|${date}` → log row
  const logMap = {};
  logs.rows.forEach((l) => {
    logMap[`${l.habit_id}|${l.log_date}`] = l;
  });
  const isDone = (habitId, date) => Boolean(logMap[`${habitId}|${date}`]?.completed);

  const toggle = (habitId, date) => {
    const existing = logMap[`${habitId}|${date}`];
    if (existing) logs.remove(existing.id);
    else logs.add({ habit_id: habitId, log_date: date, completed: true });
  };

  const addHabit = () => {
    const name = adding.trim();
    if (!name) return;
    habits.add({ name, active: true });
    setAdding('');
  };

  // Current streak (consecutive completed days ending today).
  const streakFor = (habitId) => {
    let streak = 0;
    const cur = new Date();
    cur.setHours(0, 0, 0, 0);
    while (isDone(habitId, dayKey(cur))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
    return streak;
  };

  // 12-week completion-rate trend for the selected habit.
  const selected = chartHabit || activeHabits[0]?.id;
  const trend = [];
  if (selected) {
    for (let w = 11; w >= 0; w--) {
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - w * 7);
      let done = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(end);
        d.setDate(end.getDate() - i);
        if (isDone(selected, dayKey(d))) done++;
      }
      trend.push({
        week: end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rate: Math.round((done / 7) * 100),
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="toolbar">
        <input
          className="input"
          placeholder="New habit name…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addHabit()}
          style={{ flex: 1 }}
        />
        <button className="btn btn--accent" onClick={addHabit} disabled={!adding.trim()}>
          <i className="ti ti-plus" /> Add Habit
        </button>
      </div>

      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Daily Tracking</span>
          <span className="muted">last {TRACK_DAYS} days · click to toggle</span>
        </div>

        {activeHabits.length === 0 ? (
          <p className="body-text">No habits yet. Add one above to start tracking.</p>
        ) : (
          <div className="habit-table-wrap">
            <table className="habit-table">
              <thead>
                <tr>
                  <th className="habit-name-col">Habit</th>
                  {days.map((d) => (
                    <th key={dayKey(d)} className="habit-day-col">
                      <span className="habit-dow">{d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                      <span className="habit-dom">{d.getDate()}</span>
                    </th>
                  ))}
                  <th className="habit-streak-col">🔥</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {activeHabits.map((h) => (
                  <tr key={h.id}>
                    <td className="habit-name-col" title={h.name}>{h.name}</td>
                    {days.map((d) => {
                      const key = dayKey(d);
                      const done = isDone(h.id, key);
                      return (
                        <td key={key} className="habit-day-col">
                          <button
                            className={`habit-cell ${done ? 'done' : ''}`}
                            onClick={() => toggle(h.id, key)}
                            title={`${h.name} · ${key}`}
                            aria-label={`Toggle ${h.name} on ${key}`}
                          >
                            {done && <i className="ti ti-check" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="habit-streak-col">{streakFor(h.id)}</td>
                    <td>
                      <button
                        className="btn btn--ghost btn--icon"
                        onClick={() => habits.remove(h.id)}
                        title="Delete habit"
                      >
                        <i className="ti ti-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {activeHabits.length > 0 && (
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Consistency Trend</span>
            <select
              className="select"
              value={selected}
              onChange={(e) => setChartHabit(e.target.value)}
              style={{ width: 'auto' }}
            >
              {activeHabits.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e1818" vertical={false} />
              <XAxis dataKey="week" stroke="#8a7070" fontSize={11} />
              <YAxis stroke="#8a7070" fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [`${v}%`, 'Completion']}
              />
              <Line type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   Life View tab
   ============================================================ */
function LifeView() {
  const { user, settings, refreshSettings } = useAuth();

  // Birthdate + lifespan come from saved settings, with a localStorage fallback
  // so they persist even when Supabase isn't configured.
  const birthdate = settings?.birthdate || localStorage.getItem('ctrlpanel-birthdate') || '';
  const expectancy = settings?.life_expectancy || Number(localStorage.getItem('ctrlpanel-life-expectancy')) || 90;

  const [prompting, setPrompting] = useState(false);
  const [form, setForm] = useState({ birthdate: '', age: '', expectancy });

  const stats = lifeStats(birthdate, expectancy);

  const openPrompt = () => {
    setForm({ birthdate: birthdate || '', age: '', expectancy });
    setPrompting(true);
  };

  const save = async () => {
    const bd = form.birthdate || ageToBirthdate(form.age);
    if (!bd) return;
    const exp = Number(form.expectancy) || 90;
    localStorage.setItem('ctrlpanel-birthdate', bd);
    localStorage.setItem('ctrlpanel-life-expectancy', String(exp));
    if (user?.id) {
      await saveUserSettings(user.id, { birthdate: bd, life_expectancy: exp });
      refreshSettings();
    }
    setPrompting(false);
  };

  if (!stats) {
    return (
      <>
        <Card className="card-section" static>
          <div className="life-empty">
            <i className="ti ti-hourglass" style={{ fontSize: 32, color: 'var(--accent)' }} />
            <p className="body-text" style={{ margin: '10px 0 14px' }}>
              See your life in weeks. Enter your birthdate once and it’s saved to your account.
            </p>
            <button className="btn btn--accent" onClick={openPrompt}>
              <i className="ti ti-calendar" /> Set birthdate
            </button>
          </div>
        </Card>
        {prompting && (
          <BirthdateModal form={form} setForm={setForm} onClose={() => setPrompting(false)} onSave={save} />
        )}
      </>
    );
  }

  const years = [];
  for (let y = 0; y < expectancy; y++) years.push(y);
  const weeksPerYear = 52;

  // Fun "so far" metrics derived from days lived.
  const d = stats.daysLived;
  const metrics = [
    { icon: 'ti-sun', value: d.toLocaleString(), label: 'Sunrises seen' },
    { icon: 'ti-heart', value: compactNumber(d * 100800), label: 'Heartbeats' },
    { icon: 'ti-lungs', value: compactNumber(d * 23040), label: 'Breaths taken' },
    { icon: 'ti-zzz', value: compactNumber(Math.round(d * 8)), label: 'Hours slept' },
    { icon: 'ti-moon', value: Math.floor(d / 29.53).toLocaleString(), label: 'Full moons' },
    { icon: 'ti-orbit', value: stats.ageYears.toLocaleString(), label: 'Trips round the sun' },
    { icon: 'ti-calendar-week', value: stats.weeksLived.toLocaleString(), label: 'Weeks lived' },
    { icon: 'ti-hourglass', value: (stats.totalWeeks - stats.weeksLived).toLocaleString(), label: 'Weeks left' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid grid-4">
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Age</span><i className="ti ti-user" /></div>
          <div className="stat-card-value">{stats.ageYears}</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Days Lived</span><i className="ti ti-sun" /></div>
          <div className="stat-card-value">{stats.daysLived.toLocaleString()}</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Days Left</span><i className="ti ti-hourglass" /></div>
          <div className="stat-card-value">{stats.daysRemaining.toLocaleString()}</div>
          <div className="stat-card-meta">of ~{expectancy} years</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Life Lived</span><i className="ti ti-chart-pie" /></div>
          <div className="stat-card-value">{stats.pctLived.toFixed(1)}%</div>
        </Card>
      </div>

      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Lifetime, so far</span>
          <span className="muted">rough estimates</span>
        </div>
        <div className="life-metrics">
          {metrics.map((m) => (
            <div className="life-metric" key={m.label}>
              <i className={`ti ${m.icon}`} />
              <div>
                <div className="life-metric-value">{m.value}</div>
                <div className="life-metric-label">{m.label}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Your Life in Weeks</span>
          <button className="btn btn--ghost btn--sm" onClick={openPrompt}>
            <i className="ti ti-settings" /> Edit
          </button>
        </div>
        <p className="body-text" style={{ marginBottom: 12 }}>
          Each box is one week · each row is one year · filled = lived.
        </p>
        <div className="life-grid">
          {years.map((y) => (
            <div className="life-year" key={y}>
              {Array.from({ length: weeksPerYear }, (_, w) => {
                const weekIndex = y * weeksPerYear + w;
                const lived = weekIndex < stats.weeksLived;
                const current = weekIndex === stats.weeksLived;
                return (
                  <span
                    key={w}
                    className={`life-week ${lived ? 'lived' : ''} ${current ? 'current' : ''}`}
                    title={`Year ${y}, week ${w + 1}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      {prompting && (
        <BirthdateModal form={form} setForm={setForm} onClose={() => setPrompting(false)} onSave={save} />
      )}
    </div>
  );
}

function BirthdateModal({ form, setForm, onClose, onSave }) {
  return (
    <Modal
      title="Your Life View"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={onSave} disabled={!form.birthdate && !form.age}>Save</button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">Birthdate (preferred)</label>
        <input
          className="input"
          type="date"
          value={form.birthdate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setForm({ ...form, birthdate: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="field-label">…or current age</label>
        <input
          className="input"
          type="number"
          min="0"
          max="120"
          placeholder="e.g. 27"
          value={form.age}
          onChange={(e) => setForm({ ...form, age: e.target.value })}
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field-label">Life expectancy (years)</label>
        <input
          className="input"
          type="number"
          min="1"
          max="120"
          value={form.expectancy}
          onChange={(e) => setForm({ ...form, expectancy: e.target.value })}
        />
      </div>
    </Modal>
  );
}

/* ============================================================
   Page shell with tabs
   ============================================================ */
export default function Habits() {
  const [tab, setTab] = useState('habits');

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Habits</h1>
          <div className="page-header-sub">Build consistency · see the bigger picture</div>
        </div>
        <div className="segmented">
          <button className={tab === 'habits' ? 'active' : ''} onClick={() => setTab('habits')}>Tracking</button>
          <button className={tab === 'life' ? 'active' : ''} onClick={() => setTab('life')}>Life View</button>
        </div>
      </div>

      {tab === 'habits' ? <HabitTracker /> : <LifeView />}
    </div>
  );
}
