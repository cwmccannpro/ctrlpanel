// ============================================================
// CTRLpanel — Dashboard panel registry
//
// Every panel is self-contained: it fetches its own per-user data and renders
// directly onto the column surface (no per-widget Card — the dashboard is
// card-less by design). Each receives `cfg` (its saved per-instance settings)
// and `onCfg(patch)` to persist changes alongside the layout.
//
// Add a panel here and it automatically appears in the "Add panel" picker.
// ============================================================
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from './AuthProvider.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useRows, useCrud } from '../lib/useData.js';
import { finance, youtube, gcal } from '../lib/api.js';
import { KANBAN_COLUMNS, SUPPLEMENT_TIMINGS, WORKOUT_COLORS } from '../lib/mockData.js';
import {
  relativeDay, formatDate, currency, percent, compactCurrency, compactNumber, number, lifeStats, channelLabel,
} from '../lib/helpers.js';
import { RANGES, computeTrend, recentDays, dayKey } from '../lib/habits.js';

const todayKey = () => new Date().toISOString().slice(0, 10);
const todayShort = () => new Date().toLocaleDateString('en-US', { weekday: 'short' });
const TIP = { background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 };

const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const PRIORITY_COLOR = { Urgent: '#ef4444', High: '#f59e0b', Medium: '#3b82f6', Low: '#10b981' };
const byPriority = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
  String(a.created_at || '').localeCompare(String(b.created_at || ''));

