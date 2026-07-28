import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../components/AuthProvider.jsx';
import LifeProgressPanel from '../components/LifeProgressPanel.jsx';
import { useRows, useCrud } from '../lib/useData.js';
import { saveUserSettings } from '../lib/supabase.js';
import { finance, youtube } from '../lib/api.js';
import { KANBAN_COLUMNS, SUPPLEMENT_TIMINGS, WORKOUT_COLORS } from '../lib/mockData.js';
import { greeting, formatClock, formatLongDate, relativeDay, clamp, currency, percent, compactCurrency, compactNumber, number } from '../lib/helpers.js';
import { RANGES, computeTrend, recentDays, dayKey } from '../lib/habits.js';

const PANEL_COUNT = 3; // default number of board panels for a fresh dashboard
const todayKey = () => new Date().toISOString().slice(0, 10);
const todayShort = () => new Date().toLocaleDateString('en-US', { weekday: 'short' });

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

/* ---------- Left: a selectable board + column ---------- */
function BoardPanel({ boards, tasks, panel, onChange, onRemove, canRemove }) {
  const navigate = useNavigate();
  const board = boards.find((b) => b.id === panel?.board_id) || boards[0] || null;
  const columns = board?.columns?.length ? board.columns : KANBAN_COLUMNS;
  const column = columns.includes(panel?.column) ? panel.column : columns[0];
  const items = board
    ? tasks.filter((t) => t.board_id === board.id && (t.column_name || columns[0]) === column).sort(byPriority)
    : [];

  return (
    <div className="dash2-panel">
      <div className="dash2-panel-head">
        <select
          className="dash2-select"
          value={board?.id || ''}
          onChange={(e) => {
            const b = boards.find((x) => x.id === e.target.value);
            const cols = b?.columns?.length ? b.columns : KANBAN_COLUMNS;
            onChange({ board_id: e.target.value, column: cols[0] });
          }}
        >
          {boards.length === 0 && <option value="">No boards</option>}
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select
          className="dash2-select"
          value={column}
          onChange={(e) => onChange({ board_id: board?.id, column: e.target.value })}
          disabled={!board}
        >
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="dash2-count">{items.length}</span>
        {canRemove && (
          <button className="dash2-remove" onClick={onRemove} title="Remove board" aria-label="Remove board">
            <i className="ti ti-x" />
          </button>
        )}
      </div>

      <div className="dash2-tasks">
        {!board ? (
          <div className="dash2-empty">Create a board in To Do to show it here.</div>
        ) : items.length === 0 ? (
          <div className="dash2-empty">Nothing in {column}.</div>
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
    </div>
  );
}

/* ---------- Right: health ---------- */
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
            className="ring-fill"
            cx="32"
            cy="32"
            r={R}
            stroke={color}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            transform="rotate(-90 32 32)"
          />
        </svg>
        <div className="dash2-ring-center">{Math.round(value)}</div>
      </div>
      <div className="dash2-ring-label">{label}</div>
      <div className="dash2-ring-goal">/{Math.round(goal)}{unit || ''}</div>
    </div>
  );
}

