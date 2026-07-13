// ============================================================
// CTRLpanel — Dashboard widget registry
// Each widget is a self-contained component that fetches its own per-user
// data and renders a Card. Placed/removed from the Dashboard via the
// Add Widget picker; the layout is saved to user_settings.dashboard_widgets.
// ============================================================
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from './shared/Card.jsx';
import Badge from './shared/Badge.jsx';
import QuickAdd from './QuickAdd.jsx';
import { useRows, useCrud } from '../lib/useData.js';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useAuth } from './AuthProvider.jsx';
import { gcal } from '../lib/api.js';
import { queryTable } from '../lib/supabase.js';
import { CATEGORY_META } from '../pages/reports/MailTriage.jsx';
import { compactCurrency, relativeDay, lifeStats } from '../lib/helpers.js';

const todayKey = () => new Date().toISOString().slice(0, 10);
const dayKey = (d) => d.toISOString().slice(0, 10);
const evTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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

function Stat({ icon, label, value, meta }) {
  return (
    <Card className="stat-card">
      <div className="stat-card-head">
        <span className="section-label">{label}</span>
        <i className={`ti ${icon}`} />
      </div>
      <div className="stat-card-value">{value}</div>
      {meta && <div className="stat-card-meta">{meta}</div>}
    </Card>
  );
}

/* ---- Stat widgets ---- */
function NetWorthW() {
  const { rows } = useRows('accounts', []);
  const nw = rows.reduce((s, a) => s + (a.type === 'Liability' ? -Number(a.balance || 0) : Number(a.balance || 0)), 0);
  return <Stat icon="ti-wallet" label="Net Worth" value={compactCurrency(nw)} meta={`${rows.length} accounts`} />;
}
function OpenTasksW() {
  const { rows } = useRows('tasks', []);
  return <Stat icon="ti-checkbox" label="Open Tasks" value={rows.filter((t) => t.column_name !== 'Done').length} meta="to do" />;
}
function CaloriesW() {
  const { rows: n } = useRows('nutrition_logs', []);
  const { rows: g } = useRows('user_goals', []);
  const goal = g[0]?.calories || 2400;
  const cal = n.filter((x) => (x.logged_at || '').slice(0, 10) === todayKey()).reduce((s, x) => s + Number(x.calories || 0), 0);
  return <Stat icon="ti-flame" label="Calories Today" value={Math.round(cal).toLocaleString()} meta={`of ${goal.toLocaleString()}`} />;
}
function ActiveAgentsW() {
  const { agents } = useWorkspace();
  return <Stat icon="ti-robot" label="Active Agents" value={`${agents.rows.filter((a) => a.status === 'running').length} / ${agents.rows.length}`} meta="running" />;
}
function PortfolioW() {
  const { rows } = useRows('holdings', []);
  const v = rows.reduce((s, h) => s + Number(h.shares || 0) * Number(h.manual_price || h.avg_cost || 0), 0);
  return <Stat icon="ti-chart-pie" label="Portfolio" value={compactCurrency(v)} meta={`${rows.length} holdings`} />;
}
function BudgetW() {
  const { rows: inc } = useRows('income_sources', []);
  const { rows: tx } = useRows('transactions', []);
  const now = new Date();
  const income = inc.reduce((s, i) => s + Number(i.amount || 0), 0);
  const spent = tx
    .filter((t) => { const d = new Date(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  return <Stat icon="ti-coin" label="Budget Left" value={compactCurrency(income - spent)} meta="this month" />;
}

/* ---- List widgets ---- */
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
    <Card className="card-section" static>
      <div className="card-section-title"><span>Today's Schedule</span></div>
      {t.length === 0 && <p className="body-text">Nothing scheduled today.</p>}
      {t.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} />)}
    </Card>
  );
}
function UpcomingW() {
  const events = useCalendarEvents();
  const up = events
    .filter((e) => new Date(e.ends_at || e.starts_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 6);
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Upcoming Events</span></div>
      {up.length === 0 && <p className="body-text">No upcoming events.</p>}
      {up.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} showDate />)}
    </Card>
  );
}

