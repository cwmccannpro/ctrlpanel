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
import { useState, useEffect, useId, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import KnowledgePanel from './KnowledgePanel.jsx';
import DayPlanPanel from './DayPlanPanel.jsx';
import TaskQuickAdd from './TaskQuickAdd.jsx';
import FinancePanel from './FinancePanel.jsx';
import NutritionPanel from './NutritionPanel.jsx';
import NutritionMacrosPanel from './NutritionMacrosPanel.jsx';
import IndustryProblemsPanel from './IndustryProblemsPanel.jsx';
import InstagramPanel from './InstagramPanel.jsx';
import XPanel from './XPanel.jsx';
import '../styles/dashboardOptions.css';
import '../styles/fitness.css';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from './AuthProvider.jsx';
import { useToast } from './Toaster.jsx';
import { useMasterController } from './MasterController.jsx';
import { projectForTask } from '../lib/links.js';
import { planMyDayPrompt } from '../lib/prompts.js';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useRows, useCrud } from '../lib/useData.js';
import { useTaskDragSource } from '../lib/useTaskDragSource.js';
import { finance, youtube } from '../lib/api.js';
import { KANBAN_COLUMNS, SUPPLEMENT_TIMINGS } from '../lib/mockData.js';
import { planByDay, dayPlan, dayKeyFor, dayLabel, nextDayKey, setsReps, typeColor } from '../lib/fitnessPlan.js';
import {
  relativeDay, formatDate, parseLocalDate, currency, percent, compactCurrency, compactNumber, number, lifeStats, channelLabel,
} from '../lib/helpers.js';
import { RANGES, computeTrend, recentDays, dayKey, currentStreak } from '../lib/habits.js';
import { parseCapture, taskRowFromCapture, doneColumn, readCaptureBoard, writeCaptureBoard } from '../lib/commandPalette.js';

const todayKey = () => dayKey(new Date());
const TIP = { background: 'var(--bg-elevated)', border: '0.5px solid var(--border-bright)', borderRadius: 8, fontSize: 12 };

const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const PRIORITY_COLOR = { Urgent: '#ef4444', High: '#f59e0b', Medium: '#3b82f6', Low: '#10b981' };
const byPriority = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
  String(a.created_at || '').localeCompare(String(b.created_at || ''));

/* ---------- shared bits ---------- */
function PanelTitle({ children, to }) {
  const navigate = useNavigate();
  if (!to) return <div className="dash2-panel-title">{children}</div>;
  return (
    <button className="dash2-panel-title dash2-link" onClick={() => navigate(to)}>{children}</button>
  );
}
const Empty = ({ children }) => <div className="dash2-empty">{children}</div>;

// Marks a task row that already has a time on the Day Plan (dragging it again moves it).
function PlannedMark({ at }) {
  if (!at) return null;
  const when = at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return <i className="ti ti-clock dash2-planned" title={`On your Day Plan · ${when}`} aria-label={`Planned for ${when}`} />;
}

/* ============================================================
   Tasks
   ============================================================ */
