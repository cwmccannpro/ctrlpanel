import { useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from './shared/Modal.jsx';
import { DURATIONS, durationLabel, tintFor } from '../lib/taskBlocks.js';
import { formatDate } from '../lib/helpers.js';

const pad = (n) => String(n).padStart(2, '0');
const toInput = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * A To Do task on the calendar: set its exact time + length (the keyboard
 * alternative to dragging), tick it off, take it off the calendar, or open it.
 */
export default function TaskBlockDetail({ item, planner, onSnap, onClose }) {
  const task = planner.tasks.find((t) => t.id === item.task_id) || item;
  const block = planner.blocks[item.task_id];
  const [when, setWhen] = useState(block ? toInput(block.start) : '');
  const [mins, setMins] = useState(block?.mins || item.mins || 30);
  const done = planner.tasks.some((t) => t.id === item.task_id) && planner.doneOf(task);
  const valid = when && !Number.isNaN(Date.parse(when));

  const save = () => {
    if (!valid) return;
    planner.place(item.task_id, new Date(when), mins);
    onClose();
  };

  return (
    <Modal title={task.title || 'Task'} onClose={onClose}>
      <div className="calendar-detail task-detail" style={{ '--event-color': tintFor(task.priority) }}>
        <p className="task-detail-meta">
          <span className="task-detail-dot" /> {task.priority || 'Medium'} priority
          {task.due_date ? ` · due ${formatDate(task.due_date)}` : ''}
          {done ? ' · done' : ''}
        </p>

        <div className="task-detail-form">
          <label>
            <span>Starts</span>
            <input className="input" type="datetime-local" step={900} value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label>
            <span>Length</span>
            <select className="select" value={mins} onChange={(e) => setMins(Number(e.target.value))}>
              {[...new Set([...DURATIONS, mins])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select>
          </label>
        </div>

        <div className="task-detail-actions">
          <button className="btn btn--accent" disabled={!valid} onClick={save}>{block ? 'Update time' : 'Add to calendar'}</button>
          {!block && <button className="btn" onClick={() => { onSnap(task, mins); onClose(); }}><i className="ti ti-bolt" /> Next free slot</button>}
          {block && <button className="btn" onClick={() => { planner.unschedule(item.task_id); onClose(); }}>Remove from calendar</button>}
        </div>

        <div className="task-detail-actions">
          <button className="btn btn--ghost" onClick={() => { planner.toggleDone(task); onClose(); }}>{done ? 'Reopen task' : 'Mark done'}</button>
          <Link className="btn btn--ghost" to="/todo" onClick={onClose}>Open To Do ↗</Link>
        </div>
      </div>
    </Modal>
  );
}
