import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/shared/Card.jsx';
import Spinner from '../components/shared/Spinner.jsx';
import { useToast } from '../components/Toaster.jsx';
import { useMasterController } from '../components/MasterController.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { useRows, notifyDataChanged } from '../lib/useData.js';
import { useCalendarEvents } from '../lib/useCalendarEvents.js';
import { queryTable } from '../lib/supabase.js';
import { saveNote } from '../lib/knowledge.js';
import { buildReview, delta, reviewNoteTemplate, reviewNoteTitle, rowDay } from '../lib/review.js';
import { projectForTask } from '../lib/links.js';
import { weeklyReviewPrompt } from '../lib/prompts.js';
import { currency } from '../lib/helpers.js';
import '../styles/review.css';

const shortDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const rangeLabel = (from, to) => {
  const f = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  return `${f(from)} – ${f(to)}`;
};

/** ▲/▼ versus the previous week. `good` says which direction is an improvement ('neutral' stays uncoloured). */
function Delta({ current, previous, good = 'up', format = (n) => n, empty = 'no data last week' }) {
  if (previous === null || previous === undefined) return <span className="review-delta review-delta--flat">{empty}</span>;
  const d = delta(current ?? 0, previous);
  const tone = d.dir === 'flat' || good === 'neutral' ? 'flat' : d.dir === good ? 'good' : 'bad';
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•';
  return (
    <span className={`review-delta review-delta--${tone}`}>
      {arrow} {d.dir === 'flat' ? 'same as last week' : `${format(Math.abs(d.diff))} vs last week`}
    </span>
  );
}

function Stat({ label, value, children, to }) {
  const body = (
    <>
      <div className="review-stat-label">{label}</div>
      <div className="review-stat-value">{value}</div>
      <div className="review-stat-foot">{children}</div>
    </>
  );
  return to ? <Link className="review-stat" to={to}>{body}</Link> : <div className="review-stat">{body}</div>;
}