function BoardPanel({ cfg = {}, onCfg = () => {} }) {
  const navigate = useNavigate();
  const plan = useTaskDragSource();
  const { user } = useAuth();
  const { todoBoards } = useWorkspace();
  const boardRows = todoBoards.rows;
  const { rows: taskRows } = useRows('tasks', []);
  const boards = boardRows.filter((b) => b.user_id === user?.id && !String(b.id).startsWith('tmp-'));
  const tasks = taskRows.filter((t) => t.user_id === user?.id);
  const board = boards.find((b) => b.id === cfg.board_id) || boards[0] || null;
  const columns = board?.columns?.length ? board.columns : KANBAN_COLUMNS;
  const column = columns.includes(cfg.column) ? cfg.column : columns[0];
  const items = board
    ? tasks.filter((t) => t.board_id === board.id && (t.column_name || columns[0]) === column).sort(byPriority)
    : [];

  return (
    <>
      <div className="dash2-panel-head dash2-panel-head--task">
        <select
          className="dash2-select"
          aria-label="Task board"
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
          aria-label="Task category"
          value={column}
          onChange={(e) => onCfg({ board_id: board?.id, column: e.target.value })}
          disabled={!board}
        >
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="dash2-count">{items.length}</span>
      </div>
      {board && <TaskQuickAdd board={board} column={column} />}
      <div className="dash2-tasks">
        {!board ? (
          <Empty>Create a board in To Do to show it here.</Empty>
        ) : items.length === 0 ? (
          <Empty>Nothing in {column}.</Empty>
        ) : (
          items.map((t) => (
            <div className={`dash2-task ${plan.rowClass(t)}`} key={t.id} onClick={() => navigate(`/todo/${board.id}`)} title={`${t.title}\nDrag onto the Day Plan to give it a time`} {...plan.dragProps(t)}>
              <span className="dash2-dot" style={{ background: PRIORITY_COLOR[t.priority] || 'var(--text-secondary)' }} />
              <span className="dash2-task-title">{t.title}</span>
              <PlannedMark at={plan.plannedAt(t)} />
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
  const plan = useTaskDragSource();
  const { user } = useAuth();
  const { rows: taskRows } = useRows('tasks', []);
  const tasks = taskRows.filter((t) => t.user_id === user?.id);
  const days = Number(cfg.days) || 14;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  const end = new Date(cutoff.getTime() + days * 86400000);

  const items = tasks
    .filter((t) => t.due_date && (t.column_name || '') !== 'Done')
    .filter((t) => {
      const d = parseLocalDate(t.due_date);
      return d <= end;
    })
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .slice(0, 12);

  const overdue = items.filter((t) => parseLocalDate(t.due_date) < cutoff).length;

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
            const late = parseLocalDate(t.due_date) < cutoff;
            return (
              <div className={`dash2-task ${plan.rowClass(t)}`} key={t.id} onClick={() => navigate(t.board_id ? `/todo/${t.board_id}` : '/todo')} title={`${t.title}\nDrag onto the Day Plan to give it a time`} {...plan.dragProps(t)}>
                <span className="dash2-dot" style={{ background: PRIORITY_COLOR[t.priority] || 'var(--text-secondary)' }} />
                <span className="dash2-task-title">{t.title}</span>
                <PlannedMark at={plan.plannedAt(t)} />
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
   Health
   ============================================================ */
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
        <PanelTitle to="/health#nutrition">Weight</PanelTitle>
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
                <CartesianGrid stroke="var(--border)" vertical={false} />
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
  const enabled = supplements.filter((s) => s.enabled !== false);
  const groups = SUPPLEMENT_TIMINGS.map((timing) => ({
    timing,
    items: enabled.filter((s) => (s.timing || 'Morning') === timing),
  })).filter((g) => g.items.length);

  return (
    <>
      <PanelTitle to="/health#supplements">Today’s Stack</PanelTitle>
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

// Today's routine from the weekly plan (Health → Fitness): the split and each exercise's sets × reps.
function FitnessPanel() {
  const { rows: schedule, loading } = useRows('fitness_schedule', []);
  const byDay = planByDay(schedule);
  const today = dayKeyFor();
  const plan = dayPlan(byDay[today]);
  const tomorrow = dayPlan(byDay[nextDayKey(today)]);
  const color = typeColor(plan.type);
  return (
    <>
      <div className="dash2-train-head">
        <PanelTitle to="/health#fitness">Today’s Training · {dayLabel(today)}</PanelTitle>
        {plan.planned && !plan.rest && <span className="dash2-fit-badge" style={{ background: color }}><i className="ti ti-barbell" /> {plan.type}</span>}
      </div>
      {loading ? null : !plan.planned ? (
        <Empty>Nothing planned for today. Set up your week under Health → Fitness.</Empty>
      ) : plan.rest ? (
        <div className="dash2-fit">
          <span className="dash2-fit-badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}><i className="ti ti-bed" /> Rest day</span>
        </div>
      ) : plan.exercises.length === 0 ? (
        <Empty>{plan.type} day — add your exercises under Health → Fitness.</Empty>
      ) : (
        <ol className="dash2-train-list">
          {plan.exercises.map((ex) => (
            <li className="dash2-train-ex" key={ex.id}>
              <span className="dash2-train-name">{ex.name}{ex.weight ? <span className="muted"> · {ex.weight}</span> : null}</span>
              <span className="dash2-train-sets" style={{ color }}>{setsReps(ex)}</span>
            </li>
          ))}
        </ol>
      )}
      {!loading && plan.notes && <p className="dash2-train-next">{plan.notes}</p>}
      {!loading && tomorrow.planned && <div className="dash2-train-next">Tomorrow · {tomorrow.rest ? 'Rest' : tomorrow.type}</div>}
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
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--text-secondary)" fontSize={10} interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--text-secondary)" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={30} />
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
                <span className="dash2-dot" style={{ background: colors[c.lead_temp] || 'var(--text-secondary)' }} />
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

// Top picks from the Opportunities Agent (Agents folder), best fit first.
function OpportunitiesPanel() {
  const navigate = useNavigate();
  const { rows } = useRows('opportunities', []);
  const fresh = rows.filter((o) => o.status === 'new').length;
  const picks = rows
    .filter((o) => o.status === 'new' || o.status === 'saved')
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);
  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/agents/opportunities">Opportunities</PanelTitle>
        {fresh > 0 && <span className="dash2-count">{fresh} new</span>}
      </div>
      <div className="dash2-tasks">
        {picks.length === 0 ? (
          <Empty>No picks yet. Run the Opportunities Agent.</Empty>
        ) : (
          picks.map((o) => (
            <div className="dash2-task" key={o.id} onClick={() => navigate('/agents/opportunities')} title={o.title}>
              <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600, minWidth: 20, flexShrink: 0 }}>{o.score}</span>
              <span className="dash2-task-title">{o.title}</span>
              <span className="dash2-task-meta">{o.org || ''}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function YouTubePanel({ cfg = {}, onCfg = () => {} }) {
  // Channels come from the shared Socials list (one fetch for the whole app).
  const { socials } = useWorkspace();
  const status = { ready: socials.ready, channels: socials.channels, loaded: socials.loaded };
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const gradientId = useId();

  // Socials is modular, so pin this panel to one channel; add a second panel
  // for a second channel. Falls back to the first if the pinned one is gone.
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
        {status.channels.length > 1 && (
          <select className="dash2-select" value={firstId || ''} onChange={(e) => onCfg({ channel_id: e.target.value })}>
            {status.channels.map((c) => <option key={c.id} value={c.id}>{channelLabel(c)}</option>)}
          </select>
        )}
        {first && <span className="dash2-count"><i className="ti ti-users" /> {compactNumber(data?.channel?.subscribers ?? first.subscriber_count ?? 0)}</span>}
      </div>
      {!status.loaded ? (
        <Empty>Loading…</Empty>
      ) : !status.ready ? (
        <Empty>YouTube not configured on the server.</Empty>
      ) : !first ? (
        <Link className="btn btn--sm btn--accent" to="/socials"><i className="ti ti-brand-youtube" /> Connect channel</Link>
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
                    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip contentStyle={TIP} labelFormatter={() => ''} formatter={(v) => [number(v), 'Views']} />
                    <Area type="monotone" dataKey="views" stroke="var(--accent)" strokeWidth={2} fill={`url(#${gradientId})`} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </>
          ) : err || data ? (
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
  const { user } = useAuth();
  const { todoBoards } = useWorkspace();
  const boards = todoBoards.rows.filter((b) => b.user_id === user?.id && !String(b.id).startsWith('tmp-'));
  const board = boards.find((b) => b.id === cfg.board_id) || boards[0] || null;
  const columns = board?.columns?.length ? board.columns : KANBAN_COLUMNS;
  const column = columns.includes(cfg.column) ? cfg.column : columns[0];

  return (
    <>
      <div className="dash2-panel-head dash2-panel-head--wrap">
        <PanelTitle to="/todo">Quick Add</PanelTitle>
      </div>
      {!board ? (
        <Empty>Create a board in To Do first.</Empty>
      ) : (
        <>
          <div className="dash2-panel-head dash2-panel-head--task">
            <select className="dash2-select" aria-label="Quick add board" value={board.id} onChange={(e) => {
              const next = boards.find((b) => b.id === e.target.value);
              onCfg({ board_id: next.id, column: (next.columns?.length ? next.columns : KANBAN_COLUMNS)[0] });
            }}>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="dash2-select" aria-label="Quick add category" value={column} onChange={(e) => onCfg({ board_id: board.id, column: e.target.value })}>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <TaskQuickAdd board={board} column={column} />
        </>
      )}
    </>
  );
}

/* ============================================================
   Today — what needs doing right now, actionable in place
   ============================================================ */
// Overdue + due-today tasks with one-click complete (Undo in the toast) and a
// capture box that understands "@fri" / "!high" and defaults to due today.
function TodayTasksPanel() {
  const navigate = useNavigate();
  const plan = useTaskDragSource();
  const toast = useToast();
  const { send } = useMasterController();
  const { projects } = useWorkspace();
  const { rows: boardRows } = useRows('boards', []);
  const tasks = useCrud('tasks');
  const [text, setText] = useState('');
  const today = dayKey(new Date());
  const boards = boardRows.filter((b) => !String(b.id).startsWith('tmp-'));
  const boardById = Object.fromEntries(boards.map((b) => [b.id, b]));
  const isDone = (t) => {
    const col = t.column_name || '';
    return col === 'Done' || col === doneColumn(boardById[t.board_id]);
  };

  const focus = tasks.rows
    .filter((t) => t.due_date && t.due_date <= today && !isDone(t))
    .sort(
      (a, b) =>
        (a.due_date < today ? 0 : 1) - (b.due_date < today ? 0 : 1) ||
        String(a.due_date).localeCompare(String(b.due_date)) ||
        byPriority(a, b)
    );
  const overdue = focus.filter((t) => t.due_date < today).length;

  const complete = (t) => {
    const from = t.column_name;
    tasks.patch(t.id, { column_name: doneColumn(boardById[t.board_id]) });
    toast({
      message: `Done: ${t.title}`,
      action: { label: 'Undo', onClick: () => tasks.patch(t.id, { column_name: from }) },
    });
  };

  const submit = () => {
    const capture = parseCapture(text);
    if (!capture.title) return;
    const board = boards.find((b) => b.id === readCaptureBoard()) || boards[0] || null;
    tasks.add(taskRowFromCapture(capture, board, today));
    if (board) writeCaptureBoard(board.id);
    setText('');
  };

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/todo">Today</PanelTitle>
        <span className="dash2-count">
          {focus.length ? `${focus.length} left${overdue ? ` · ${overdue} overdue` : ''}` : 'all clear'}
        </span>
        <button className="dash2-ai" onClick={() => send(planMyDayPrompt())} title="Plan my day with the Master Controller" aria-label="Plan my day">
          <i className="ti ti-sparkles" />
        </button>
      </div>
      <div className="dash2-capture">
        <input
          className="input"
          placeholder="Add a task for today…   @fri  !high"
          aria-label="Add a task for today"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <div className="dash2-tasks dash2-tasks--tall">
        {focus.length === 0 ? (
          <Empty>Nothing due today. Add something above, or check Due Soon.</Empty>
        ) : (
          focus.map((t) => {
            const project = projectForTask(t, projects.rows);
            return (
            <div className={`dash2-task ${plan.rowClass(t)}`} key={t.id} {...plan.dragProps(t)}>
              <button className="dash2-check" onClick={() => complete(t)} aria-label={`Mark done: ${t.title}`} title="Mark done">
                <i className="ti ti-check" />
              </button>
              <span className="dash2-dot" style={{ background: PRIORITY_COLOR[t.priority] || 'var(--text-secondary)' }} />
              <span
                className="dash2-task-title"
                onClick={() => navigate(t.board_id ? `/todo/${t.board_id}` : '/todo')}
                title={t.title}
              >
                {t.title}
              </span>
              {project && (
                <button className="dash2-chip" title={`Open project: ${project.name}`} onClick={() => navigate(`/projects/${project.id}`)}>
                  {project.name}
                </button>
              )}
              <PlannedMark at={plan.plannedAt(t)} />
              <span className={`dash2-task-meta ${t.due_date < today ? 'text-red' : ''}`}>{relativeDay(t.due_date)}</span>
            </div>
            );
          })
        )}
      </div>
    </>
  );
}

// Today's habits as a checklist with a progress bar and live streaks.
function TodayHabitsPanel() {
  const { rows: habits } = useRows('habits', []);
  const logs = useCrud('habit_logs');
  const today = dayKey(new Date());
  const active = habits.filter((h) => h.active !== false);
  const logMap = {};
  logs.rows.forEach((l) => { logMap[`${l.habit_id}|${l.log_date}`] = l; });
  const doneOn = (id, dk) => Boolean(logMap[`${id}|${dk}`]?.completed);
  const toggle = (id) => {
    const ex = logMap[`${id}|${today}`];
    if (ex) logs.remove(ex.id);
    else logs.add({ habit_id: id, log_date: today, completed: true });
  };

  // Not-yet-done first; the sort is stable so the user's habit order holds.
  const rows = active
    .map((h) => ({ h, done: doneOn(h.id, today), streak: currentStreak((dk) => doneOn(h.id, dk)) }))
    .sort((a, b) => Number(a.done) - Number(b.done));
  const doneCount = rows.filter((r) => r.done).length;

  return (
    <>
      <div className="dash2-panel-head">
        <PanelTitle to="/habits">Habits Today</PanelTitle>
        <span className="dash2-count">{doneCount}/{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No habits yet. Add them under Habits.</Empty>
      ) : (
        <>
          <div className="dash2-progress" aria-hidden="true">
            <span style={{ width: `${Math.round((doneCount / rows.length) * 100)}%` }} />
          </div>
          <div className="dash2-tasks dash2-tasks--tall">
            {rows.map(({ h, done, streak }) => (
              <div
                className="dash2-task"
                key={h.id}
                role="checkbox"
                aria-checked={done}
                tabIndex={0}
                onClick={() => toggle(h.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(h.id);
                  }
                }}
              >
                <span className={`dash2-check ${done ? 'done' : ''}`}><i className="ti ti-check" /></span>
                <span className={`dash2-task-title ${done ? 'is-done' : ''}`} title={h.name}>{h.name}</span>
                {streak >= 2 && (
                  <span className="dash2-streak" title={`${streak}-day streak`}><i className="ti ti-flame" />{streak}</span>
                )}
              </div>
            ))}
          </div>
          {doneCount === rows.length && <Empty>All done for today.</Empty>}
        </>
      )}
    </>
  );
}

/* ============================================================
   Registry
   ============================================================ */
export const PANELS = [
  // Today
  { id: 'today_tasks', title: 'Today', description: 'Tasks due today, overdue work, and your next priorities.', icon: 'ti-sun', group: 'Today', Component: TodayTasksPanel },
  { id: 'today_habits', title: 'Habits Today', description: 'Tick off today’s habits and see what remains.', icon: 'ti-circle-check', group: 'Today', Component: TodayHabitsPanel },
  { id: 'knowledge', title: 'Knowledge Base', description: 'Pinned notes and recently updated context.', icon: 'ti-notebook', group: 'Work', Component: KnowledgePanel },
  // Tasks & work
  { id: 'board', title: 'Task Board Column', description: 'View a board category and quickly add tasks in place.', icon: 'ti-layout-kanban', group: 'Work', Component: BoardPanel },
  { id: 'upcoming_tasks', title: 'Due Soon', description: 'Upcoming deadlines across all your task boards.', icon: 'ti-alarm', group: 'Work', Component: UpcomingTasksPanel },
  { id: 'quick_add', title: 'Quick Add', description: 'Capture a task without leaving the dashboard.', icon: 'ti-plus', group: 'Work', Component: QuickAddPanel },
  { id: 'schedule', title: 'Day Plan', description: 'Calendar events and draggable task time blocks.', icon: 'ti-timeline-event', group: 'Work', Component: DayPlanPanel },
  { id: 'projects', title: 'Projects', description: 'Active projects, progress, and linked work.', icon: 'ti-folder', group: 'Work', Component: ProjectsPanel },
  { id: 'crm', title: 'CRM Pipeline', description: 'A snapshot of contacts in your CRM pages.', icon: 'ti-users', group: 'Work', Component: CrmPanel },
  { id: 'opportunities', title: 'Opportunities', description: 'Top job, program, and event matches from your agent.', icon: 'ti-target', group: 'Work', Component: OpportunitiesPanel },
  { id: 'industry_problems', title: 'Industry Problems', description: 'Ranked build ideas from your industry research.', icon: 'ti-bulb', group: 'Work', Component: IndustryProblemsPanel },
  // Finance
  { id: 'networth', title: 'Assets', description: 'Account balances and total assets.', icon: 'ti-wallet', group: 'Finance', Component: (props) => <FinancePanel {...props} kind="networth" /> },
  { id: 'cashflow', title: 'Cashflow', description: 'Income, spending, and what remains this month.', icon: 'ti-arrows-exchange', group: 'Finance', Component: (props) => <FinancePanel {...props} kind="cashflow" /> },
  { id: 'budget', title: 'Spending Plan', description: 'Category budgets and actual spending.', icon: 'ti-receipt', group: 'Finance', Component: (props) => <FinancePanel {...props} kind="budget" /> },
  { id: 'investing', title: 'Investments', description: 'Recorded holdings and portfolio allocation.', icon: 'ti-chart-line', group: 'Finance', Component: (props) => <FinancePanel {...props} kind="investing" /> },
  { id: 'finance_reserve', title: 'Cash Reserve', description: 'Cash available and reserve coverage.', icon: 'ti-shield', group: 'Finance', Component: (props) => <FinancePanel {...props} kind="reserve" /> },
  // Health
  { id: 'nutrition', title: 'Nutrition · Complete', description: 'Calories, macros, micronutrients, daily limits, editable targets, and recent meals.', icon: 'ti-tools-kitchen-2', group: 'Health', Component: NutritionPanel },
  { id: 'nutrition_macros', title: 'Nutrition · Macros', description: 'A compact view of calories, protein, carbs, and fat with editable progress targets.', icon: 'ti-chart-bar', group: 'Health', Component: NutritionMacrosPanel },
  { id: 'weight', title: 'Weight', description: 'Recent weigh-ins and your weight trend.', icon: 'ti-scale', group: 'Health', Component: WeightPanel },
  { id: 'supplements', title: 'Supplement Stack', description: 'Your supplements grouped by time of day.', icon: 'ti-pill', group: 'Health', Component: SupplementsPanel },
  { id: 'fitness', title: 'Today’s Training', description: 'Today’s split and exercises, with sets and reps.', icon: 'ti-barbell', group: 'Health', Component: FitnessPanel },
  // Habits
  { id: 'habits_grid', title: 'Habits Week', description: 'A week of habit check-ins at a glance.', icon: 'ti-checkbox', group: 'Habits', Component: HabitsGridPanel },
  { id: 'habits_trend', title: 'Consistency Trend', description: 'Habit completion rates over time.', icon: 'ti-chart-dots', group: 'Habits', Component: HabitsTrendPanel },
  { id: 'life', title: 'Life Progress', description: 'Weeks of life and progress toward your life expectancy.', icon: 'ti-hourglass', group: 'Habits', Component: LifePanel },
  // Socials
  { id: 'youtube', title: 'YouTube', description: 'Channel subscribers, views, and watch hours.', icon: 'ti-brand-youtube', group: 'Socials', Component: YouTubePanel },
  { id: 'instagram', title: 'Instagram', description: 'Account followers, views, reach, and engagement.', icon: 'ti-brand-instagram', group: 'Socials', Component: InstagramPanel },
  { id: 'x', title: 'X', description: 'Account followers and content analytics loaded on request.', icon: 'ti-brand-x', group: 'Socials', Component: XPanel },
];

export const PANELS_BY_ID = Object.fromEntries(PANELS.map((p) => [p.id, p]));

// Layout presets (Customize -> Today layout / Work layout). The Today layout is
// the default for fresh accounts and for dashboards still on the old default.
export const LAYOUTS = {
  today: [
    ['today_tasks', 'upcoming_tasks'],
    ['schedule', 'today_habits'],
    ['projects', 'knowledge', 'opportunities'],
  ],
  work: [
    ['quick_add', 'upcoming_tasks', 'board'],
    ['schedule', 'projects'],
    ['knowledge', 'opportunities', 'crm'],
  ],
};
export const DEFAULT_LAYOUT = LAYOUTS.today;
