import { useMemo, useState } from 'react';
import { DEFAULT_MINS, DURATIONS, durationLabel, tintFor } from '../lib/taskBlocks.js';
import { dayKey, parseLocalDate } from '../lib/helpers.js';

const RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const GROUPS = [
  { id: 'overdue', label: 'Overdue', tone: 'bad' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
];

function dueBucket(task) {
  if (!task.due_date) return { id: 'none', label: '' };
  const due = parseLocalDate(task.due_date);
  const today = parseLocalDate(dayKey(new Date()));
  const diff = Math.round((due - today) / 86400000);
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff < 0 ? `${-diff}d overdue` : due.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return { id: diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 7 ? 'week' : 'later', label, diff };
}

/**
 * To Do tasks that haven't got a time yet. Drag a row onto the calendar (it snaps
 * to 15 minutes and to neighbouring events), or press ⚡ to drop it into the next
 * free slot. The duration chip cycles 15m → 2h before you place it.
 */
export default function TaskTray({ planner, drag, setDrag, onSnap, onOpenTask, onClose }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('soon');
  const [mins, setMins] = useState({});
  const lengthOf = (t) => mins[t.id] || DEFAULT_MINS;

  const { groups, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = planner.unscheduled
      .filter((t) => !q || String(t.title || '').toLowerCase().includes(q))
      .map((t) => ({ task: t, due: dueBucket(t) }))
      .filter(({ due }) => scope === 'all' || ['overdue', 'today', 'week'].includes(due.id))
      .sort((a, b) => (RANK[a.task.priority] ?? 9) - (RANK[b.task.priority] ?? 9) || (a.due.diff ?? 1e9) - (b.due.diff ?? 1e9));
    return {
      total: list.length,
      groups: GROUPS.map((g) => ({ ...g, items: list.filter((x) => x.due.id === g.id) })).filter((g) => g.items.length),
    };
  }, [planner.unscheduled, query, scope]);

  const cycle = (t) => {
    const i = DURATIONS.indexOf(lengthOf(t));
    setMins((m) => ({ ...m, [t.id]: DURATIONS[(i + 1) % DURATIONS.length] }));
  };

  return (
    <aside className="tray" aria-label="Tasks to schedule">
      <header className="tray-head">
        <div>
          <span>To schedule</span>
          <h2>To Do <small>{total}</small></h2>
        </div>
        {onClose && <button className="btn btn--ghost btn--icon" aria-label="Hide task tray" onClick={onClose}><i className="ti ti-layout-sidebar-right-collapse" /></button>}
      </header>
      <div className="tray-tools">
        <div className="segmented segmented--xs" role="group" aria-label="Which tasks">
          <button className={scope === 'soon' ? 'active' : ''} onClick={() => setScope('soon')}>Due soon</button>
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All</button>
        </div>
        <label className="tray-search"><i className="ti ti-search" /><input className="input" placeholder="Filter tasks" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter tasks" /></label>
      </div>

      <div className="tray-list">
        {planner.loading && !planner.tasks.length ? (
          <p className="tray-empty">Loading tasks…</p>
        ) : groups.length === 0 ? (
          <div className="tray-empty"><i className="ti ti-circle-check" /><p>{!planner.unscheduled.length ? 'Everything open is on the calendar.' : query ? 'Nothing matches that filter.' : 'Nothing due this week.'}</p>{planner.unscheduled.length > 0 && scope === 'soon' && !query && <button className="btn btn--sm" onClick={() => setScope('all')}>Show all {planner.unscheduled.length}</button>}</div>
        ) : (
          groups.map((g) => (
            <section key={g.id} className={`tray-group ${g.tone || ''}`}>
              <h3>{g.label}<small>{g.items.length}</small></h3>
              <ul>
                {g.items.map(({ task, due }) => (
                  <li
                    key={task.id}
                    className={`tray-task ${drag?.taskId === task.id ? 'is-dragging' : ''}`}
                    style={{ '--tint': tintFor(task.priority) }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', task.title || 'Task');
                      const m = lengthOf(task);
                      setTimeout(() => setDrag({ taskId: task.id, mins: m, grabMin: Math.min(10, m / 2), from: 'tray' }), 0);
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <i className="tray-grip ti ti-grip-vertical" aria-hidden="true" />
                    <button className="tray-main" onClick={() => onOpenTask(task)} title="Open task">
                      <strong>{task.title || 'Untitled task'}</strong>
                      <small>{[due.label, task.priority].filter(Boolean).join(' · ')}</small>
                    </button>
                    <button className="tray-dur" onClick={() => cycle(task)} title="Duration — click to change" aria-label={`Duration ${durationLabel(lengthOf(task))}. Change`}>{durationLabel(lengthOf(task))}</button>
                    <button className="tray-snap" onClick={() => onSnap(task, lengthOf(task))} title="Snap to the next free slot" aria-label={`Snap ${task.title} to the next free slot`}><i className="ti ti-bolt" /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <footer className="tray-foot"><i className="ti ti-hand-move" /> Drag onto the week. Snaps to 15 min and to neighbouring events. <b>⚡</b> picks the next free gap.</footer>
    </aside>
  );
}
