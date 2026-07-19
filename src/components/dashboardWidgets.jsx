// ============================================================
// CTRLpanel — Dashboard widget registry
// Each widget is a self-contained component that fetches its own per-user
// data and renders a Card. Widgets receive `cfg` (their saved per-instance
// settings — view mode, board filter, …) and `onCfg(patch)` which merges and
// persists changes to user_settings.dashboard_widgets alongside the layout.
// ============================================================
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import Card from './shared/Card.jsx';
import Badge from './shared/Badge.jsx';
import QuickAdd from './QuickAdd.jsx';
import { useRows, useCrud } from '../lib/useData.js';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useAuth } from './AuthProvider.jsx';
import { gcal } from '../lib/api.js';
import { queryTable } from '../lib/supabase.js';
import { CATEGORY_META } from '../pages/reports/MailTriage.jsx';
import { compactCurrency, currency, relativeDay, formatDate, lifeStats } from '../lib/helpers.js';

const todayKey = () => new Date().toISOString().slice(0, 10);
const dayKey = (d) => d.toISOString().slice(0, 10);
const evTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const lastNDays = (n) =>
  Array.from({ length: n }).map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return d; });

/* ---- Chart chrome (dark surface #141010) ----
   Categorical palette: brand hues stepped for the dark surface, ordered for
   max adjacent CVD separation (validated, worst adjacent ΔE 14.5). Donuts and
   multi-series charts always pair color with a direct label. */