function MacrosPanel({ logs, goalRow }) {
  const goals = { calories: 2400, protein: 180, carbs: 250, fat: 80, ...(goalRow || {}) };
  const today = logs.filter((x) => (x.logged_at || '').slice(0, 10) === todayKey());
  const sum = (k) => today.reduce((s, x) => s + Number(x[k] || 0), 0);
  const tot = { calories: sum('calories'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') };
  return (
    <div className="dash2-panel">
      <div className="dash2-panel-title">Macros · Today</div>
      <div className="dash2-rings">
        <Ring label="Cal" value={tot.calories} goal={goals.calories} color="#e11d48" />
        <Ring label="Protein" value={tot.protein} goal={goals.protein} unit="g" color="#3b82f6" />
        <Ring label="Carbs" value={tot.carbs} goal={goals.carbs} unit="g" color="#f59e0b" />
        <Ring label="Fat" value={tot.fat} goal={goals.fat} unit="g" color="#10b981" />
      </div>
    </div>
  );
}

function SupplementsPanel({ supplements }) {
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const quote = QUOTES[doy % QUOTES.length];
  const enabled = supplements.filter((s) => s.enabled !== false);
  const groups = SUPPLEMENT_TIMINGS.map((timing) => ({
    timing,
    items: enabled.filter((s) => (s.timing || 'Morning') === timing),
  })).filter((g) => g.items.length);

  return (
    <div className="dash2-panel">
      <p className="dash2-quote">“{quote.q}”<span className="dash2-quote-author">— {quote.a}</span></p>
      <div className="dash2-panel-title">Today’s Stack</div>
      {enabled.length === 0 ? (
        <div className="dash2-empty">No supplements assigned. Add them under Health → Supplements.</div>
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
    </div>
  );
}

function FitnessPanel({ schedule }) {
  const dow = todayShort();
  const row = schedule.find((r) => r.day_of_week === dow);
  const type = row?.workout_type;
  const color = WORKOUT_COLORS[type] || 'var(--border-bright)';
  return (
    <div className="dash2-panel">
      <div className="dash2-panel-title">Today’s Training · {new Date().toLocaleDateString('en-US', { weekday: 'long' })}</div>
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
    </div>
  );
}

/* ---------- Right: habits ---------- */
function HabitsGridPanel({ habits, logs }) {
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
    <div className="dash2-panel">
      <div className="dash2-panel-title">Habits · This Week</div>
      {active.length === 0 ? (
        <div className="dash2-empty">No habits yet. Add them under Habits.</div>
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
    </div>
  );
}

function HabitsTrendPanel({ habits, logs, range, onRangeChange }) {
  const trend = useMemo(() => computeTrend({ logs, habits, chartHabit: 'all', range }), [logs, habits, range]);
  return (
    <div className="dash2-panel">
      <div className="dash2-panel-head" style={{ marginBottom: 6 }}>
        <div className="dash2-panel-title" style={{ margin: 0 }}>Consistency</div>
        <div className="segmented segmented--xs">
          {RANGES.map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => onRangeChange(r)}>{r}</button>
          ))}
        </div>
      </div>
      {trend.length === 0 ? (
        <div className="dash2-empty">Track habits to see your trend.</div>
      ) : (
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={trend} margin={{ top: 6, right: 6, left: -26, bottom: 0 }}>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="label" stroke="#8a7070" fontSize={10} interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={false} />
            <YAxis stroke="#8a7070" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}%`, 'Completion']} />
            <Line type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ---------- Middle: investing + youtube ---------- */
const PERF_SCALES = ['1M', '3M', '6M', '1Y', 'ALL'];

function InvestingPanel({ scale, onScaleChange }) {
  const navigate = useNavigate();
  const { rows: holdings } = useRows('holdings', []);
  const [prices, setPrices] = useState({});
  const [perf, setPerf] = useState([]);

  const tickers = holdings.map((h) => h.ticker).filter(Boolean);
  const tickerKey = tickers.join(',');
  useEffect(() => {
    if (!tickers.length) return;
    let active = true;
    const poll = () => finance.prices(tickers).then((d) => active && setPrices(d)).catch(() => {});
    poll();
    const t = setInterval(poll, 15000);
    return () => { active = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const list = holdings.filter((h) => h.ticker && Number(h.shares) > 0).map((h) => ({ ticker: h.ticker, shares: Number(h.shares) }));
    if (!list.length) { setPerf([]); return; }
    let active = true;
    finance.portfolioHistory(list, scale).then((d) => active && setPerf(d.series || [])).catch(() => active && setPerf([]));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey, scale]);

  const perfUp = (perf.at(-1)?.value ?? 0) >= (perf[0]?.value ?? 0);
  const color = perfUp ? '#10b981' : '#ef4444';

  return (
    <div className="dash2-panel">
      <div className="dash2-panel-head" style={{ marginBottom: 8 }}>
        <button className="dash2-panel-title dash2-link" style={{ margin: 0 }} onClick={() => navigate('/finance/investing')}>Portfolio</button>
        <div className="segmented segmented--xs">
          {PERF_SCALES.map((s) => <button key={s} className={scale === s ? 'active' : ''} onClick={() => onScaleChange(s)}>{s}</button>)}
        </div>
      </div>
      {holdings.length === 0 ? (
        <div className="dash2-empty">Add holdings under Finance → Investing.</div>
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
                <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} labelFormatter={() => ''} formatter={(v) => [currency(v), 'Value']} />
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#dashPerf)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
}

function YouTubePanel() {
  const navigate = useNavigate();
  const [status, setStatus] = useState({ ready: false, channels: [], loaded: false });
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    youtube
      .status()
      .then((s) => {
        if (!active) return;
        setStatus({ ready: !!s.ready, channels: s.channels || [], loaded: true });
        const first = s.channels?.[0];
        if (first) youtube.analytics(first.id, '28d').then((d) => active && setData(d)).catch(() => active && setErr(true));
      })
      .catch(() => active && setStatus((p) => ({ ...p, loaded: true })));
    return () => { active = false; };
  }, []);

  const first = status.channels[0];
  return (
    <div className="dash2-panel">
      <div className="dash2-panel-head" style={{ marginBottom: 8 }}>
        <button className="dash2-panel-title dash2-link" style={{ margin: 0 }} onClick={() => navigate('/socials/youtube')}>YouTube</button>
        {first && <span className="dash2-count"><i className="ti ti-users" /> {compactNumber(data?.channel?.subscribers ?? first.subscriber_count ?? 0)}</span>}
      </div>
      {!status.loaded ? (
        <div className="dash2-empty">Loading…</div>
      ) : !status.ready ? (
        <div className="dash2-empty">YouTube not configured on the server.</div>
      ) : !first ? (
        <button className="btn btn--sm btn--accent" onClick={() => youtube.connect()}><i className="ti ti-brand-youtube" /> Connect channel</button>
      ) : (
        <>
          <div className="dash2-yt-title">{first.title}</div>
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
                    <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} labelFormatter={() => ''} formatter={(v) => [number(v), 'Views']} />
                    <Area type="monotone" dataKey="views" stroke="#e11d48" strokeWidth={2} fill="url(#dashYt)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </>
          ) : err ? (
            <div className="dash2-empty">Couldn’t load analytics. Open YouTube to retry.</div>
          ) : (
            <div className="dash2-empty">Loading analytics…</div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Page ---------- */
function defaultPanels(boards) {
  const b = boards[0];
  const cols = b?.columns?.length ? b.columns : KANBAN_COLUMNS;
  return Array.from({ length: PANEL_COUNT }, (_, i) => ({ board_id: b?.id || null, column: cols[i] || cols[0] || KANBAN_COLUMNS[0] }));
}
const oneBoardPanel = (boards) => {
  const b = boards[0];
  const cols = b?.columns?.length ? b.columns : KANBAN_COLUMNS;
  return { board_id: b?.id || null, column: cols[0] || KANBAN_COLUMNS[0] };
};

export default function Dashboard() {
  const { displayName, user, settings } = useAuth();
  const [now, setNow] = useState(new Date());

  const boards = useRows('boards');
  const { rows: tasks } = useRows('tasks', []);
  const { rows: nutrition } = useRows('nutrition_logs', []);
  const { rows: goals } = useRows('user_goals', []);
  const { rows: supplements } = useRows('supplements', []);
  const { rows: fitness } = useRows('fitness_schedule', []);
  const { rows: habitRows } = useRows('habits', []);
  const habitLogs = useCrud('habit_logs');

  const [panels, setPanels] = useState(null);
  const [cols, setCols] = useState([34, 33]); // [left %, middle %]; right = remainder
  const [options, setOptions] = useState({ habitRange: '3M', investingScale: '3M' });
  const containerRef = useRef(null);
  const initRef = useRef(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  // Saved config: user_settings.dashboard_widgets = { v:5, panels, cols, options }.
  const savedCfg = settings?.dashboard_widgets;
  const savedPanels = savedCfg && !Array.isArray(savedCfg) && Array.isArray(savedCfg.panels) ? savedCfg.panels : null;

  useEffect(() => {
    if (initRef.current) return;
    // Auth settings and board rows load independently. Do not lock in defaults
    // before Supabase has had a chance to return the user's saved layout.
    if (!settings) return;
    if (savedPanels) {
      setPanels(savedPanels.length ? savedPanels : defaultPanels(boards.rows));
      if (Array.isArray(savedCfg.cols) && savedCfg.cols.length === 2) setCols(savedCfg.cols);
      setOptions({
        habitRange: RANGES.includes(savedCfg.options?.habitRange) ? savedCfg.options.habitRange : '3M',
        investingScale: PERF_SCALES.includes(savedCfg.options?.investingScale) ? savedCfg.options.investingScale : '3M',
      });
      initRef.current = true;
      return;
    }
    if (!boards.loading) { setPanels(defaultPanels(boards.rows)); initRef.current = true; }
  }, [settings, savedPanels, savedCfg, boards.loading, boards.rows]);

  const persist = (nextPanels, nextCols, nextOptions) => {
    if (!user?.id) return;
    const config = {
      dashboard_widgets: {
        v: 5,
        panels: nextPanels ?? panels ?? [],
        cols: nextCols ?? cols,
        options: nextOptions ?? options,
      },
    };
    // Preserve click/drag order so an earlier, slower request cannot overwrite
    // a newer dashboard choice.
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => saveUserSettings(user.id, config))
      .catch(() => {});
  };

  const updatePanel = (i, patch) => setPanels((prev) => { const next = (prev || []).map((p, j) => (j === i ? { ...p, ...patch } : p)); persist(next); return next; });
  const addPanel = () => setPanels((prev) => { const next = [...(prev || []), oneBoardPanel(boards.rows)]; persist(next); return next; });
  const removePanel = (i) => setPanels((prev) => { const next = (prev || []).filter((_, j) => j !== i); persist(next); return next; });
  const updateOption = (key, value) => setOptions((prev) => {
    const next = { ...prev, [key]: value };
    persist(undefined, undefined, next);
    return next;
  });

  // Drag a divider to resize columns (divider 0 = left|middle, 1 = middle|right).
  const startResize = (idx) => (e) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev) => {
      const pctX = ((ev.clientX - rect.left) / rect.width) * 100;
      setCols(([c1, c2]) =>
        idx === 0 ? [clamp(pctX, 18, 100 - c2 - 18), c2] : [c1, clamp(pctX - c1, 18, 100 - c1 - 18)]
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setCols((c) => { persist(undefined, c); return c; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const shownPanels = panels || [];

  return (
    <div className="fade-in dash2-page">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="dash-greeting">{greeting(now)}, {displayName}</div>
          <div className="dash-clock">{formatLongDate(now)} · {formatClock(now)}</div>
        </div>
      </div>

      <div className="dash2" ref={containerRef} style={{ '--c1': `${cols[0]}%`, '--c2': `${cols[1]}%` }}>
        {/* Left — boards */}
        <div className="dash2-surface dash2-col1">
          {shownPanels.map((p, i) => (
            <BoardPanel
              key={i}
              boards={boards.rows}
              tasks={tasks}
              panel={p}
              onChange={(patch) => updatePanel(i, patch)}
              onRemove={() => removePanel(i)}
              canRemove={shownPanels.length > 1}
            />
          ))}
          <button className="dash2-add" onClick={addPanel}>
            <i className="ti ti-plus" /> Add board
          </button>
        </div>

        <div className="dash2-divider" onPointerDown={startResize(0)} title="Drag to resize" />

        {/* Middle — investing + youtube */}
        <div className="dash2-surface dash2-col2">
          <InvestingPanel scale={options.investingScale} onScaleChange={(value) => updateOption('investingScale', value)} />
          <YouTubePanel />
        </div>

        <div className="dash2-divider" onPointerDown={startResize(1)} title="Drag to resize" />

        {/* Right — habits + health */}
        <div className="dash2-surface dash2-col3">
          <HabitsGridPanel habits={habitRows} logs={habitLogs} />
          <HabitsTrendPanel
            habits={habitRows}
            logs={habitLogs.rows}
            range={options.habitRange}
            onRangeChange={(value) => updateOption('habitRange', value)}
          />
          <LifeProgressPanel />
          <MacrosPanel logs={nutrition} goalRow={goals[0]} />
          <SupplementsPanel supplements={supplements} />
          <FitnessPanel schedule={fitness} />
        </div>
      </div>
    </div>
  );
}
