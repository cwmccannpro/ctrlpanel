import { useState, useMemo } from 'react';
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
import { useRows } from '../lib/useData.js';
import { update as sbUpdate, insert as sbInsert, remove as sbRemove } from '../lib/supabase.js';
import { KANBAN_COLUMNS } from '../lib/mockData.js';
import { relativeDay } from '../lib/helpers.js';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
let tmpId = 0;
const newId = () => `new-${Date.now()}-${tmpId++}`;

function KanbanCard({ task, onClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card ${isDragging ? 'dragging' : ''}`}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <span className="kanban-card-title">{task.title}</span>
      <div className="kanban-card-meta">
        <Badge variant={task.priority}>{task.priority}</Badge>
        {task.project_id && <span className="badge">{task.project_id}</span>}
        {task.due_date && <span className="list-row-meta">{relativeDay(task.due_date)}</span>}
      </div>
    </div>
  );
}

function Column({ name, tasks, onCardClick, onAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  return (
    <div ref={setNodeRef} className={`kanban-col ${isOver ? 'drag-over' : ''}`}>
      <div className="kanban-col-head">
        <span>{name}</span>
        <span className="kanban-col-count">{tasks.length}</span>
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
  const { rows: tasks, setRows: setTasks, usingMock } = useRows('tasks', []);
  const [boards, setBoards] = useState([{ id: 'b-global', name: 'Global' }]);
  const [boardId, setBoardId] = useState('all');
  const [editing, setEditing] = useState(null); // task object or null
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const visibleTasks = useMemo(
    () => (boardId === 'all' ? tasks : tasks.filter((t) => t.board_id === boardId)),
    [tasks, boardId]
  );

  const onDragEnd = ({ active, over }) => {
    if (!over) return;
    const column = over.id;
    setTasks((prev) => prev.map((t) => (t.id === active.id ? { ...t, column_name: column } : t)));
    sbUpdate('tasks', active.id, { column_name: column });
  };

  const openNew = (column) => {
    setEditing({
      id: null,
      title: '',
      description: '',
      column_name: column,
      priority: 'Medium',
      due_date: '',
      project_id: '',
      board_id: boardId === 'all' ? boards[0]?.id : boardId,
    });
  };

  const saveTask = () => {
    const t = editing;
    if (!t.title.trim()) return;
    if (t.id) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      sbUpdate('tasks', t.id, t);
    } else {
      const created = { ...t, id: newId() };
      setTasks((prev) => [...prev, created]);
      sbInsert('tasks', [{ ...t, id: undefined }]);
    }
    setEditing(null);
  };

  const deleteTask = () => {
    if (editing?.id) {
      setTasks((prev) => prev.filter((x) => x.id !== editing.id));
      sbRemove('tasks', editing.id);
    }
    setEditing(null);
  };

  const addBoard = () => {
    const name = prompt('Board name?');
    if (name) setBoards((prev) => [...prev, { id: newId(), name }]);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">To Do</h1>
          <div className="page-header-sub">Drag cards between columns {usingMock && '· demo data'}</div>
        </div>
      </div>

      <div className="toolbar">
        <select className="select" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
          <option value="all">All boards</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={addBoard}>
          <i className="ti ti-plus" /> Add board
        </button>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="kanban">
          {KANBAN_COLUMNS.map((col) => (
            <Column
              key={col}
              name={col}
              tasks={visibleTasks.filter((t) => t.column_name === col)}
              onCardClick={setEditing}
              onAdd={openNew}
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
              {editing.id && (
                <button className="btn btn--danger" onClick={deleteTask} style={{ marginRight: 'auto' }}>
                  Delete
                </button>
              )}
              <button className="btn btn--ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn btn--accent" onClick={saveTask}>
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Title</label>
            <input
              className="input"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label">Description</label>
            <textarea
              className="textarea"
              value={editing.description || ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Priority</label>
              <select
                className="select"
                value={editing.priority}
                onChange={(e) => setEditing({ ...editing, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Column</label>
              <select
                className="select"
                value={editing.column_name}
                onChange={(e) => setEditing({ ...editing, column_name: e.target.value })}
              >
                {KANBAN_COLUMNS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Due date</label>
              <input
                className="input"
                type="date"
                value={editing.due_date || ''}
                onChange={(e) => setEditing({ ...editing, due_date: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">Project</label>
              <input
                className="input"
                value={editing.project_id || ''}
                onChange={(e) => setEditing({ ...editing, project_id: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