const CHART_COLORS = ['#3b82f6', '#d97706', '#ec4899', '#059669', '#8b5cf6', '#e11d48', '#0d9488'];
const PRIORITY_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };
const TIP_STYLE = { background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 };
const BAR_CURSOR = { fill: 'rgba(255, 255, 255, 0.04)' };
const axisProps = { stroke: '#8a7070', fontSize: 10, tickLine: false, axisLine: false };
const accentColor = () =>
  (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#e11d48').trim() || '#e11d48';

// Calendar events from the same source the Calendar page shows:
// Google (all calendars) when connected, else the local Supabase table.
function useCalendarEvents() {
  const { rows: localRows } = useRows('calendar_events', []);
  const [gEvents, setGEvents] = useState(null); // null → Google not connected
  useEffect(() => {
    let on = true;
    gcal
      .status()
      .then((s) => (s.connected ? gcal.list() : null))
      .then((r) => { if (on && r) setGEvents(r.events || []); })
      .catch(() => {});
    return () => { on = false; };
  }, []);
  return gEvents ?? localRows;
}

/* ---- Shared widget chrome ---- */
function Shell({ title, meta, tools, flex, children }) {
  return (
    <Card className={`card-section widget-card ${flex ? 'widget-card--flex' : ''}`} static>
      <div className="card-section-title">
        <span>{title}{meta && <span className="widget-title-meta"> · {meta}</span>}</span>
        {tools && <div className="widget-tools">{tools}</div>}
      </div>
      {children}
    </Card>
  );
}

// Compact icon segmented control for switching a widget's view mode.
function ViewSwitch({ views, value, onChange }) {
  return (
    <div className="segmented segmented--xs">
      {views.map((v) => (
        <button key={v.id} className={value === v.id ? 'active' : ''} title={v.label} onClick={() => onChange(v.id)}>
          <i className={`ti ${v.icon}`} />
        </button>
      ))}
    </div>
  );
}

function OpenLink({ to, title = 'Open page' }) {
  const navigate = useNavigate();
  return (
    <button className="btn btn--ghost btn--icon" onClick={() => navigate(to)} title={title}>
      <i className="ti ti-arrow-up-right" />
    </button>
  );
}

function ChartBox({ children }) {
  return (
    <div className="widget-chart">
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

function Empty({ children }) {
  return <p className="body-text">{children}</p>;
}

// Donut + always-visible legend (identity is never color-alone).
function Donut({ data, colors, format = (v) => v }) {
  return (
    <div className="donut-wrap">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip contentStyle={TIP_STYLE} formatter={(v) => format(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="donut-legend">
        {data.map((d, i) => (
          <div className="donut-legend-row" key={d.name}>
            <span className="list-row-dot" style={{ background: colors[i % colors.length] }} />
            <span className="donut-legend-name">{d.name}</span>
            <span className="donut-legend-value">{format(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, meta, tools }) {
  return (
    <Card className="stat-card" static>
      <div className="stat-card-head">
        <span className="section-label">{label}</span>
        <div className="widget-tools">
          {tools}
          <i className={`ti ${icon}`} />
        </div>
      </div>
      <div className="stat-card-value">{value}</div>
      {meta && <div className="stat-card-meta">{meta}</div>}
    </Card>
  );
}

const STAT_CHART_VIEWS = (chartIcon, chartLabel) => [
  { id: 'stat', icon: 'ti-number-123', label: 'Number' },
  { id: 'chart', icon: chartIcon, label: chartLabel },
];

/* ---- Stat widgets (each with an optional chart view) ---- */
function NetWorthW({ cfg = {}, onCfg = () => {} }) {
  const { rows } = useRows('accounts', []);
  const { rows: snaps } = useRows('net_worth_snapshots', [], 'snapshot_date');
  const view = cfg.view || 'stat';
  const nw = rows.reduce((s, a) => s + (a.type === 'Liability' ? -Number(a.balance || 0) : Number(a.balance || 0)), 0);
  const tools = <ViewSwitch views={STAT_CHART_VIEWS('ti-chart-area-line', 'Trend')} value={view} onChange={(v) => onCfg({ view: v })} />;

  if (view === 'chart') {
    const data = snaps.map((s) => ({ date: formatDate(s.snapshot_date), total: Number(s.total) }));
    const ac = accentColor();
    return (
      <Shell flex title="Net Worth" meta={compactCurrency(nw)} tools={tools}>
        {data.length < 2 ? (
          <Empty>Save snapshots on the Net Worth page to build a trend.</Empty>
        ) : (
          <ChartBox>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="wg-nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ac} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ac} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e1818" vertical={false} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v) => compactCurrency(v)} width={54} />
              <Tooltip contentStyle={TIP_STYLE} formatter={(v) => currency(v)} />
              <Area type="monotone" dataKey="total" name="Net worth" stroke={ac} strokeWidth={2} fill="url(#wg-nw)" />
            </AreaChart>
          </ChartBox>
        )}
      </Shell>
    );
  }
  return <Stat icon="ti-wallet" label="Net Worth" value={compactCurrency(nw)} meta={`${rows.length} accounts`} tools={tools} />;
}

function OpenTasksW() {
  const { rows } = useRows('tasks', []);
  return <Stat icon="ti-checkbox" label="Open Tasks" value={rows.filter((t) => t.column_name !== 'Done').length} meta="to do" />;
}

function CaloriesW({ cfg = {}, onCfg = () => {} }) {
  const { rows: n } = useRows('nutrition_logs', []);
  const { rows: g } = useRows('user_goals', []);
  const view = cfg.view || 'stat';
  const goal = g[0]?.calories || 2400;
  const calsOn = (key) => n.filter((x) => (x.logged_at || '').slice(0, 10) === key).reduce((s, x) => s + Number(x.calories || 0), 0);
  const tools = <ViewSwitch views={STAT_CHART_VIEWS('ti-chart-bar', 'Last 7 days')} value={view} onChange={(v) => onCfg({ view: v })} />;

  if (view === 'chart') {
    const data = lastNDays(7).map((d) => ({
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      calories: Math.round(calsOn(dayKey(d))),
    }));
    return (
      <Shell flex title="Calories" meta={`goal ${goal.toLocaleString()}`} tools={tools}>
        <ChartBox>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="day" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={TIP_STYLE} cursor={BAR_CURSOR} />
            <ReferenceLine y={goal} stroke="#f59e0b" strokeDasharray="4 4" />
            <Bar dataKey="calories" name="Calories" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ChartBox>
      </Shell>
    );
  }
  const cal = calsOn(todayKey());
  return <Stat icon="ti-flame" label="Calories Today" value={Math.round(cal).toLocaleString()} meta={`of ${goal.toLocaleString()}`} tools={tools} />;
}

function ActiveAgentsW() {
  const { agents } = useWorkspace();
  return <Stat icon="ti-robot" label="Active Agents" value={`${agents.rows.filter((a) => a.status === 'running').length} / ${agents.rows.length}`} meta="running" />;
}

function PortfolioW({ cfg = {}, onCfg = () => {} }) {
  const { rows } = useRows('holdings', []);
  const view = cfg.view || 'stat';
  const valued = rows.map((h) => ({ name: h.ticker || '—', value: Number(h.shares || 0) * Number(h.manual_price || h.avg_cost || 0) }));
  const total = valued.reduce((s, h) => s + h.value, 0);
  const tools = <ViewSwitch views={STAT_CHART_VIEWS('ti-chart-donut', 'Allocation')} value={view} onChange={(v) => onCfg({ view: v })} />;

  if (view === 'chart') {
    const sorted = valued.filter((h) => h.value > 0).sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6).reduce((s, h) => s + h.value, 0);
    const data = rest > 0 ? [...top, { name: 'Other', value: rest }] : top;
    return (
      <Shell flex title="Portfolio" meta={compactCurrency(total)} tools={tools}>
        {data.length === 0 ? <Empty>No holdings yet.</Empty> : <Donut data={data} colors={CHART_COLORS} format={(v) => compactCurrency(v)} />}
      </Shell>
    );
  }
  return <Stat icon="ti-chart-pie" label="Portfolio" value={compactCurrency(total)} meta={`${rows.length} holdings`} tools={tools} />;
}

function BudgetW({ cfg = {}, onCfg = () => {} }) {
  const { rows: inc } = useRows('income_sources', []);
  const { rows: tx } = useRows('transactions', []);
  const { rows: cats } = useRows('expense_categories', []);
  const view = cfg.view || 'stat';
  const now = new Date();
  const monthTx = tx.filter((t) => { const d = new Date(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const income = inc.reduce((s, i) => s + Number(i.amount || 0), 0);
  const spent = monthTx.reduce((s, t) => s + Number(t.amount || 0), 0);
  const tools = <ViewSwitch views={STAT_CHART_VIEWS('ti-chart-bar', 'By category')} value={view} onChange={(v) => onCfg({ view: v })} />;

  if (view === 'chart') {
    const perCat = cats
      .map((c) => ({
        name: c.name,
        spent: monthTx.filter((t) => t.category_id === c.id).reduce((s, t) => s + Number(t.amount || 0), 0),
        budgeted: Number(c.budgeted || 0),
      }))
      .filter((c) => c.spent > 0 || c.budgeted > 0)
      .sort((a, b) => b.spent - a.spent);
    return (
      <Shell title="Spending" meta="this month" tools={tools}>
        {perCat.length === 0 ? (
          <Empty>No categories or transactions this month.</Empty>
        ) : (
          perCat.map((c) => {
            const over = c.budgeted > 0 && c.spent > c.budgeted;
            const pct = c.budgeted > 0 ? Math.min((c.spent / c.budgeted) * 100, 100) : 100;
            return (
              <div className="bar-list-row" key={c.name}>
                <div className="spread">
                  <span className="bar-list-name">{c.name}</span>
                  <span className="list-row-meta">
                    {compactCurrency(c.spent)}{c.budgeted > 0 && ` / ${compactCurrency(c.budgeted)}`}
                  </span>
                </div>
                <div className="progress"><div className="progress-fill" style={{ width: `${pct}%`, background: over ? '#ef4444' : '#3b82f6' }} /></div>
              </div>
            );
          })
        )}
      </Shell>
    );
  }
  return <Stat icon="ti-coin" label="Budget Left" value={compactCurrency(income - spent)} meta="this month" tools={tools} />;
}

/* ---- List / calendar widgets ---- */
function EventRow({ e, showDate }) {
  return (
    <div className="list-row">
      <span className="list-row-time">
        {showDate
          ? new Date(e.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : e.all_day ? 'all-day' : evTime(e.starts_at)}
      </span>
      <span className="list-row-dot" style={{ background: e.color }} />
      <span className="list-row-title">{e.title}</span>
      {e.calendar && <span className="list-row-meta">{e.calendar}</span>}
    </div>
  );
}

function ScheduleW() {
  const events = useCalendarEvents();
  const t = events
    .filter((e) => (e.starts_at || '').slice(0, 10) === todayKey())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return (
    <Shell title="Today's Schedule" tools={<OpenLink to="/calendar" />}>
      {t.length === 0 && <Empty>Nothing scheduled today.</Empty>}
      {t.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} />)}
    </Shell>
  );
}

function UpcomingW() {
  const events = useCalendarEvents();
  const up = events
    .filter((e) => new Date(e.ends_at || e.starts_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 8);
  return (
    <Shell title="Upcoming Events" tools={<OpenLink to="/calendar" />}>
      {up.length === 0 && <Empty>No upcoming events.</Empty>}
      {up.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} showDate />)}
    </Shell>
  );
}

// Calendar widget: Agenda (day-grouped upcoming), Week (7-day strip + day
// detail), Month (mini grid + day detail). Clicking a day previews it in
// place instead of leaving the dashboard.
const CAL_VIEWS = [
  { id: 'agenda', icon: 'ti-list-details', label: 'Agenda' },
  { id: 'week', icon: 'ti-calendar-week', label: 'Week' },
  { id: 'month', icon: 'ti-calendar-month', label: 'Month' },
];
const LEGACY_CAL = { Today: 'agenda', Week: 'week', Month: 'month' };

function CalendarW({ cfg = {}, onCfg = () => {} }) {
  const events = useCalendarEvents();
  const view = cfg.view || LEGACY_CAL[localStorage.getItem('ctrlpanel-cal-widget')] || 'agenda';
  const [selDay, setSelDay] = useState(todayKey());

  const now = new Date();
  const eventsOn = (key) => events
    .filter((e) => (e.starts_at || '').slice(0, 10) === key)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

  const dayDetail = (key) => {
    const list = eventsOn(key);
    return (
      <div className="cal-day-detail">
        {list.length === 0 && <Empty>{key === todayKey() ? 'Nothing scheduled today.' : 'Nothing scheduled.'}</Empty>}
        {list.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} />)}
      </div>
    );
  };

  let body = null;
  if (view === 'agenda') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const up = events
      .filter((e) => new Date(e.ends_at || e.starts_at) >= start)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      .slice(0, 14);
    const byDay = up.reduce((m, e) => {
      const k = (e.starts_at || '').slice(0, 10);
      (m[k] = m[k] || []).push(e);
      return m;
    }, {});
    const keys = Object.keys(byDay).sort();
    body = keys.length === 0
      ? <Empty>No upcoming events.</Empty>
      : keys.map((k) => (
          <div key={k}>
            <div className="cal-group-label">
              {k === todayKey() ? 'Today' : new Date(`${k}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            {byDay[k].map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} />)}
          </div>
        ));
  } else if (view === 'week') {
    const days = Array.from({ length: 7 }).map((_, i) => { const d = new Date(now); d.setDate(now.getDate() + i); return d; });
    body = (
      <>
        <div className="week-strip">
          {days.map((d) => {
            const k = dayKey(d);
            const list = eventsOn(k);
            return (
              <button
                key={k}
                className={`week-strip-day ${k === selDay ? 'sel' : ''} ${k === todayKey() ? 'today' : ''}`}
                onClick={() => setSelDay(k)}
              >
                <span className="week-strip-dow">{d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}</span>
                <span className="week-strip-num">{d.getDate()}</span>
                <span className="mini-cal-dots">
                  {list.slice(0, 3).map((e, j) => <span className="mini-cal-dot" key={j} style={{ background: e.color || 'var(--accent)' }} />)}
                </span>
              </button>
            );
          })}
        </div>
        {dayDetail(selDay)}
      </>
    );
  } else {
    // Mini month grid; clicking a day previews its events below.
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOffset = new Date(year, month, 1).getDay();
    const cells = Array.from({ length: 42 }).map((_, i) => new Date(year, month, i - startOffset + 1));
    body = (
      <>
        <div className="mini-cal">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div className="mini-cal-dow" key={i}>{d}</div>)}
          {cells.map((d, i) => {
            const k = dayKey(d);
            const list = eventsOn(k);
            const isToday = k === todayKey();
            return (
              <div
                key={i}
                className={`mini-cal-day ${d.getMonth() !== month ? 'dim' : ''} ${isToday ? 'today' : ''} ${k === selDay ? 'sel' : ''}`}
                onClick={() => setSelDay(k)}
                title={list.map((e) => e.title).join(', ')}
              >
                {d.getDate()}
                {list.length > 0 && (
                  <span className="mini-cal-dots">
                    {list.slice(0, 3).map((e, j) => <span className="mini-cal-dot" key={j} style={{ background: isToday ? '#fff' : e.color }} />)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {dayDetail(selDay)}
      </>
    );
  }

  return (
    <Shell
      title="Calendar"
      meta={now.toLocaleDateString('en-US', { month: 'long' })}
      tools={
        <>
          <ViewSwitch views={CAL_VIEWS} value={view} onChange={(v) => onCfg({ view: v })} />
          <OpenLink to="/calendar" title="Open Calendar" />
        </>
      }
    >
      {body}
    </Shell>
  );
}

/* ---- Tasks widget: pick a board, view as list / column chart / priority donut ---- */
const TASK_VIEWS = [
  { id: 'list', icon: 'ti-list', label: 'List' },
  { id: 'columns', icon: 'ti-chart-bar', label: 'By column' },
  { id: 'priority', icon: 'ti-chart-donut', label: 'By priority' },
];
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

function TasksW({ cfg = {}, onCfg = () => {} }) {
  const { todoBoards } = useWorkspace();
  const { rows } = useRows('tasks', []);
  const view = cfg.view || 'list';
  const boardId = cfg.board || '';
  const board = todoBoards.rows.find((b) => b.id === boardId) || null;
  const tasks = board ? rows.filter((t) => t.board_id === board.id) : rows;
  const open = tasks.filter((t) => t.column_name !== 'Done');

  let body;
  if (view === 'columns') {
    const cols = board?.columns || [...new Set(tasks.map((t) => t.column_name).filter(Boolean))];
    const data = cols.map((c) => ({ name: c, tasks: tasks.filter((t) => t.column_name === c).length }));
    body = data.length === 0 ? (
      <Empty>No tasks yet.</Empty>
    ) : (
      <ChartBox>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
          <CartesianGrid stroke="#1e1818" vertical={false} />
          <XAxis dataKey="name" {...axisProps} interval={0} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip contentStyle={TIP_STYLE} cursor={BAR_CURSOR} />
          <Bar dataKey="tasks" name="Tasks" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={30} />
        </BarChart>
      </ChartBox>
    );
  } else if (view === 'priority') {
    const data = ['High', 'Medium', 'Low']
      .map((p) => ({ name: p, value: open.filter((t) => (t.priority || 'Medium') === p).length }))
      .filter((d) => d.value > 0);
    body = data.length === 0
      ? <Empty>No open tasks.</Empty>
      : <Donut data={data} colors={data.map((d) => PRIORITY_COLORS[d.name])} />;
  } else {
    const list = [...open].sort((a, b) => {
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return new Date(a.due_date) - new Date(b.due_date);
      if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1;
      return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    });
    const boardName = (t) => todoBoards.rows.find((b) => b.id === t.board_id)?.name;
    body = (
      <>
        {list.length === 0 && <Empty>No open tasks.</Empty>}
        {list.map((t) => (
          <div className="list-row" key={t.id}>
            <Badge variant={t.priority}>{t.priority}</Badge>
            <span className="list-row-title">{t.title}</span>
            {!board && boardName(t) && <span className="list-row-meta">{boardName(t)}</span>}
            {t.due_date && <span className="list-row-meta">{relativeDay(t.due_date)}</span>}
          </div>
        ))}
      </>
    );
  }

  return (
    <Shell
      flex={view !== 'list'}
      title="Tasks"
      meta={`${open.length} open`}
      tools={
        <>
          {todoBoards.rows.length > 0 && (
            <select className="select select--xs" value={boardId} onChange={(e) => onCfg({ board: e.target.value })} title="Choose board">
              <option value="">All boards</option>
              {todoBoards.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <ViewSwitch views={TASK_VIEWS} value={view} onChange={(v) => onCfg({ view: v })} />
          <OpenLink to="/todo" title="Open To Do" />
        </>
      }
    >
      {body}
    </Shell>
  );
}

function AgentsListW() {
  const { agents } = useWorkspace();
  return (
    <Shell title="Agents" tools={<OpenLink to="/agents" />}>
      {agents.rows.length === 0 && <Empty>No agents yet.</Empty>}
      {agents.rows.map((a) => (
        <div className="list-row" key={a.id}>
          <span className={`status-dot ${a.status}`} />
          <span className="list-row-title">{a.name}</span>
          <span className="list-row-meta">{a.status === 'running' ? 'Running' : 'Stopped'}</span>
        </div>
      ))}
    </Shell>
  );
}

function QuickAddW() {
  return (
    <Shell title="Quick Add">
      <QuickAdd />
    </Shell>
  );
}

/* ---- Habits: today's checklist or a 7-day completion chart ---- */
const HABIT_VIEWS = [
  { id: 'today', icon: 'ti-list-check', label: 'Today' },
  { id: 'week', icon: 'ti-chart-bar', label: 'Last 7 days' },
];

function HabitsW({ cfg = {}, onCfg = () => {} }) {
  const habits = useCrud('habits', 'created_at');
  const logs = useCrud('habit_logs');
  const view = cfg.view || 'today';
  const today = todayKey();
  const active = habits.rows.filter((h) => h.active !== false);
  const logFor = (hid) => logs.rows.find((l) => l.habit_id === hid && l.log_date === today);
  const toggle = (h) => {
    const ex = logFor(h.id);
    if (ex) logs.remove(ex.id);
    else logs.add({ habit_id: h.id, log_date: today, completed: true });
  };
  const tools = (
    <>
      <ViewSwitch views={HABIT_VIEWS} value={view} onChange={(v) => onCfg({ view: v })} />
      <OpenLink to="/habits" />
    </>
  );

  if (view === 'week') {
    const activeIds = new Set(active.map((h) => h.id));
    const data = lastNDays(7).map((d) => {
      const k = dayKey(d);
      return {
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        done: logs.rows.filter((l) => l.log_date === k && activeIds.has(l.habit_id)).length,
      };
    });
    return (
      <Shell flex title="Habits" meta={`${active.length} active`} tools={tools}>
        <ChartBox>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="day" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} domain={[0, Math.max(active.length, 1)]} />
            <Tooltip contentStyle={TIP_STYLE} cursor={BAR_CURSOR} />
            {active.length > 0 && <ReferenceLine y={active.length} stroke="#f59e0b" strokeDasharray="4 4" />}
            <Bar dataKey="done" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ChartBox>
      </Shell>
    );
  }
  return (
    <Shell title="Habits Today" tools={tools}>
      {active.length === 0 && <Empty>No habits yet. Add them on the Habits page.</Empty>}
      {active.map((h) => {
        const done = !!logFor(h.id);
        return (
          <div className="checklist-item" key={h.id} onClick={() => toggle(h)}>
            <div className={`check-box ${done ? 'checked' : ''}`}>{done && <i className="ti ti-check" style={{ fontSize: 12 }} />}</div>
            <span className="list-row-title" style={{ textDecoration: done ? 'line-through' : 'none' }}>{h.name}</span>
          </div>
        );
      })}
    </Shell>
  );
}

/* ---- Macros: today's progress bars or a 7-day calories chart ---- */
const MACRO_VIEWS = [
  { id: 'today', icon: 'ti-progress', label: 'Today' },
  { id: 'week', icon: 'ti-chart-bar', label: 'Last 7 days' },
];

function NutritionW({ cfg = {}, onCfg = () => {} }) {
  const { rows: n } = useRows('nutrition_logs', []);
  const { rows: g } = useRows('user_goals', []);
  const view = cfg.view || 'today';
  const goals = { calories: 2400, protein: 180, carbs: 250, fat: 80, ...(g[0] || {}) };
  const tools = (
    <>
      <ViewSwitch views={MACRO_VIEWS} value={view} onChange={(v) => onCfg({ view: v })} />
      <OpenLink to="/health/nutrition" />
    </>
  );

  if (view === 'week') {
    const data = lastNDays(7).map((d) => {
      const k = dayKey(d);
      const logs = n.filter((x) => (x.logged_at || '').slice(0, 10) === k);
      return {
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        calories: Math.round(logs.reduce((s, x) => s + Number(x.calories || 0), 0)),
        protein: Math.round(logs.reduce((s, x) => s + Number(x.protein || 0), 0)),
      };
    });
    return (
      <Shell flex title="Nutrition" meta={`goal ${goals.calories.toLocaleString()} cal`} tools={tools}>
        <ChartBox>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="day" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={TIP_STYLE} cursor={BAR_CURSOR} />
            <ReferenceLine y={goals.calories} stroke="#f59e0b" strokeDasharray="4 4" />
            <Bar dataKey="calories" name="Calories" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ChartBox>
      </Shell>
    );
  }

  const today = todayKey();
  const tot = n.filter((x) => (x.logged_at || '').slice(0, 10) === today).reduce(
    (t, m) => ({ calories: t.calories + Number(m.calories || 0), protein: t.protein + Number(m.protein || 0), carbs: t.carbs + Number(m.carbs || 0), fat: t.fat + Number(m.fat || 0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const bar = (label, cur, goal, color) => (
    <div className="bar-list-row" key={label}>
      <div className="spread"><span className="list-row-meta">{label}</span><span className="list-row-meta">{Math.round(cur)}/{goal}</span></div>
      <div className="progress"><div className="progress-fill" style={{ width: `${Math.min((cur / goal) * 100, 100)}%`, background: color }} /></div>
    </div>
  );
  return (
    <Shell title="Macros Today" tools={tools}>
      {bar('Calories', tot.calories, goals.calories, '#e11d48')}
      {bar('Protein', tot.protein, goals.protein, '#3b82f6')}
      {bar('Carbs', tot.carbs, goals.carbs, '#f59e0b')}
      {bar('Fat', tot.fat, goals.fat, '#10b981')}
    </Shell>
  );
}

// Latest Email Triage brief roll-up: counts per category + top items that
// need a reply, linking into Reports → Mail Triage.
function MailTriageW() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState({ run: null, items: [], loaded: false });

  useEffect(() => {
    let on = true;
    (async () => {
      const { data: runs } = await queryTable('triage_runs', { order: 'run_at', ascending: false, limit: 1 });
      const run = runs?.[0] || null;
      let items = [];
      if (run) {
        const res = await queryTable('triage_items', { filters: { run_id: run.id }, limit: 400 });
        items = res.data || [];
      }
      if (on) setBrief({ run, items, loaded: true });
    })();
    return () => { on = false; };
  }, []);

  const { run, items, loaded } = brief;
  const needsReply = items.filter((i) => i.category === 'needs_reply');

  return (
    <Shell title="Mail Triage" tools={<OpenLink to="/reports/mail" title="Open Mail Triage" />}>
      {!loaded ? (
        <Empty>Loading…</Empty>
      ) : !run ? (
        <Empty>No triage runs yet. Connect Gmail in Settings and arm the Email Triage agent.</Empty>
      ) : (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {Object.entries(CATEGORY_META).map(([c, meta]) => {
              const n = items.filter((i) => i.category === c).length;
              if (!n) return null;
              return (
                <span key={c} className="badge" style={{ color: meta.color, borderColor: meta.color }}>
                  {meta.label}: {n}
                </span>
              );
            })}
            {!items.length && <span className="list-row-meta">Inbox zero — nothing to triage.</span>}
          </div>
          {needsReply.slice(0, 4).map((i) => (
            <div className="list-row" key={i.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/reports/mail')}>
              <span className="list-row-dot" style={{ background: CATEGORY_META.needs_reply.color }} />
              <span className="list-row-title">{i.subject || '(no subject)'}</span>
              <span className="list-row-meta">{i.account_alias}</span>
            </div>
          ))}
          <p className="list-row-meta" style={{ marginTop: 8 }}>
            {new Date(run.run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {run.source}
          </p>
        </>
      )}
    </Shell>
  );
}

function LifeViewW() {
  const { settings } = useAuth();
  const birthdate = settings?.birthdate || localStorage.getItem('ctrlpanel-birthdate');
  const stats = lifeStats(birthdate, settings?.life_expectancy || 90);
  return (
    <Shell title="Life View" tools={<OpenLink to="/habits" />}>
      {!stats ? (
        <Empty>Set your birthdate on the Habits → Life View page.</Empty>
      ) : (
        <>
          <div className="spread">
            <span className="value-md">{stats.ageYears} yrs</span>
            <span className="list-row-meta">{stats.pctLived.toFixed(1)}% lived</span>
          </div>
          <div className="life-widget-bar mt-16"><div className="life-widget-fill" style={{ width: `${stats.pctLived}%` }} /></div>
          <div className="list-row-meta mt-16">{stats.daysRemaining.toLocaleString()} days remaining (~{Math.round(stats.daysRemaining / 365)} yrs)</div>
        </>
      )}
    </Shell>
  );
}

// Each widget carries a default size in grid units (board is 12 columns wide;
// one row unit ≈ 84px). Users can resize/move freely; these are starting sizes.
// `hidden` entries stay renderable (legacy layouts) but are left out of the picker.
export const WIDGETS = [
  { id: 'net_worth', title: 'Net Worth', icon: 'ti-wallet', Component: NetWorthW, w: 2, h: 1 },
  { id: 'open_tasks', title: 'Open Tasks', icon: 'ti-checkbox', Component: OpenTasksW, w: 2, h: 1 },
  { id: 'calories', title: 'Calories', icon: 'ti-flame', Component: CaloriesW, w: 2, h: 1 },
  { id: 'active_agents', title: 'Active Agents', icon: 'ti-robot', Component: ActiveAgentsW, w: 2, h: 1 },
  { id: 'portfolio', title: 'Portfolio Value', icon: 'ti-chart-pie', Component: PortfolioW, w: 2, h: 1 },
  { id: 'budget', title: 'Budget', icon: 'ti-coin', Component: BudgetW, w: 2, h: 1 },
  { id: 'tasks', title: 'Tasks', icon: 'ti-checkbox', Component: TasksW, w: 4, h: 3 },
  { id: 'calendar_view', title: 'Calendar', icon: 'ti-calendar-month', Component: CalendarW, w: 4, h: 4 },
  { id: 'schedule', title: "Today's Schedule", icon: 'ti-calendar', Component: ScheduleW, w: 3, h: 3 },
  { id: 'upcoming', title: 'Upcoming Events', icon: 'ti-calendar-event', Component: UpcomingW, w: 3, h: 3 },
  { id: 'priorities', title: 'Top Priorities', icon: 'ti-flag', Component: TasksW, w: 4, h: 3, hidden: true },
  { id: 'agents_list', title: 'Agents List', icon: 'ti-robot', Component: AgentsListW, w: 3, h: 2 },
  { id: 'quick_add', title: 'Quick Add', icon: 'ti-plus', Component: QuickAddW, w: 4, h: 2 },
  { id: 'habits', title: 'Habits', icon: 'ti-repeat', Component: HabitsW, w: 3, h: 3 },
  { id: 'nutrition', title: 'Macros', icon: 'ti-salad', Component: NutritionW, w: 3, h: 3 },
  { id: 'life_view', title: 'Life View', icon: 'ti-hourglass', Component: LifeViewW, w: 3, h: 2 },
  { id: 'mail_triage', title: 'Mail Triage', icon: 'ti-mailbox', Component: MailTriageW, w: 4, h: 3 },
];

export const WIDGETS_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export function sizeFor(id) {
  const w = WIDGETS_BY_ID[id];
  return { w: w?.w || 3, h: w?.h || 2 };
}

export const DEFAULT_WIDGETS = ['net_worth', 'open_tasks', 'calories', 'active_agents', 'calendar_view', 'tasks', 'quick_add', 'agents_list'];
