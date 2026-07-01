import { useState, useEffect } from 'react';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import QuickAdd from '../components/QuickAdd.jsx';
import { useMasterController } from '../components/MasterController.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { useRows } from '../lib/useData.js';
import { calendar as calApi } from '../lib/api.js';
import {
  greeting,
  formatClock,
  formatLongDate,
  compactCurrency,
  relativeDay,
} from '../lib/helpers.js';

const CAL_GOAL = 2400;
const todayKey = () => new Date().toISOString().slice(0, 10);

function StatCard({ icon, label, value, meta }) {
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

function ChatBar() {
  const { send } = useMasterController();
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    send(text);
    setText('');
  };
  return (
    <Card className="mc-bar master-controller-input" static>
      <i className="ti ti-sparkles mc-bar-icon" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Ask the Master Controller anything…"
      />
      <button className="mc-send" onClick={submit} disabled={!text.trim()} aria-label="Send">
        <i className="ti ti-arrow-up" />
      </button>
    </Card>
  );
}

export default function Dashboard() {
  const { displayName } = useAuth();
  const [now, setNow] = useState(new Date());
  const [events, setEvents] = useState([]);

  // Per-user data (empty for new accounts)
  const { rows: tasks } = useRows('tasks', []);
  const { rows: agents } = useRows('agents', []);
  const { rows: accounts } = useRows('accounts', []);
  const { rows: nutrition } = useRows('nutrition_logs', []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    calApi.events().then((r) => setEvents(r.events || [])).catch(() => setEvents([]));
  }, []);

  const openTasks = tasks.filter((t) => t.column_name !== 'Done');
  const activeAgents = agents.filter((a) => a.status === 'running');
  const netWorth = accounts.reduce(
    (s, a) => s + (a.type === 'Liability' ? -Number(a.balance || 0) : Number(a.balance || 0)),
    0
  );
  const caloriesToday = nutrition
    .filter((n) => (n.logged_at || '').slice(0, 10) === todayKey())
    .reduce((s, n) => s + Number(n.calories || 0), 0);

  const priorityTasks = [...openTasks]
    .filter((t) => t.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 3);

  const todaysEvents = events.filter((e) => (e.start || '').slice(0, 10) === todayKey());

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="dash-greeting">{greeting(now)}, {displayName}</div>
          <div className="dash-clock">{formatLongDate(now)} · {formatClock(now)}</div>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard icon="ti-wallet" label="Net Worth" value={compactCurrency(netWorth)} meta={accounts.length ? `${accounts.length} accounts` : 'add accounts'} />
        <StatCard icon="ti-checkbox" label="Open Tasks" value={openTasks.length} meta="across all boards" />
        <StatCard icon="ti-flame" label="Calories Today" value={caloriesToday.toLocaleString()} meta={`of ${CAL_GOAL.toLocaleString()} goal`} />
        <StatCard icon="ti-robot" label="Active Agents" value={`${activeAgents.length} / ${agents.length}`} meta="running now" />
      </div>

      <div className="grid grid-2" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card className="card-section" static>
            <div className="card-section-title">
              <span>Today's Schedule</span>
              <span className="muted">{todaysEvents.length} events</span>
            </div>
            {todaysEvents.length === 0 && <p className="body-text">Nothing scheduled today.</p>}
            {todaysEvents.map((e) => (
              <div className="list-row" key={e.id}>
                <span className="list-row-time">{new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="list-row-dot" style={{ background: e.color }} />
                <span className="list-row-title">{e.title}</span>
                <span className="list-row-meta">{e.calendar}</span>
              </div>
            ))}
          </Card>

          <Card className="card-section" static>
            <div className="card-section-title">
              <span>Top Priorities</span>
              <span className="muted">due soonest</span>
            </div>
            {priorityTasks.length === 0 && <p className="body-text">No upcoming tasks. Add some on the To Do board.</p>}
            {priorityTasks.map((t) => (
              <div className="list-row" key={t.id}>
                <Badge variant={t.priority}>{t.priority}</Badge>
                <span className="list-row-title">{t.title}</span>
                <span className="list-row-meta">{relativeDay(t.due_date)}</span>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card className="card-section" static>
            <div className="card-section-title"><span>Quick Add</span></div>
            <QuickAdd />
          </Card>

          <Card className="card-section" static>
            <div className="card-section-title"><span>Agents</span></div>
            {agents.length === 0 && <p className="body-text">No agents yet. Add them on the Agents page.</p>}
            {agents.map((a) => (
              <div className="list-row" key={a.id}>
                <span className={`status-dot ${a.status}`} />
                <span className="list-row-title">{a.name}</span>
                <span className="list-row-meta">{a.status === 'running' ? 'Running' : 'Stopped'}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <ChatBar />
    </div>
  );
}