const QUOTES = [
  { q: 'Discipline equals freedom.', a: 'Jocko Willink' },
  { q: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', a: 'Aristotle' },
  { q: 'Take care of your body. It’s the only place you have to live.', a: 'Jim Rohn' },
  { q: 'Success is the sum of small efforts repeated day in and day out.', a: 'Robert Collier' },
  { q: 'The body achieves what the mind believes.', a: 'Napoleon Hill' },
  { q: 'Motivation gets you going, discipline keeps you growing.', a: 'John C. Maxwell' },
  { q: 'The groundwork for all happiness is good health.', a: 'Leigh Hunt' },
  { q: 'Fall in love with the process and the results will come.', a: 'Eric Thomas' },
  { q: 'An investment in knowledge pays the best interest.', a: 'Benjamin Franklin' },
  { q: 'Fear no man, look up to no man. Watch and learn from everyone.', a: 'David Goggins' },
];

/* ---------- shared bits ---------- */
function PanelTitle({ children, to }) {
  const navigate = useNavigate();
  if (!to) return <div className="dash2-panel-title">{children}</div>;
  return (
    <button className="dash2-panel-title dash2-link" onClick={() => navigate(to)}>{children}</button>
  );
}
const Empty = ({ children }) => <div className="dash2-empty">{children}</div>;

// Calendar events from the same source the Calendar page uses: Google when
// connected, else the local Supabase table.
function useCalendarEvents() {
  const { rows: localRows } = useRows('calendar_events', []);
  const [gEvents, setGEvents] = useState(null);
  useEffect(() => {
    let on = true;
    gcal.status()
      .then((s) => (s.connected ? gcal.list() : null))
      .then((r) => { if (on && r) setGEvents(r.events || []); })
      .catch(() => {});
    return () => { on = false; };
  }, []);
  return gEvents ?? localRows;
}

/* ============================================================
   Tasks
   ============================================================ */
function BoardPanel({ cfg = {}, onCfg = () => {} }) {
  const navigate = useNavigate();
  const { rows: boards } = useRows('boards', []);
  const { rows: tasks } = useRows('tasks', []);
  const board = boards.find((b) => b.id === cfg.board_id) || boards[0] || null;
  const columns = board?.columns?.length ? board.columns : KANBAN_COLUMNS;
  const column = columns.includes(cfg.column) ? cfg.column : columns[0];
  const items = board
    ? tasks.filter((t) => t.board_id === board.id && (t.column_name || columns[0]) === column).sort(byPriority)
    : [];

  return (
    <>
      <div className="dash2-panel-head">
        <select
          className="dash2-select"
          value={board?.id || ''}
          onChange={(e) => {
            const b = boards.find((x) => x.id === e.target.value);
            const cols = b?.columns?.length ? b.columns : KANBAN_COLUMNS;
            onCfg({ board_id: e.target.value, column: cols[0] });
          }}
        >
          {boards.length === 0 && <option value="">No boards</option>}
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select
          className="dash2-select"
          value={column}
          onChange={(e) => onCfg({ board_id: board?.id, column: e.target.value })}
          disabled={!board}
        >
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="dash2-count">{items.length}</span>
      </div>
      <div className="dash2-tasks">
        {!board ? (
          <Empty>Create a board in To Do to show it here.</Empty>
        ) : items.length === 0 ? (
          <Empty>Nothing in {column}.</Empty>
        ) : (
          items.map((t) => (
            <div className="dash2-task" key={t.id} onClick={() => navigate(`/todo/${board.id}`)} title={t.title}>
              <span className="dash2-dot" style={{ background: PRIORITY_COLOR[t.priority] || '#8a7070' }} />
              <span className="dash2-task-title">{t.title}</span>
              {t.due_date && <span className="dash2-task-meta">{relativeDay(t.due_date)}</span>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// Everything due soon across every board, soonest first.
function UpcomingTasksPanel({ cfg = {}, onCfg = () => {} }) {
  const navigate = useNavigate();
  const { rows: tasks } = useRows('tasks', []);
  const days = Number(cfg.days) || 14;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  const end = new Date(cutoff.getTime() + days * 86400000);

  const items = tasks
    .filter((t) => t.due_date && (t.column_name || '') !== 'Done')
    .filter((t) => {
      const d = new Date(t.due_date);
      return d <= end;
    })
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .slice(0, 12);

  const overdue = items.filter((t) => new Date(t.due_date) < cutoff).length;

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/todo">Due Soon</PanelTitle>
        <div className="segmented segmented--xs">
          {[7, 14, 30].map((d) => (
            <button key={d} className={days === d ? 'active' : ''} onClick={() => onCfg({ days: d })}>{d}d</button>
          ))}
        </div>
      </div>
      {overdue > 0 && <div className="dash2-invest-row" style={{ marginBottom: 4 }}><span className="text-red">{overdue} overdue</span></div>}
      <div className="dash2-tasks">
        {items.length === 0 ? (
          <Empty>Nothing due in the next {days} days.</Empty>
        ) : (
          items.map((t) => {
            const late = new Date(t.due_date) < cutoff;
            return (
              <div className="dash2-task" key={t.id} onClick={() => navigate(t.board_id ? `/todo/${t.board_id}` : '/todo')} title={t.title}>
                <span className="dash2-dot" style={{ background: PRIORITY_COLOR[t.priority] || '#8a7070' }} />
                <span className="dash2-task-title">{t.title}</span>
                <span className={`dash2-task-meta ${late ? 'text-red' : ''}`}>{relativeDay(t.due_date)}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/* ============================================================
   Calendar
   ============================================================ */
function SchedulePanel({ cfg = {}, onCfg = () => {} }) {
  const navigate = useNavigate();
  const events = useCalendarEvents();
  const mode = cfg.mode || 'today';

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const spanDays = mode === 'today' ? 1 : 7;
  const end = new Date(start.getTime() + spanDays * 86400000);

  const items = events
    .filter((e) => {
      const s = new Date(e.starts_at);
      return s >= start && s < end;
    })
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 14);

  const time = (e) =>
    e.all_day ? 'All day' : new Date(e.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/calendar">{mode === 'today' ? 'Today’s Schedule' : 'This Week'}</PanelTitle>
        <div className="segmented segmented--xs">
          <button className={mode === 'today' ? 'active' : ''} onClick={() => onCfg({ mode: 'today' })}>Day</button>
          <button className={mode === 'week' ? 'active' : ''} onClick={() => onCfg({ mode: 'week' })}>Week</button>
        </div>
      </div>
      <div className="dash2-tasks">
        {items.length === 0 ? (
          <Empty>Nothing scheduled{mode === 'today' ? ' today' : ' this week'}.</Empty>
        ) : (
          items.map((e) => (
            <div className="dash2-task" key={e.id} onClick={() => navigate('/calendar')} title={e.title}>
              <span className="dash2-dot" style={{ background: e.color || 'var(--accent)' }} />
              <span className="dash2-task-title">{e.title}</span>
              <span className="dash2-task-meta">
                {mode === 'week' ? `${relativeDay(e.starts_at)} · ` : ''}{time(e)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ============================================================
   Health
   ============================================================ */
function Ring({ label, value, goal, unit, color }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  return (
    <div className="dash2-ring">
      <div className="dash2-ring-wrap">
        <svg viewBox="0 0 64 64">
          <circle className="ring-track" cx="32" cy="32" r={R} />
          <circle
            className="ring-fill" cx="32" cy="32" r={R} stroke={color}
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 32 32)"
          />
        </svg>
        <div className="dash2-ring-center">{Math.round(value)}</div>
      </div>
      <div className="dash2-ring-label">{label}</div>
      <div className="dash2-ring-goal">/{Math.round(goal)}{unit || ''}</div>
    </div>
  );
}

function MacrosPanel() {
  const { rows: logs } = useRows('nutrition_logs', []);
  const { rows: goalRows } = useRows('user_goals', []);
  const goals = { calories: 2400, protein: 180, carbs: 250, fat: 80, ...(goalRows[0] || {}) };
  const today = logs.filter((x) => (x.logged_at || '').slice(0, 10) === todayKey());
  const sum = (k) => today.reduce((s, x) => s + Number(x[k] || 0), 0);
  return (
    <>
      <PanelTitle to="/health/nutrition">Macros · Today</PanelTitle>
      <div className="dash2-rings">
        <Ring label="Cal" value={sum('calories')} goal={goals.calories} color="#e11d48" />
        <Ring label="Protein" value={sum('protein')} goal={goals.protein} unit="g" color="#3b82f6" />
        <Ring label="Carbs" value={sum('carbs')} goal={goals.carbs} unit="g" color="#f59e0b" />
        <Ring label="Fat" value={sum('fat')} goal={goals.fat} unit="g" color="#10b981" />
      </div>
    </>
  );
}

function WaterPanel() {
  const water = useCrud('water_logs');
  const { rows: goalRows } = useRows('user_goals', []);
  const goal = Number(goalRows[0]?.water) || 64;
  const today = water.rows.filter((x) => (x.logged_at || '').slice(0, 10) === todayKey());
  const total = today.reduce((s, x) => s + Number(x.amount || 0), 0);
  const pct = goal ? Math.min((total / goal) * 100, 100) : 0;

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/health/nutrition">Water · Today</PanelTitle>
        <span className="dash2-count">{Math.round(total)} / {goal} oz</span>
      </div>
      <div className="progress" style={{ marginBottom: 8 }}>
        <div className="progress-fill" style={{ width: `${pct}%`, background: '#3b82f6' }} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {[8, 16, 24].map((oz) => (
          <button key={oz} className="btn btn--sm" onClick={() => water.add({ amount: oz })}>
            <i className="ti ti-plus" /> {oz} oz
          </button>
        ))}
      </div>
    </>
  );
}

function WeightPanel({ cfg = {}, onCfg = () => {} }) {
  const { rows } = useRows('weight_logs', [], 'logged_at');
  const days = Number(cfg.days) || 90;
  const cutoff = Date.now() - days * 86400000;
  const data = rows
    .filter((r) => r.logged_at && new Date(r.logged_at).getTime() >= cutoff)
    .map((r) => ({ t: new Date(r.logged_at).getTime(), weight: Number(r.weight || 0) }))
    .sort((a, b) => a.t - b.t);

  const latest = data.at(-1)?.weight ?? 0;
  const first = data[0]?.weight ?? 0;
  const change = latest - first;

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/health/nutrition">Weight</PanelTitle>
        <div className="segmented segmented--xs">
          {[30, 90, 365].map((d) => (
            <button key={d} className={days === d ? 'active' : ''} onClick={() => onCfg({ days: d })}>{d === 365 ? '1y' : `${d}d`}</button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <Empty>Log your weight under Health → Nutrition.</Empty>
      ) : (
        <>
          <div className="dash2-invest-value">{latest.toFixed(1)} <span style={{ fontSize: 13 }}>lbs</span></div>
          {data.length > 1 && (
            <div className="dash2-invest-row">
              <span className={change <= 0 ? 'text-green' : 'text-red'}>
                {change > 0 ? '+' : ''}{change.toFixed(1)} lbs
              </span>
              <span className="dash2-invest-sep">·</span>
              <span className="list-row-meta">last {days === 365 ? 'year' : `${days} days`}</span>
            </div>
          )}
          {data.length > 1 && (
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={data} margin={{ top: 6, right: 4, left: -30, bottom: 0 }}>
                <CartesianGrid stroke="#1e1818" vertical={false} />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip contentStyle={TIP} labelFormatter={(t) => formatDate(new Date(t))} formatter={(v) => [`${v} lbs`, 'Weight']} />
                <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </>
  );
}

function SupplementsPanel() {
  const { rows: supplements } = useRows('supplements', []);
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const quote = QUOTES[doy % QUOTES.length];
  const enabled = supplements.filter((s) => s.enabled !== false);
  const groups = SUPPLEMENT_TIMINGS.map((timing) => ({
    timing,
    items: enabled.filter((s) => (s.timing || 'Morning') === timing),
  })).filter((g) => g.items.length);

  return (
    <>
      <p className="dash2-quote">“{quote.q}”<span className="dash2-quote-author">— {quote.a}</span></p>
      <PanelTitle to="/health/supplements">Today’s Stack</PanelTitle>
      {enabled.length === 0 ? (
        <Empty>No supplements assigned. Add them under Health → Supplements.</Empty>
      ) : (
        <div className="dash2-supps">
          {groups.map((g) => (
            <div className="dash2-supp-row" key={g.timing}>
              <span className="dash2-supp-timing">{g.timing}</span>
              <span className="dash2-supp-names">
                {g.items.map((s) => (s.dose ? `${s.name} (${s.dose})` : s.name)).join(', ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FitnessPanel() {
  const { rows: schedule } = useRows('fitness_schedule', []);
  const dow = todayShort();
  const row = schedule.find((r) => r.day_of_week === dow);
  const type = row?.workout_type;
  const color = WORKOUT_COLORS[type] || 'var(--border-bright)';
  return (
    <>
      <PanelTitle to="/health/fitness">Today’s Training · {new Date().toLocaleDateString('en-US', { weekday: 'long' })}</PanelTitle>
      {!type || type === 'Rest' ? (
        <div className="dash2-fit">
          <span className="dash2-fit-badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            <i className="ti ti-bed" /> {type === 'Rest' ? 'Rest day' : 'No workout scheduled'}
          </span>
        </div>
      ) : (
        <div className="dash2-fit">
          <span className="dash2-fit-badge" style={{ background: color }}><i className="ti ti-barbell" /> {type}</span>
          <span className="dash2-fit-sub">Scheduled for today</span>
        </div>
      )}
    </>
  );
}

// Recent workout activity + current streak.
function WorkoutsPanel() {
  const { rows: logs } = useRows('workout_logs', [], 'completed_at');
  const doneDays = new Set(logs.map((w) => (w.completed_at || '').slice(0, 10)).filter(Boolean));

  let streak = 0;
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  while (doneDays.has(cur.toISOString().slice(0, 10))) { streak++; cur.setDate(cur.getDate() - 1); }

  const last28 = recentDays(28);
  const thisMonth = last28.filter((d) => doneDays.has(dayKey(d))).length;
  const recent = [...logs].sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 4);

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/health/fitness">Workouts</PanelTitle>
        <span className="dash2-count">🔥 {streak}</span>
      </div>
      <div className="dash2-yt-stats" style={{ marginBottom: 8 }}>
        <div><span className="dash2-yt-num">{thisMonth}</span><span className="dash2-yt-lbl">last 28d</span></div>
        <div><span className="dash2-yt-num">{logs.length}</span><span className="dash2-yt-lbl">all time</span></div>
      </div>
      <div className="dash2-heat">
        {last28.map((d) => (
          <span key={dayKey(d)} className={`dash2-heat-cell ${doneDays.has(dayKey(d)) ? 'on' : ''}`} title={dayKey(d)} />
        ))}
      </div>
      {recent.length > 0 && (
        <div className="dash2-tasks" style={{ marginTop: 8 }}>
          {recent.map((w) => (
            <div className="dash2-task" key={w.id}>
              <span className="dash2-dot" style={{ background: WORKOUT_COLORS[w.workout_type] || 'var(--accent)' }} />
              <span className="dash2-task-title">{w.workout_type || 'Workout'}</span>
              <span className="dash2-task-meta">{relativeDay(w.completed_at)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ============================================================
   Habits
   ============================================================ */
function HabitsGridPanel() {
  const { rows: habits } = useRows('habits', []);
  const logs = useCrud('habit_logs');
  const active = habits.filter((h) => h.active !== false);
  const days = recentDays(7);
  const logMap = {};
  logs.rows.forEach((l) => { logMap[`${l.habit_id}|${l.log_date}`] = l; });
  const isDone = (id, dk) => Boolean(logMap[`${id}|${dk}`]?.completed);
  const toggle = (id, dk) => {
    const ex = logMap[`${id}|${dk}`];
    if (ex) logs.remove(ex.id);
    else logs.add({ habit_id: id, log_date: dk, completed: true });
  };

  return (
    <>
      <PanelTitle to="/habits">Habits · This Week</PanelTitle>
      {active.length === 0 ? (
        <Empty>No habits yet. Add them under Habits.</Empty>
      ) : (
        <div className="dash2-habits">
          <div className="dash2-habit-row dash2-habit-head">
            <span />
            {days.map((d) => (
              <span className="dash2-habit-dow" key={dayKey(d)}>{d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
            ))}
          </div>
          {active.map((h) => (
            <div className="dash2-habit-row" key={h.id}>
              <span className="dash2-habit-name" title={h.name}>{h.name}</span>
              {days.map((d) => {
                const dk = dayKey(d);
                const done = isDone(h.id, dk);
                return (
                  <button
                    key={dk}
                    className={`dash2-habit-cell ${done ? 'done' : ''}`}
                    onClick={() => toggle(h.id, dk)}
                    title={`${h.name} · ${dk}`}
                    aria-label={`Toggle ${h.name} on ${dk}`}
                  >
                    {done && <i className="ti ti-check" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HabitsTrendPanel({ cfg = {}, onCfg = () => {} }) {
  const { rows: habits } = useRows('habits', []);
  const { rows: logs } = useRows('habit_logs', []);
  const range = RANGES.includes(cfg.range) ? cfg.range : '3M';
  const trend = useMemo(() => computeTrend({ logs, habits, chartHabit: 'all', range }), [logs, habits, range]);
  return (
    <>
      <div className="dash2-panel-head" style={{ marginBottom: 6 }}>
        <PanelTitle to="/habits">Consistency</PanelTitle>
        <div className="segmented segmented--xs">
          {RANGES.map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => onCfg({ range: r })}>{r}</button>
          ))}
        </div>
      </div>
      {trend.length === 0 ? (
        <Empty>Track habits to see your trend.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={trend} margin={{ top: 6, right: 6, left: -26, bottom: 0 }}>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="label" stroke="#8a7070" fontSize={10} interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={false} />
            <YAxis stroke="#8a7070" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={TIP} formatter={(v) => [`${v}%`, 'Completion']} />
            <Line type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

function LifePanel() {
  const { settings } = useAuth();
  const birthdate = settings?.birthdate || localStorage.getItem('ctrlpanel-birthdate');
  const stats = lifeStats(birthdate, settings?.life_expectancy || 90);
  return (
    <>
      <PanelTitle to="/habits">Life</PanelTitle>
      {!stats ? (
        <Empty>Set your birthdate on Habits → Life View.</Empty>
      ) : (
        <>
          <div className="dash2-invest-row" style={{ marginBottom: 6 }}>
            <span className="dash2-yt-num">{stats.ageYears} yrs</span>
            <span className="dash2-invest-sep">·</span>
            <span className="list-row-meta">{stats.pctLived.toFixed(1)}% lived</span>
          </div>
          <div className="progress"><div className="progress-fill" style={{ width: `${stats.pctLived}%` }} /></div>
          <div className="list-row-meta" style={{ marginTop: 6 }}>
            {stats.daysRemaining.toLocaleString()} days remaining (~{Math.round(stats.daysRemaining / 365)} yrs)
          </div>
        </>
      )}
    </>
  );
}

/* ============================================================
   Finance
   ============================================================ */
const PERF_SCALES = ['1M', '3M', '6M', '1Y', 'ALL'];
const CASH_RANGES = [
  { id: '3M', months: 3 },
  { id: '6M', months: 6 },
  { id: '1Y', months: 12 },
];
const MONTHLY_FACTOR = { Monthly: 1, 'Bi-Weekly': 26 / 12, Weekly: 52 / 12, Annual: 1 / 12 };
const monthlyIncome = (rows) =>
  rows.reduce((s, i) => s + Number(i.amount || 0) * (MONTHLY_FACTOR[i.frequency] ?? 1), 0);

function NetWorthPanel() {
  const { rows: accounts } = useRows('accounts', []);
  const { rows: snapshots } = useRows('net_worth_snapshots', [], 'snapshot_date');

  const current = accounts.reduce(
    (s, a) => s + (a.type === 'Liability' ? -Number(a.balance || 0) : Number(a.balance || 0)),
    0
  );

  const series = useMemo(() => {
    const pts = [...snapshots]
      .filter((s) => s.snapshot_date)
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)))
      .map((s) => ({ date: s.snapshot_date, value: Number(s.total || 0) }));
    const today = todayKey();
    if (!pts.length || pts.at(-1).date !== today) pts.push({ date: today, value: current });
    return pts;
  }, [snapshots, current]);

  const first = series[0]?.value ?? 0;
  const change = current - first;
  const up = change >= 0;
  const color = up ? '#10b981' : '#ef4444';

  return (
    <>
      <div className="dash2-panel-head" style={{ marginBottom: 8 }}>
        <PanelTitle to="/finance/networth">Net Worth</PanelTitle>
      </div>
      {accounts.length === 0 ? (
        <Empty>Add accounts under Finance → Net Worth.</Empty>
      ) : (
        <>
          <div className="dash2-invest-value">{currency(current)}</div>
          {series.length > 1 && (
            <div className="dash2-invest-row">
              <span className={up ? 'text-green' : 'text-red'}>
                {up ? '▲' : '▼'} {currency(Math.abs(change))} ({percent(first ? (change / first) * 100 : 0)})
              </span>
              <span className="dash2-invest-sep">·</span>
              <span className="list-row-meta">since {formatDate(series[0].date)}</span>
            </div>
          )}
          {series.length > 1 ? (
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={series} margin={{ top: 6, right: 4, left: -34, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashNw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip contentStyle={TIP} labelFormatter={(d) => formatDate(d)} formatter={(v) => [currency(v), 'Net worth']} />
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#dashNw)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty>Save snapshots on the Net Worth page to chart it over time.</Empty>
          )}
        </>
      )}
    </>
  );
}

function CashflowPanel({ cfg = {}, onCfg = () => {} }) {
  const { rows: income } = useRows('income_sources', []);
  const { rows: categories } = useRows('expense_categories', []);
  const { rows: txns } = useRows('transactions', []);
  const range = CASH_RANGES.some((r) => r.id === cfg.range) ? cfg.range : '6M';

  const months = CASH_RANGES.find((r) => r.id === range)?.months || 6;
  const perMonthIncome = monthlyIncome(income);
  const budgeted = categories.reduce((s, c) => s + Number(c.budgeted || 0), 0);

  const data = useMemo(() => {
    const out = [];
    const ref = new Date();
    ref.setDate(1);
    ref.setHours(0, 0, 0, 0);
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const spent = txns
        .filter((t) => {
          if (!t.date) return false;
          const td = new Date(t.date);
          return td.getFullYear() === y && td.getMonth() === m;
        })
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      const expenses = spent > 0 ? spent : budgeted;
      out.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        income: Math.round(perMonthIncome),
        expenses: Math.round(expenses),
        actual: spent > 0,
        net: Math.round(perMonthIncome - expenses),
      });
    }
    return out;
  }, [txns, perMonthIncome, budgeted, months]);

  const avg = data.length ? Math.round(data.reduce((s, d) => s + d.net, 0) / data.length) : 0;
  const positive = avg >= 0;
  const hasData = income.length > 0 || categories.length > 0 || txns.length > 0;

  return (
    <>
      <div className="dash2-panel-head" style={{ marginBottom: 8 }}>
        <PanelTitle to="/finance/budget">Cashflow</PanelTitle>
        <div className="segmented segmented--xs">
          {CASH_RANGES.map((r) => (
            <button key={r.id} className={range === r.id ? 'active' : ''} onClick={() => onCfg({ range: r.id })}>{r.id}</button>
          ))}
        </div>
      </div>
      {!hasData ? (
        <Empty>Add income and expense categories under Finance → Budget.</Empty>
      ) : (
        <>
          <div className={`dash2-invest-value ${positive ? 'text-green' : 'text-red'}`}>
            {positive ? '+' : '−'}{currency(Math.abs(avg))}
          </div>
          <div className="dash2-invest-row">
            <span className="list-row-meta">monthly {positive ? 'positive' : 'negative'} cashflow</span>
          </div>
          <div className="dash2-legend">
            <span><i className="dash2-swatch" style={{ background: '#10b981' }} /> Income {compactCurrency(perMonthIncome)}</span>
            <span><i className="dash2-swatch" style={{ background: '#ef4444' }} /> Expenses {compactCurrency(budgeted)}</span>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={data} margin={{ top: 6, right: 4, left: -20, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="#1e1818" vertical={false} />
              <XAxis dataKey="label" stroke="#8a7070" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#8a7070" fontSize={10} tickFormatter={(v) => compactCurrency(v)} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={TIP}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                formatter={(v, n, p) => [currency(v), n === 'income' ? 'Income' : p?.payload?.actual ? 'Spent' : 'Budgeted']}
              />
              <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="expenses" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </>
  );
}

// Spend vs budget per category, this month.
function BudgetPanel() {
  const { rows: categories } = useRows('expense_categories', []);
  const { rows: txns } = useRows('transactions', []);
  const now = new Date();
  const spentFor = (id) =>
    txns
      .filter((t) => t.category_id === id && t.date && new Date(t.date).getMonth() === now.getMonth() && new Date(t.date).getFullYear() === now.getFullYear())
      .reduce((s, t) => s + Number(t.amount || 0), 0);

  const rows = categories
    .map((c) => ({ id: c.id, name: c.name, budgeted: Number(c.budgeted || 0), spent: spentFor(c.id) }))
    .sort((a, b) => (b.spent / (b.budgeted || 1)) - (a.spent / (a.budgeted || 1)))
    .slice(0, 6);

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/finance/budget">Budget · {now.toLocaleDateString('en-US', { month: 'long' })}</PanelTitle>
      </div>
      {rows.length === 0 ? (
        <Empty>Add expense categories under Finance → Budget.</Empty>
      ) : (
        rows.map((c) => {
          const pct = c.budgeted ? Math.min((c.spent / c.budgeted) * 100, 100) : 0;
          const over = c.budgeted && c.spent > c.budgeted;
          return (
            <div className="bar-list-row" key={c.id}>
              <div className="spread">
                <span className="list-row-meta">{c.name}</span>
                <span className={`list-row-meta ${over ? 'text-red' : ''}`}>{currency(c.spent)} / {currency(c.budgeted)}</span>
              </div>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${pct}%`, background: over ? '#ef4444' : pct > 80 ? '#f59e0b' : '#10b981' }} />
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

function InvestingPanel({ cfg = {}, onCfg = () => {} }) {
  const { rows: holdings } = useRows('holdings', []);
  const [prices, setPrices] = useState({});
  const [perf, setPerf] = useState([]);
  const scale = PERF_SCALES.includes(cfg.scale) ? cfg.scale : '3M';

  const tickers = holdings.map((h) => h.ticker).filter(Boolean);
  const tickerKey = tickers.join(',');
  useEffect(() => {
    if (!tickerKey) return;
    let active = true;
    const poll = () => finance.prices(tickerKey.split(',')).then((d) => active && setPrices(d)).catch(() => {});
    poll();
    const t = setInterval(poll, 15000);
    return () => { active = false; clearInterval(t); };
  }, [tickerKey]);

  const enriched = holdings.map((h) => {
    const q = prices[h.ticker];
    const price = q?.price ?? h.manual_price ?? h.avg_cost ?? 0;
    return { value: Number(h.shares || 0) * price, cost: Number(h.shares || 0) * Number(h.avg_cost || 0), dayChange: q?.change ?? 0 };
  });
  const totalValue = enriched.reduce((s, h) => s + h.value, 0);
  const totalCost = enriched.reduce((s, h) => s + h.cost, 0);
  const totalGain = totalValue - totalCost;
  const returnPct = totalCost ? (totalGain / totalCost) * 100 : 0;
  const prevValue = enriched.reduce((s, h) => s + (h.dayChange ? h.value / (1 + h.dayChange / 100) : h.value), 0);
  const dayGain = totalValue - prevValue;
  const dayPct = prevValue ? (dayGain / prevValue) * 100 : 0;

  const posKey = holdings.filter((h) => h.ticker && Number(h.shares) > 0).map((h) => `${h.ticker}:${h.shares}`).join(',');
  useEffect(() => {
    if (!posKey) { setPerf([]); return; }
    const list = posKey.split(',').map((p) => { const [ticker, shares] = p.split(':'); return { ticker, shares: Number(shares) }; });
    let active = true;
    finance.portfolioHistory(list, scale).then((d) => active && setPerf(d.series || [])).catch(() => active && setPerf([]));
    return () => { active = false; };
  }, [posKey, scale]);

  const perfUp = (perf.at(-1)?.value ?? 0) >= (perf[0]?.value ?? 0);
  const color = perfUp ? '#10b981' : '#ef4444';

  return (
    <>
      <div className="dash2-panel-head" style={{ marginBottom: 8 }}>
        <PanelTitle to="/finance/investing">Portfolio</PanelTitle>
        <div className="segmented segmented--xs">
          {PERF_SCALES.map((s) => <button key={s} className={scale === s ? 'active' : ''} onClick={() => onCfg({ scale: s })}>{s}</button>)}
        </div>
      </div>
      {holdings.length === 0 ? (
        <Empty>Add holdings under Finance → Investing.</Empty>
      ) : (
        <>
          <div className="dash2-invest-value">{currency(totalValue)}</div>
          <div className="dash2-invest-row">
            <span className={dayGain >= 0 ? 'text-green' : 'text-red'}>{dayGain >= 0 ? '▲' : '▼'} {currency(Math.abs(dayGain))} ({percent(dayPct)}) today</span>
            <span className="dash2-invest-sep">·</span>
            <span className={totalGain >= 0 ? 'text-green' : 'text-red'}>{totalGain >= 0 ? '+' : ''}{currency(totalGain)} ({percent(returnPct)}) total</span>
          </div>
          {perf.length > 0 && (
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={perf} margin={{ top: 6, right: 4, left: -34, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashPerf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip contentStyle={TIP} labelFormatter={() => ''} formatter={(v) => [currency(v), 'Value']} />
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#dashPerf)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </>
  );
}

/* ============================================================
   Work
   ============================================================ */
function ProjectsPanel() {
  const navigate = useNavigate();
  const { rows: projects } = useRows('projects', []);
  const active = projects.filter((p) => (p.status || 'Active') !== 'Complete').slice(0, 8);
  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/projects">Projects</PanelTitle>
        <span className="dash2-count">{active.length}</span>
      </div>
      <div className="dash2-tasks">
        {active.length === 0 ? (
          <Empty>No active projects.</Empty>
        ) : (
          active.map((p) => (
            <div className="dash2-task" key={p.id} onClick={() => navigate(`/projects/${p.id}`)} title={p.name}>
              <span className="dash2-dot" style={{ background: p.color || 'var(--accent)' }} />
              <span className="dash2-task-title">{p.name}</span>
              <span className="dash2-task-meta">{p.status || 'Active'}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function CrmPanel() {
  const navigate = useNavigate();
  const { rows: contacts } = useRows('crm_contacts', []);
  const temps = ['Hot', 'Warm', 'Cold'];
  const colors = { Hot: '#ef4444', Warm: '#f59e0b', Cold: '#3b82f6' };
  const counts = temps.map((t) => ({ t, n: contacts.filter((c) => c.lead_temp === t).length }));
  const recent = [...contacts]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 4);

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/crm">Pipeline</PanelTitle>
        <span className="dash2-count">{contacts.length}</span>
      </div>
      {contacts.length === 0 ? (
        <Empty>No contacts yet.</Empty>
      ) : (
        <>
          <div className="dash2-yt-stats" style={{ marginBottom: 8 }}>
            {counts.map(({ t, n }) => (
              <div key={t}>
                <span className="dash2-yt-num" style={{ color: colors[t] }}>{n}</span>
                <span className="dash2-yt-lbl">{t}</span>
              </div>
            ))}
          </div>
          <div className="dash2-tasks">
            {recent.map((c) => (
              <div className="dash2-task" key={c.id} onClick={() => navigate('/crm')} title={c.business_name}>
                <span className="dash2-dot" style={{ background: colors[c.lead_temp] || '#8a7070' }} />
                <span className="dash2-task-title">{c.business_name}</span>
                <span className="dash2-task-meta">{c.service || ''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ReportsPanel() {
  const navigate = useNavigate();
  const { rows: reports } = useRows('reports', []);
  const { rows: sources } = useRows('report_sources', []);
  const nameById = Object.fromEntries(sources.map((s) => [s.id, s.name]));
  const recent = [...reports]
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
    .slice(0, 6);
  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/reports">Reports</PanelTitle>
        <span className="dash2-count">{reports.length}</span>
      </div>
      <div className="dash2-tasks">
        {recent.length === 0 ? (
          <Empty>No reports yet. Add a source under Reports.</Empty>
        ) : (
          recent.map((r) => (
            <div className="dash2-task" key={r.id} onClick={() => navigate(`/reports/${r.source_id}`)} title={r.title}>
              <i className="ti ti-file-type-pdf" style={{ color: 'var(--accent)', fontSize: 13, flexShrink: 0 }} />
              <span className="dash2-task-title">{r.title}</span>
              <span className="dash2-task-meta">{nameById[r.source_id] || ''}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function YouTubePanel({ cfg = {} }) {
  const navigate = useNavigate();
  // Channels come from the shared Socials list (one fetch for the whole app).
  const { socials } = useWorkspace();
  const status = { ready: socials.ready, channels: socials.channels, loaded: socials.loaded };
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  const first = status.channels.find((c) => c.id === cfg.channel_id) || status.channels[0];
  const firstId = first?.id;

  useEffect(() => {
    if (!firstId) return;
    let active = true;
    setErr(false);
    youtube.analytics(firstId, '28d')
      .then((d) => active && setData(d))
      .catch(() => active && setErr(true));
    return () => { active = false; };
  }, [firstId]);
  return (
    <>
      <div className="dash2-panel-head" style={{ marginBottom: 8 }}>
        <PanelTitle to={first ? `/socials/youtube/${first.id}` : '/socials'}>YouTube</PanelTitle>
        {first && <span className="dash2-count"><i className="ti ti-users" /> {compactNumber(data?.channel?.subscribers ?? first.subscriber_count ?? 0)}</span>}
      </div>
      {!status.loaded ? (
        <Empty>Loading…</Empty>
      ) : !status.ready ? (
        <Empty>YouTube not configured on the server.</Empty>
      ) : !first ? (
        <button className="btn btn--sm btn--accent" onClick={() => youtube.connect()}><i className="ti ti-brand-youtube" /> Connect channel</button>
      ) : (
        <>
          <div className="dash2-yt-title">{channelLabel(first)}</div>
          {data?.totals ? (
            <>
              <div className="dash2-yt-stats">
                <div><span className="dash2-yt-num">{compactNumber(data.totals.views)}</span><span className="dash2-yt-lbl">views 28d</span></div>
                <div><span className={`dash2-yt-num ${data.totals.netSubs >= 0 ? 'text-green' : 'text-red'}`}>{data.totals.netSubs >= 0 ? '+' : ''}{number(data.totals.netSubs)}</span><span className="dash2-yt-lbl">subs 28d</span></div>
                <div><span className="dash2-yt-num">{number(data.totals.watchHours)}</span><span className="dash2-yt-lbl">watch hrs</span></div>
              </div>
              {data.series?.length > 0 && (
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={data.series} margin={{ top: 4, right: 4, left: -34, bottom: 0 }}>
                    <defs><linearGradient id="dashYt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e11d48" stopOpacity={0.3} /><stop offset="100%" stopColor="#e11d48" stopOpacity={0} /></linearGradient></defs>
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip contentStyle={TIP} labelFormatter={() => ''} formatter={(v) => [number(v), 'Views']} />
                    <Area type="monotone" dataKey="views" stroke="#e11d48" strokeWidth={2} fill="url(#dashYt)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </>
          ) : err ? (
            <Empty>Couldn’t load analytics. Open YouTube to retry.</Empty>
          ) : (
            <Empty>Loading analytics…</Empty>
          )}
        </>
      )}
    </>
  );
}

/* ============================================================
   Capture
   ============================================================ */
function QuickAddPanel({ cfg = {}, onCfg = () => {} }) {
  const { rows: boards } = useRows('boards', []);
  const tasks = useCrud('tasks');
  const [text, setText] = useState('');
  const board = boards.find((b) => b.id === cfg.board_id) || boards[0] || null;
  const columns = board?.columns?.length ? board.columns : KANBAN_COLUMNS;

  const submit = () => {
    if (!text.trim() || !board) return;
    tasks.add({ board_id: board.id, title: text.trim(), column_name: columns[0], priority: 'Medium' });
    setText('');
  };

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/todo">Quick Add</PanelTitle>
        {boards.length > 1 && (
          <select className="dash2-select" value={board?.id || ''} onChange={(e) => onCfg({ board_id: e.target.value })}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>
      {!board ? (
        <Empty>Create a board in To Do first.</Empty>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            placeholder={`New task in ${columns[0]}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={{ flex: 1 }}
          />
          <button className="btn btn--accent btn--sm" onClick={submit} disabled={!text.trim()}>
            <i className="ti ti-plus" />
          </button>
        </div>
      )}
    </>
  );
}

/* ============================================================
   Registry
   ============================================================ */
export const PANELS = [
  // Tasks & work
  { id: 'board', title: 'Task Board Column', icon: 'ti-layout-kanban', group: 'Work', Component: BoardPanel },
  { id: 'upcoming_tasks', title: 'Due Soon', icon: 'ti-alarm', group: 'Work', Component: UpcomingTasksPanel },
  { id: 'quick_add', title: 'Quick Add', icon: 'ti-plus', group: 'Work', Component: QuickAddPanel },
  { id: 'schedule', title: 'Schedule', icon: 'ti-calendar', group: 'Work', Component: SchedulePanel },
  { id: 'projects', title: 'Projects', icon: 'ti-folder', group: 'Work', Component: ProjectsPanel },
  { id: 'crm', title: 'CRM Pipeline', icon: 'ti-users', group: 'Work', Component: CrmPanel },
  { id: 'reports', title: 'Reports', icon: 'ti-report', group: 'Work', Component: ReportsPanel },
  // Finance
  { id: 'networth', title: 'Net Worth', icon: 'ti-wallet', group: 'Finance', Component: NetWorthPanel },
  { id: 'cashflow', title: 'Cashflow', icon: 'ti-arrows-exchange', group: 'Finance', Component: CashflowPanel },
  { id: 'budget', title: 'Budget Categories', icon: 'ti-receipt', group: 'Finance', Component: BudgetPanel },
  { id: 'investing', title: 'Portfolio', icon: 'ti-chart-line', group: 'Finance', Component: InvestingPanel },
  // Health
  { id: 'macros', title: 'Macros', icon: 'ti-salad', group: 'Health', Component: MacrosPanel },
  { id: 'water', title: 'Water', icon: 'ti-droplet', group: 'Health', Component: WaterPanel },
  { id: 'weight', title: 'Weight', icon: 'ti-scale', group: 'Health', Component: WeightPanel },
  { id: 'supplements', title: 'Supplement Stack', icon: 'ti-pill', group: 'Health', Component: SupplementsPanel },
  { id: 'fitness', title: 'Today’s Training', icon: 'ti-barbell', group: 'Health', Component: FitnessPanel },
  { id: 'workouts', title: 'Workouts', icon: 'ti-flame', group: 'Health', Component: WorkoutsPanel },
  // Habits
  { id: 'habits_grid', title: 'Habits Week', icon: 'ti-checkbox', group: 'Habits', Component: HabitsGridPanel },
  { id: 'habits_trend', title: 'Consistency Trend', icon: 'ti-chart-dots', group: 'Habits', Component: HabitsTrendPanel },
  { id: 'life', title: 'Life Progress', icon: 'ti-hourglass', group: 'Habits', Component: LifePanel },
  // Socials
  { id: 'youtube', title: 'YouTube', icon: 'ti-brand-youtube', group: 'Socials', Component: YouTubePanel },
];

export const PANELS_BY_ID = Object.fromEntries(PANELS.map((p) => [p.id, p]));

// A sensible starting dashboard for a fresh account.
export const DEFAULT_LAYOUT = [
  ['board', 'board', 'board'],
  ['networth', 'cashflow', 'investing', 'youtube'],
  ['habits_grid', 'habits_trend', 'macros', 'supplements', 'fitness'],
];