export default function Review() {
  const navigate = useNavigate();
  const toast = useToast();
  const { send } = useMasterController();
  const { projects } = useWorkspace();
  const habits = useRows('habits', []);
  const habitLogs = useRows('habit_logs', []);
  const tasks = useRows('tasks', []);
  const boards = useRows('boards', []);
  const workouts = useRows('workout_logs', []);
  const nutrition = useRows('nutrition_logs', []);
  const goals = useRows('user_goals', []);
  const weights = useRows('weight_logs', []);
  const transactions = useRows('transactions', []);
  const categories = useRows('expense_categories', []);
  const events = useCalendarEvents();
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(false);

  // Notes: titles + dates only (not their full text), refreshed when a note is created.
  const loadNotes = () =>
    queryTable('knowledge_notes', { select: 'id,title,created_at', order: 'created_at', limit: 400 })
      .then(({ data }) => setNotes(data || []))
      .catch(() => setNotes([]));
  useEffect(() => { loadNotes(); }, []);

  const loading = [habits, habitLogs, tasks, boards, workouts, nutrition, goals, weights, transactions, categories].some((r) => r.loading) || notes === null;

  const review = useMemo(
    () => buildReview({
      today: new Date(),
      habits: habits.rows, habitLogs: habitLogs.rows, tasks: tasks.rows, boards: boards.rows, workouts: workouts.rows,
      nutrition: nutrition.rows, goals: goals.rows, weights: weights.rows, transactions: transactions.rows,
      categories: categories.rows, notes: notes || [], events,
    }),
    [habits.rows, habitLogs.rows, tasks.rows, boards.rows, workouts.rows, nutrition.rows, goals.rows, weights.rows, transactions.rows, categories.rows, notes, events]
  );

  const title = reviewNoteTitle(review);
  const existing = (notes || []).find((n) => n.title === title);

  const startNote = async () => {
    if (existing) return navigate(`/knowledge?note=${existing.id}`);
    setBusy(true);
    try {
      const saved = await saveNote({ title, content: reviewNoteTemplate(review), folder: 'Reviews', tags: ['review'], project_id: null });
      notifyDataChanged('knowledge_notes');
      toast(`Created “${saved.title}”`);
      navigate(`/knowledge?note=${saved.id}`);
    } catch (e) {
      toast({ tone: 'error', message: e.message || 'Could not create the review note.' });
    } finally {
      setBusy(false);
    }
  };

  const { habits: h, tasks: t, workouts: w, nutrition: n, weight: wt, spend: s, notes: nt, windows } = review;
  const projectOf = (task) => projectForTask(task, projects.rows);

  if (loading) {
    return <div className="page-loading" role="status" aria-label="Loading your week"><Spinner large /></div>;
  }

  return (
    <div className="fade-in review-page">
      <div className="page-header">
        <div>
          <div className="page-title">Weekly review</div>
          <div className="page-header-sub">{rangeLabel(windows.from, windows.to)} · {review.label} · compared with the 7 days before</div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => send(weeklyReviewPrompt())}><i className="ti ti-sparkles" /> Ask Master Controller</button>
          <button className="btn btn--accent" onClick={startNote} disabled={busy}>
            <i className="ti ti-notebook" /> {existing ? 'Open this week’s note' : busy ? 'Creating…' : 'Start review note'}
          </button>
        </div>
      </div>

      <div className="review-stats">
        <Stat label="Habits" value={h.count ? `${h.rate ?? 0}%` : '—'} to="/habits">
          {h.count ? <Delta current={h.rate} previous={h.prevRate} format={(x) => `${x} pts`} /> : <span className="review-delta review-delta--flat">no habits yet</span>}
        </Stat>
        <Stat label="Tasks done" value={`${t.dueThisWeek.done}/${t.dueThisWeek.total}`} to="/todo">
          <span className="review-delta review-delta--flat">{t.overdue.length ? `${t.overdue.length} overdue now` : 'nothing overdue'}</span>
        </Stat>
        <Stat label="Workouts" value={w.count} to="/health/fitness">
          <Delta current={w.count} previous={w.prevCount} />
        </Stat>
        <Stat label="Spending" value={s.count ? currency(s.total) : '—'} to="/finance/budget">
          {s.count ? <Delta current={s.total} previous={s.prevTotal} good="neutral" format={(x) => currency(x)} /> : <span className="review-delta review-delta--flat">nothing logged</span>}
        </Stat>
      </div>

      <div className="review-grid">
        <Card className="card-section" static>
          <div className="card-section-title">Habits</div>
          {h.habits.length === 0 ? <p className="body-text">No habits yet. <Link to="/habits">Add one</Link> to see it here.</p> : (
            <ul className="review-list">
              {[...h.habits].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)).map((hb) => (
                <li key={hb.id}>
                  <div className="review-row">
                    <span className="review-row-name">{hb.name}</span>
                    {hb.streak >= 2 && <span className="review-chip"><i className="ti ti-flame" /> {hb.streak}</span>}
                    <span className="review-row-value">{hb.done}/{hb.possible}</span>
                  </div>
                  <div className="review-bar" aria-hidden="true"><span style={{ width: `${hb.rate ?? 0}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {h.needsWork && h.needsWork.rate < 60 && <p className="review-note">Needs attention: <strong>{h.needsWork.name}</strong> ({h.needsWork.rate}%).</p>}
        </Card>

        <Card className="card-section" static>
          <div className="card-section-title">Tasks</div>
          {t.overdue.length > 0 && (
            <>
              <div className="review-sub review-sub--bad">Overdue ({t.overdue.length})</div>
              <ul className="review-list">
                {t.overdue.slice(0, 6).map((task) => <TaskRow key={task.id} task={task} project={projectOf(task)} />)}
              </ul>
            </>
          )}
          <div className="review-sub">Coming up</div>
          {t.upcoming.length === 0 ? <p className="body-text">Nothing due in the next 7 days.</p> : (
            <ul className="review-list">
              {t.upcoming.slice(0, 8).map((task) => <TaskRow key={task.id} task={task} project={projectOf(task)} />)}
            </ul>
          )}
          <p className="review-note">{t.createdThisWeek} new task{t.createdThisWeek === 1 ? '' : 's'} this week · {t.openCount} open in total.</p>
        </Card>

        <Card className="card-section" static>
          <div className="card-section-title">Body</div>
          <dl className="review-facts">
            <div><dt>Training</dt><dd>{w.count} workout{w.count === 1 ? '' : 's'} on {w.activeDays} day{w.activeDays === 1 ? '' : 's'}{Object.keys(w.types).length ? ` (${Object.entries(w.types).map(([k, v]) => `${k} ×${v}`).join(', ')})` : ''}</dd></div>
            <div><dt>Nutrition</dt><dd>{n.loggedDays ? `${n.avgCalories.toLocaleString('en-US')} kcal/day avg over ${n.loggedDays} logged day${n.loggedDays === 1 ? '' : 's'}${n.goalCalories ? ` (goal ${n.goalCalories.toLocaleString('en-US')})` : ''}` : 'Nothing logged this week'}</dd></div>
            <div><dt>Weight</dt><dd>{wt.entries ? `${wt.first} → ${wt.last}${wt.change !== null ? ` (${wt.change > 0 ? '+' : ''}${wt.change})` : ''}` : 'No weigh-ins this week'}</dd></div>
          </dl>
        </Card>

        <Card className="card-section" static>
          <div className="card-section-title">Money & notes</div>
          <dl className="review-facts">
            <div><dt>Spending</dt><dd>{s.count ? `${currency(s.total)} across ${s.count} transaction${s.count === 1 ? '' : 's'}${s.weeklyBudget ? ` · weekly budget ${currency(s.weeklyBudget)}` : ''}` : 'Nothing logged this week'}</dd></div>
            {s.top.length > 0 && <div><dt>Biggest</dt><dd>{s.top.map((c) => `${c.name} ${currency(c.amount)}`).join(' · ')}</dd></div>}
            <div><dt>Notes written</dt><dd>{nt.count ? nt.titles.join(', ') : 'None this week'}</dd></div>
          </dl>
        </Card>

        <Card className="card-section review-wide" static>
          <div className="card-section-title">On your calendar, next 7 days</div>
          {review.events.length === 0 ? <p className="body-text">Nothing scheduled. <Link to="/calendar">Open the calendar</Link>.</p> : (
            <ul className="review-list">
              {review.events.slice(0, 8).map((e, i) => (
                <li key={e.id || i} className="review-row">
                  <span className="review-row-name">{e.title}</span>
                  <span className="review-row-value">{shortDay(rowDay(e.starts_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TaskRow({ task, project }) {
  const navigate = useNavigate();
  return (
    <li className="review-row review-row--click" onClick={() => navigate(task.board_id ? `/todo/${task.board_id}` : '/todo')}>
      <span className="review-row-name">{task.title}</span>
      {project && (
        <Link className="review-chip" to={`/projects/${project.id}`} onClick={(e) => e.stopPropagation()} title={`Open project: ${project.name}`}>
          <i className="ti ti-folder" /> {project.name}
        </Link>
      )}
      <span className="review-row-value">{shortDay(rowDay(task.due_date))}</span>
    </li>
  );
}
