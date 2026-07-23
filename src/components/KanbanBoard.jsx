// ============================================================
// CTRLpanel — Reusable Kanban board
// Columns + draggable cards + add/edit/delete card modal + column
// add/rename/delete/reorder. Controlled by handlers so the parent owns
// persistence (the To Do page and a project's Board tab both write to the
// same `tasks` + `boards` tables, so edits stay in sync between them).
// ============================================================
import { useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core';
import Badge from './shared/Badge.jsx';
import Modal from './shared/Modal.jsx';
import { relativeDay } from '../lib/helpers.js';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const DEFAULT_COLUMNS = ['Backlog', 'In Progress', 'Review', 'Done'];

// Cards auto-sort by priority within a column; creation order breaks ties.
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const byPriority = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
  String(a.created_at || '').localeCompare(String(b.created_at || ''));

function KanbanCard({ task, onClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`kanban-card ${isDragging ? 'dragging' : ''}`} onClick={onClick} {...listeners} {...attributes}>
      <span className="kanban-card-title">{task.title}</span>
      <div className="kanban-card-meta">
        <Badge variant={task.priority}>{task.priority}</Badge>
        {task.due_date && <span className="list-row-meta">{relativeDay(task.due_date)}</span>}
      </div>
    </div>
  );
}

function Column({ name, index, total, tasks, onCardClick, onAdd, onMove, onRename, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  return (
    <div ref={setNodeRef} className={`kanban-col ${isOver ? 'drag-over' : ''}`}>
      <div className="kanban-col-head">
        <div className="row" style={{ gap: 6 }}>
          <span>{name}</span>
          <span className="kanban-col-count">{tasks.length}</span>
        </div>
        <div className="col-actions">
          <button title="Move left" onClick={() => onMove(index, -1)} disabled={index === 0}><i className="ti ti-chevron-left" /></button>
          <button title="Move right" onClick={() => onMove(index, 1)} disabled={index === total - 1}><i className="ti ti-chevron-right" /></button>
          <button title="Rename column" onClick={() => onRename(name)}><i className="ti ti-pencil" /></button>
          <button title="Delete column" onClick={() => onDelete(name)}><i className="ti ti-trash" /></button>
        </div>
      </div>
      {tasks.map((t) => (
        <KanbanCard key={t.id} task={t} onClick={() => onCardClick(t)} />
      ))}
      <button className="kanban-add" onClick={() => onAdd(name)}>
        <i className="ti ti-plus" /> Add card
      </button>
    </div>
  );
}

/**
 * Props:
 *  - columns:   string[]  (falls back to DEFAULT_COLUMNS if empty)
 *  - tasks:     task rows belonging to this board
 *  - boardId:   id set as board_id on new cards
 *  - onColumns: (nextColumns) => void   — persist the columns array
 *  - addTask / patchTask / removeTask   — task CRUD (parent persists)
 *  - headerRight: optional node rendered right-aligned in the toolbar
 */
export default function KanbanBoard({ columns, tasks, boardId, onColumns, addTask, patchTask, removeTask, headerRight }) {
  const [editing, setEditing] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const cols = columns?.length ? columns : DEFAULT_COLUMNS;

  /* ---- Column ops (stored on the board's columns array) ---- */
  const addColumn = () => {
    const name = prompt('New column name?');
    if (!name) return;
    if (cols.includes(name)) return alert('That column already exists.');
    onColumns([...cols, name]);
  };
  const renameColumn = (col) => {
    const name = prompt('Rename column', col);
    if (!name || name === col) return;
    if (cols.includes(name)) return alert('That column already exists.');
    onColumns(cols.map((c) => (c === col ? name : c)));
    tasks.filter((t) => t.column_name === col).forEach((t) => patchTask(t.id, { column_name: name }));
  };
  const deleteColumn = (col) => {
    if (cols.length <= 1) return alert('A board needs at least one column.');
    const remaining = cols.filter((c) => c !== col);
    const target = remaining[0];
    if (!confirm(`Delete column "${col}"? Its cards move to "${target}".`)) return;
    tasks.filter((t) => t.column_name === col).forEach((t) => patchTask(t.id, { column_name: target }));
    onColumns(remaining);
  };
  const moveColumn = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[idx], next[j]] = [next[j], next[idx]];
    onColumns(next);
  };

  /* ---- Card ops ---- */
  const onDragEnd = ({ active, over }) => {
    if (!over) return;
    patchTask(active.id, { column_name: over.id });
  };
  const openNew = (column) => setEditing({ id: null, title: '', description: '', column_name: column, priority: 'Medium', due_date: '' });
  const saveTask = () => {
    const t = editing;
    if (!t.title.trim()) return;
    const payload = {
      board_id: boardId,
      title: t.title,
      description: t.description || null,
      column_name: t.column_name,
      priority: t.priority,
      due_date: t.due_date || null,
    };
    if (t.id) patchTask(t.id, payload);
    else addTask(payload);
    setEditing(null);
  };
  const deleteTask = () => {
    if (editing?.id) removeTask(editing.id);
    setEditing(null);
  };

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={addColumn}><i className="ti ti-columns-3" /> Add column</button>
        {headerRight && <div style={{ marginLeft: 'auto' }}>{headerRight}</div>}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(220px, 1fr))` }}>
          {cols.map((col, i) => (
            <Column
              key={col}
              name={col}
              index={i}
              total={cols.length}
              tasks={tasks.filter((t) => t.column_name === col).sort(byPriority)}
              onCardClick={setEditing}
              onAdd={openNew}
              onMove={moveColumn}
              onRename={renameColumn}
              onDelete={deleteColumn}
            />
          ))}
        </div>
      </DndContext>

      {editing && (
        <Modal
          title={editing.id ? 'Edit Task' : 'New Task'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn btn--danger" onClick={deleteTask} style={{ marginRight: 'auto' }}>Delete</button>}
              <button className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveTask}>Save</button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Title</label>
            <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label className="field-label">Description</label>
            <textarea className="textarea" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Priority</label>
              <select className="select" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Column</label>
              <select className="select" value={editing.column_name} onChange={(e) => setEditing({ ...editing, column_name: e.target.value })}>
                {cols.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label className="field-label">Due date</label>
            <input className="input" type="date" value={editing.due_date || ''} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  );
}
