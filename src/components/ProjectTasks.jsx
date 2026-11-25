import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from './shared/Badge.jsx';
import { compareTaskPriority } from '../lib/boards.js';
import { relativeDay } from '../lib/helpers.js';
import { todoColumnPath } from '../lib/links.js';
import { insert, queryTable } from '../lib/supabase.js';
import { saveQuickTask } from '../lib/taskQuickAdd.js';
import { notifyDataChanged } from '../lib/useData.js';

export default function ProjectTasks({ board, column }) {
  const [result, setResult] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const boardId = board.id;
  useEffect(() => {
    let active = true;
    queryTable('tasks', {
      filters: { board_id: boardId, column_name: column },
      select: 'id,title,priority,due_date,created_at',
      order: 'created_at',
      ascending: true,
      limit: 1000,
    }).then(({ data, error }) => {
      if (active) setResult({ rows: data || [], error: error?.message });
    }).catch((reason) => { if (active) setResult({ rows: [], error: reason.message }); });
    return () => { active = false; };
  }, [boardId, column]);

  async function add(event) {
    event.preventDefault();
    if (saving || !text.trim()) return;
    setSaving(true);
    setError('');
    try {
      const saved = await saveQuickTask(text, board, column, insert);
      setResult((current) => ({ ...current, rows: [...(current?.rows || []), saved] }));
      setText('');
      notifyDataChanged('tasks');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const tasks = result?.rows?.slice().sort(compareTaskPriority);
  return <>
    {!result ? <p className="project-widget-empty" role="status">Loading tasks…</p>
      : result.error ? <p className="project-error" role="alert">{result.error}</p>
        : tasks.length === 0 ? <p className="project-widget-empty">No tasks in {column}.</p>
          : <ul className="project-widget-list">
            {tasks.slice(0, 8).map((task) => <li key={task.id} className="project-task-row">
              <Link to={todoColumnPath(boardId, column, task.id)}>{task.title}</Link>
              {task.due_date && <span className="list-row-meta">{relativeDay(task.due_date)}</span>}
              {task.priority && <Badge variant={task.priority}>{task.priority}</Badge>}
            </li>)}
          </ul>}
    <form className="project-task-add" onSubmit={add}>
      <input className="input" value={text} onChange={(event) => setText(event.target.value)} aria-label="New project task" placeholder="Add a task…" disabled={!result || saving} />
      <button className="btn" disabled={!result || saving || !text.trim()}>{saving ? 'Adding…' : 'Add task'}</button>
    </form>
    {error && <p className="project-error" role="alert">{error}</p>}
    <Link className="project-widget-link" to={todoColumnPath(boardId, column)}>Open {column} in To Do<i className="ti ti-arrow-right" aria-hidden="true" /></Link>
  </>;
}
