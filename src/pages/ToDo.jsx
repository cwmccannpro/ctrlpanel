import { useState, useMemo, useEffect, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import Badge from '../components/shared/Badge.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useCrud } from '../lib/useData.js';
import { relativeDay } from '../lib/helpers.js';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const DEFAULT_COLUMNS = ['Backlog', 'In Progress', 'Review', 'Done'];

function KanbanCard({ task, onClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`kanban-card ${isDragging ? 'dragging' : ''}`} onClick={onClick} {...listeners} {...attributes}>
      <span className="kanban-card-title">{task.title}</span>
      <div className="kanban-card-meta">
        <Badge variant={task.priority}>{task.priority}</Badge>
        {task.project_id && <span className="badge">{task.project_id}</span>}
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

export default function ToDo() {
  const boards = useCrud('boards', 'created_at');
  const tasks = useCrud('tasks', 'created_at');
  const [boardId, setBoardId] = useState(null);
  const [editing, setEditing] = useState(null);
  const seededRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Auto-create a starter board for brand-new accounts.
  useEffect(() => {
    if (boards.loading || seededRef.current) return;
    if (boards.rows.length === 0) {
      seededRef.current = true;
      boards.add({ name: 'My Board', columns: DEFAULT_COLUMNS }).then((b) => b?.id && setBoardId(b.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards.loading, boards.rows.length]);

  // Keep a valid selected board.
  useEffect(() => {
    if (boards.rows.length === 0) return;
    if (!boardId || !boards.rows.find((b) => b.id === boardId)) setBoardId(boards.rows[0].id);
  }, [boards.rows, boardId]);

  const board = boards.rows.find((b) => b.id === boardId) || null;
  const columns = board?.columns?.length ? board.columns : DEFAULT_COLUMNS;
  const visibleTasks = useMemo(() => tasks.rows.filter((t) => t.board_id === boardId), [tasks.rows, boardId]);

  const setColumns = (next) => board && boards.patch(board.id, { columns: next });

  /* ---- Board actions ---- */
  const addBoard = async () => {
    const name = prompt('New board name?');
    if (!name) return;
    const created = await boards.add({ name, columns: DEFAULT_COLUMNS });
    if (created?.id) setBoardId(created.id);
  };
  const renameBoard = () => {
    const name = prompt('Rename board', board.name);
    if (name) boards.patch(board.id, { name });
  };
  const deleteBoard = () => {
    if (!board) return;
    if (!confirm(`Delete board "${board.name}" and all its cards?`)) return;
    boards.remove(board.id);
    setBoardId(null);
  };

  /* ---- Column actions (stored on board.columns) ---- */
  const addColumn = () => {
    const name = prompt('New column name?');
    if (!name) return;
    if (columns.includes(name)) return alert('That column already exists.');
    setColumns([...columns, name]);
  };
  const renameColumn = (col) => {
    const name = prompt('Rename column', col);
    if (!name || name === col) return;
    if (columns.includes(name)) return alert('That column already exists.');
    setColumns(columns.map((c) => (c === col ? name : c)));
    // Re-tag cards in the renamed column so they stay put.
    visibleTasks.filter((t) => t.column_name === col).forEach((t) => tasks.patch(t.id, { column_name: name }));
  };
  const deleteColumn = (col) => {
    if (columns.length <= 1) return alert('A board needs at least one column.');
    const remaining = columns.filter((c) => c !== col);
    const target = remaining[0];
    if (!confirm(`Delete column "${col}"? Its cards move to "${target}".`)) return;
    visibleTasks.filter((t) => t.column_name === col).forEach((t) => tasks.patch(t.id, { column_name: target }));
    setColumns(remaining);
  };
  const moveColumn = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[idx], next[j]] = [next[j], next[idx]];
    setColumns(next);
  };

  /* ---- Task actions ---- */
  const onDragEnd = ({ active, over }) => {
    if (!over) return;
    tasks.patch(active.id, { column_name: over.id });
  };

  const openNew = (column) => {
    setEditing({ id: null, title: '', description: '', column_name: column, priority: 'Medium', due_date: '', project_id: '' });
  };

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
      project_id: t.project_id || null,
      labels: t.labels || [],
    };
    if (t.id) tasks.patch(t.id, payload);
    else tasks.add(payload);
    setEditing(null);
  };

  const deleteTask = () => {
    if (editing?.id) tasks.remove(editing.id);
    setEditing(null);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">To Do</h1>
          <div className="page-header-sub">Boards & columns save to your account · drag cards between columns</div>
        </div>
      </div>

      <div className="toolbar">
        <select className="select" value={boardId || ''} onChange={(e) => setBoardId(e.target.value)} style={{ width: 'auto' }}>
          {boards.rows.length === 0 && <option value="">Loading…</option>}
          {boards.rows.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button className="btn" onClick={addBoard}><i className="ti ti-plus" /> Board</button>
        {board && <button className="btn btn--ghost btn--icon" onClick={renameBoard} title="Rename board"><i className="ti ti-pencil" /></button>}
        {board && <button className="btn btn--ghost btn--icon" onClick={deleteBoard} title="Delete board"><i className="ti ti-trash" /></button>}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={addColumn} disabled={!board}><i className="ti ti-columns-3" /> Add column</button>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))` }}>
          {columns.map((col, i) => (
            <Column
              key={col}
              name={col}
              index={i}
              total={columns.length}
              tasks={visibleTasks.filter((t) => t.column_name === col)}
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
                {columns.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Due date</label>
              <input className="input" type="date" value={editing.due_date || ''} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Project</label>
              <input className="input" value={editing.project_id || ''} onChange={(e) => setEditing({ ...editing, project_id: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