// Calendar widget with switchable views: Today | Week | Month.
const CAL_MODES = ['Today', 'Week', 'Month'];
function CalendarW() {
  const events = useCalendarEvents();
  const navigate = useNavigate();
  const [mode, setMode] = useState(localStorage.getItem('ctrlpanel-cal-widget') || 'Today');
  const pick = (m) => { setMode(m); localStorage.setItem('ctrlpanel-cal-widget', m); };

  const now = new Date();
  const eventsOn = (d) => events.filter((e) => (e.starts_at || '').slice(0, 10) === dayKey(d));

  let body = null;
  if (mode === 'Today') {
    const t = eventsOn(now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    body = t.length
      ? t.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} />)
      : <p className="body-text">Nothing scheduled today.</p>;
  } else if (mode === 'Week') {
    const days = Array.from({ length: 7 }).map((_, i) => { const d = new Date(now); d.setDate(now.getDate() + i); return d; });
    const any = days.some((d) => eventsOn(d).length);
    body = any ? days.map((d, i) => {
      const list = eventsOn(d).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      if (!list.length) return null;
      return (
        <div key={i}>
          <div className="section-label" style={{ margin: '8px 0 2px' }}>
            {i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {list.map((e) => <EventRow key={`${e.cal_id || 'l'}-${e.id}`} e={e} />)}
        </div>
      );
    }) : <p className="body-text">Nothing in the next 7 days.</p>;
  } else {
    // Mini month grid with event dots
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOffset = new Date(year, month, 1).getDay();
    const cells = Array.from({ length: 42 }).map((_, i) => new Date(year, month, i - startOffset + 1));
    body = (
      <div className="mini-cal">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div className="mini-cal-dow" key={i}>{d}</div>)}
        {cells.map((d, i) => {
          const list = eventsOn(d);
          const isToday = dayKey(d) === dayKey(now);
          return (
            <div
              key={i}
              className={`mini-cal-day ${d.getMonth() !== month ? 'dim' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => navigate('/calendar')}
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
    );
  }

  return (
    <Card className="card-section" static>
      <div className="card-section-title">
        <span>Calendar</span>
        <div className="row" style={{ gap: 6 }}>
          <div className="segmented">
            {CAL_MODES.map((m) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => pick(m)}>{m}</button>)}
          </div>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/calendar')} title="Open Calendar">
            <i className="ti ti-arrow-up-right" />
          </button>
        </div>
      </div>
      {body}
    </Card>
  );
}
function PrioritiesW() {
  const { rows } = useRows('tasks', []);
  const p = rows.filter((t) => t.column_name !== 'Done' && t.due_date).sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).slice(0, 5);
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Top Priorities</span></div>
      {p.length === 0 && <p className="body-text">No upcoming tasks.</p>}
      {p.map((t) => (
        <div className="list-row" key={t.id}>
          <Badge variant={t.priority}>{t.priority}</Badge>
          <span className="list-row-title">{t.title}</span>
          <span className="list-row-meta">{relativeDay(t.due_date)}</span>
        </div>
      ))}
    </Card>
  );
}
function AgentsListW() {
  const { agents } = useWorkspace();
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Agents</span></div>
      {agents.rows.length === 0 && <p className="body-text">No agents yet.</p>}
      {agents.rows.map((a) => (
        <div className="list-row" key={a.id}>
          <span className={`status-dot ${a.status}`} />
          <span className="list-row-title">{a.name}</span>
          <span className="list-row-meta">{a.status === 'running' ? 'Running' : 'Stopped'}</span>
        </div>
      ))}
    </Card>
  );
}
function QuickAddW() {
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Quick Add</span></div>
      <QuickAdd />
    </Card>
  );
}
function HabitsW() {
  const habits = useCrud('habits', 'created_at');
  const logs = useCrud('habit_logs');
  const today = todayKey();
  const active = habits.rows.filter((h) => h.active !== false);
  const logFor = (hid) => logs.rows.find((l) => l.habit_id === hid && l.log_date === today);
  const toggle = (h) => {
    const ex = logFor(h.id);
    if (ex) logs.remove(ex.id);
    else logs.add({ habit_id: h.id, log_date: today, completed: true });
  };
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Habits Today</span></div>
      {active.length === 0 && <p className="body-text">No habits yet. Add them on the Habits page.</p>}
      {active.map((h) => {
        const done = !!logFor(h.id);
        return (
          <div className="checklist-item" key={h.id} onClick={() => toggle(h)}>
            <div className={`check-box ${done ? 'checked' : ''}`}>{done && <i className="ti ti-check" style={{ fontSize: 12 }} />}</div>
            <span className="list-row-title" style={{ textDecoration: done ? 'line-through' : 'none' }}>{h.name}</span>
          </div>
        );
      })}
    </Card>
  );
}
function NutritionW() {
  const { rows: n } = useRows('nutrition_logs', []);
  const { rows: g } = useRows('user_goals', []);
  const goals = { calories: 2400, protein: 180, carbs: 250, fat: 80, ...(g[0] || {}) };
  const today = todayKey();
  const tot = n.filter((x) => (x.logged_at || '').slice(0, 10) === today).reduce(
    (t, m) => ({ calories: t.calories + Number(m.calories || 0), protein: t.protein + Number(m.protein || 0), carbs: t.carbs + Number(m.carbs || 0), fat: t.fat + Number(m.fat || 0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const bar = (label, cur, goal, color) => (
    <div style={{ marginBottom: 8 }} key={label}>
      <div className="spread" style={{ marginBottom: 4 }}><span className="list-row-meta">{label}</span><span className="list-row-meta">{Math.round(cur)}/{goal}</span></div>
      <div className="progress"><div className="progress-fill" style={{ width: `${Math.min((cur / goal) * 100, 100)}%`, background: color }} /></div>
    </div>
  );
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Macros Today</span></div>
      {bar('Calories', tot.calories, goals.calories, '#e11d48')}
      {bar('Protein', tot.protein, goals.protein, '#3b82f6')}
      {bar('Carbs', tot.carbs, goals.carbs, '#f59e0b')}
      {bar('Fat', tot.fat, goals.fat, '#10b981')}
    </Card>
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
    <Card className="card-section" static>
      <div className="card-section-title">
        <span>Mail Triage</span>
        <button className="btn btn--ghost btn--icon" onClick={() => navigate('/reports/mail')} title="Open Mail Triage">
          <i className="ti ti-arrow-up-right" />
        </button>
      </div>
      {!loaded ? (
        <p className="body-text">Loading…</p>
      ) : !run ? (
        <p className="body-text">No triage runs yet. Connect Gmail in Settings and arm the Email Triage agent.</p>
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
    </Card>
  );
}

function LifeViewW() {
  const { settings } = useAuth();
  const birthdate = settings?.birthdate || localStorage.getItem('ctrlpanel-birthdate');
  const stats = lifeStats(birthdate, settings?.life_expectancy || 90);
  return (
    <Card className="card-section" static>
      <div className="card-section-title"><span>Life View</span></div>
      {!stats ? (
        <p className="body-text">Set your birthdate on the Habits → Life View page.</p>
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
    </Card>
  );
}

// Each widget carries a default size in grid units (board is 6 columns wide;
// one row unit ≈ 96px). Users can resize/move freely; these are starting sizes.
export const WIDGETS = [
  { id: 'net_worth', title: 'Net Worth', icon: 'ti-wallet', Component: NetWorthW, w: 1, h: 1 },
  { id: 'open_tasks', title: 'Open Tasks', icon: 'ti-checkbox', Component: OpenTasksW, w: 1, h: 1 },
  { id: 'calories', title: 'Calories', icon: 'ti-flame', Component: CaloriesW, w: 1, h: 1 },
  { id: 'active_agents', title: 'Active Agents', icon: 'ti-robot', Component: ActiveAgentsW, w: 1, h: 1 },
  { id: 'portfolio', title: 'Portfolio Value', icon: 'ti-chart-pie', Component: PortfolioW, w: 1, h: 1 },
  { id: 'budget', title: 'Budget Left', icon: 'ti-coin', Component: BudgetW, w: 1, h: 1 },
  { id: 'calendar_view', title: 'Calendar', icon: 'ti-calendar-month', Component: CalendarW, w: 2, h: 4 },
  { id: 'schedule', title: "Today's Schedule", icon: 'ti-calendar', Component: ScheduleW, w: 2, h: 3 },
  { id: 'upcoming', title: 'Upcoming Events', icon: 'ti-calendar-event', Component: UpcomingW, w: 2, h: 3 },
  { id: 'priorities', title: 'Top Priorities', icon: 'ti-flag', Component: PrioritiesW, w: 2, h: 3 },
  { id: 'agents_list', title: 'Agents List', icon: 'ti-robot', Component: AgentsListW, w: 2, h: 3 },
  { id: 'quick_add', title: 'Quick Add', icon: 'ti-plus', Component: QuickAddW, w: 2, h: 2 },
  { id: 'habits', title: 'Habits', icon: 'ti-repeat', Component: HabitsW, w: 2, h: 3 },
  { id: 'nutrition', title: 'Macros', icon: 'ti-salad', Component: NutritionW, w: 2, h: 3 },
  { id: 'life_view', title: 'Life View', icon: 'ti-hourglass', Component: LifeViewW, w: 2, h: 2 },
  { id: 'mail_triage', title: 'Mail Triage', icon: 'ti-mailbox', Component: MailTriageW, w: 2, h: 3 },
];

export const WIDGETS_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export function sizeFor(id) {
  const w = WIDGETS_BY_ID[id];
  return { w: w?.w || 2, h: w?.h || 2 };
}

export const DEFAULT_WIDGETS = ['net_worth', 'open_tasks', 'calories', 'active_agents', 'calendar_view', 'priorities', 'quick_add', 'agents_list'];
