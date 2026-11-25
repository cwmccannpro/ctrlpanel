import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { projectForTask, projectsForColumn } from '../lib/links.js';
import { canDropInColumn, columnsOf, compareTaskPriority, primaryBoard } from '../lib/boards.js';
import { updateTodoColumns } from '../lib/supabase.js';
import { KANBAN_COLUMNS as DEFAULT_COLUMNS } from '../lib/mockData.js';
import { useToast } from '../components/Toaster.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { relativeDay } from '../lib/helpers.js';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

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

function Column({ name, index, total, tasks, projects, focused, locked, onCardClick, onAdd, onMove, onRename, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  return (
    <div ref={setNodeRef} data-todo-focus={focused || undefined} className={`kanban-col ${isOver ? 'drag-over' : ''}`}>
      <div className="kanban-col-head">
        <div className="row" style={{ gap: 6 }}>
          <span>{name}</span>
          <span className="kanban-col-count">{tasks.length}</span>
        </div>
        <div className="col-actions">
          <button title="Move left" onClick={() => onMove(index, -1)} disabled={locked || index === 0}><i className="ti ti-chevron-left" /></button>
          <button title="Move right" onClick={() => onMove(index, 1)} disabled={locked || index === total - 1}><i className="ti ti-chevron-right" /></button>
          <button title="Rename column" onClick={() => onRename(name)} disabled={locked}><i className="ti ti-pencil" /></button>
          <button title="Delete column" onClick={() => onDelete(name)} disabled={locked}><i className="ti ti-trash" /></button>
        </div>
      </div>
      {projects.length > 0 && <div className="kanban-column-projects">
        {projects.map((project) => <Link className="badge badge--link" key={project.id} to={`/projects/${project.id}`}><i className="ti ti-folder" aria-hidden="true" /> {project.name}</Link>)}
      </div>}
      {tasks.map((t) => (
        <KanbanCard key={t.id} task={t} onClick={() => onCardClick(t)} />
      ))}
      <button className="kanban-add" onClick={() => onAdd(name)} disabled={locked}>
        <i className="ti ti-plus" /> Add card
      </button>
    </div>
  );
}

export default function ToDo() {
  const { todoBoards: boards, projects } = useWorkspace();
  const { user } = useAuth();
  const toast = useToast();
  const tasks = useCrud('tasks', 'created_at');
  const { boardId: boardIdParam } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const focusedColumn = params.get('column');
  const taskId = params.get('task');
  const kanban = useRef(null);
  const goToBoard = (id, opts) => navigate(id ? `/todo/${id}` : '/todo', opts);
  const [editing, setEditing] = useState(null);
  const [changingColumns, setChangingColumns] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ownedBoards = useMemo(
    () => boards.rows.filter((b) => b.user_id === user?.id),
    [boards.rows, user?.id]
  );
  const ownedTasks = useMemo(
    () => tasks.rows.filter((t) => t.user_id === user?.id),
    [tasks.rows, user?.id]
  );

  // The base route (or a removed board) opens your main board — the same one the dashboard shows.
  const board = ownedBoards.find((b) => b.id === boardIdParam)
    || primaryBoard(ownedBoards, { tasks: ownedTasks, projects: projects.rows })
    || ownedBoards[0] || null;
  const boardId = board?.id || null;
  useEffect(() => {
    if (!boards.loading && boardId && boardIdParam !== boardId) {
      navigate(`/todo/${boardId}`, { replace: true });
    }
  }, [boards.loading, boardId, boardIdParam, navigate]);
  const columns = board ? columnsOf(board, DEFAULT_COLUMNS) : [];
  const visibleTasks = useMemo(
    () => (boardId ? ownedTasks.filter((t) => t.board_id === boardId) : []),
    [ownedTasks, boardId]
  );
  const openProject = (pid) => navigate(`/projects/${pid}`);
  // The editor can show a different board's columns once a task is moved to a project.
  const editBoard = editing ? ownedBoards.find((b) => b.id === (editing.board_id || boardId)) : null;
  const editColumns = editBoard ? columnsOf(editBoard, DEFAULT_COLUMNS) : columns;
  const editProject = editing ? projectForTask(editing, projects.rows) : null;
  const projectChoices = projects.rows.filter((p) => p.todo_column_name && ownedBoards.some(
    (b) => b.id === p.todo_board_id && columnsOf(b, DEFAULT_COLUMNS).includes(p.todo_column_name)
  ));

  useEffect(() => {
    if (focusedColumn && boardId === boardIdParam) {
      kanban.current?.querySelector('[data-todo-focus]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [focusedColumn, boardId, boardIdParam]);

  useEffect(() => {
    if (!taskId || tasks.loading || !boardId || boardId !== boardIdParam) return;
    const task = visibleTasks.find((row) => row.id === taskId);
    if (task) setEditing(task);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('task');
      return next;
    }, { replace: true });
  }, [taskId, tasks.loading, boardId, boardIdParam, visibleTasks, setParams]);

  async function setColumns(next, previous, target) {
    if (!board || changingColumns) return;
    setChangingColumns(true);
    try {
      await updateTodoColumns(board.id, columns, next, previous, target);
      await Promise.all([boards.reload(), ...(previous ? [tasks.reload(), projects.reload()] : [])]);
      if (focusedColumn && focusedColumn === previous) {
        setParams((current) => {
          const params = new URLSearchParams(current);
          params.set('column', target);
          return params;
        }, { replace: true });
      }
    } catch (error) {
      toast({ tone: 'error', message: error.message });
      await boards.reload();
    } finally {
      setChangingColumns(false);
    }
  }

  /* ---- Board actions ---- */
  const addBoard = async () => {
    const name = prompt('New board name?');
    if (!name) return;
    const created = await boards.add({ name, columns: DEFAULT_COLUMNS });
    if (created?.id) goToBoard(created.id);
  };
  const renameBoard = () => {
    const name = prompt('Rename board', board.name);
    if (name) boards.patch(board.id, { name });
  };
  const deleteBoard = () => {
    if (!board) return;
    if (!confirm(`Delete board "${board.name}" and all its cards?`)) return;
    boards.remove(board.id);
    goToBoard(null, { replace: true });
  };

  /* ---- Column actions (stored on board.columns) ---- */
  const addColumn = () => {
    const name = prompt('New column name?')?.trim();
    if (!name) return;
    if (columns.includes(name)) return alert('That column already exists.');
    setColumns([...columns, name]);
  };
  const renameColumn = (col) => {
    const name = prompt('Rename column', col)?.trim();
    if (!name || name === col) return;
    if (columns.includes(name)) return alert('That column already exists.');
    setColumns(columns.map((c) => (c === col ? name : c)), col, name);
  };
  const deleteColumn = (col) => {
    if (columns.length <= 1) return alert('A board needs at least one column.');
    const remaining = columns.filter((c) => c !== col);
    const target = remaining[0];
    const linked = projectsForColumn(projects.rows, boardId, col);
    const unlink = linked.length ? ` Projects linked here will need a new column.` : '';
    if (!confirm(`Delete column "${col}"? Its cards move to "${target}".${unlink}`)) return;
    setColumns(remaining, col, target);
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
    if (!over || changingColumns) return;
    const task = ownedTasks.find((t) => t.id === active.id);
    if (!canDropInColumn(task, ownedBoards, DEFAULT_COLUMNS, over.id)) {
      toast({ tone: 'error', message: `“${over.id}” isn’t a column on that task’s board.` });
      return;
    }
    tasks.patch(active.id, { column_name: over.id });
  };

  const openNew = (column) => {
    if (!boardId) return;
    setEditing({ id: null, board_id: boardId, title: '', description: '', column_name: column, priority: 'Medium', due_date: '', project_id: '' });
  };

  const saveTask = () => {
    const t = editing;
    if (!t.title.trim()) return;
    const payload = {
      board_id: t.board_id || boardId || null,
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
    <div className="fade-in todo-page">
      <div className="page-header">
        <div>
          <select aria-label="Select board" className="board-title-select" value={boardId || ''} disabled={!board} onChange={(e) => goToBoard(e.target.value)} style={{ width: 'auto' }}>
            {!board && <option value="">{boards.loading ? 'Loading boards…' : 'No boards yet'}</option>}
            {ownedBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="toolbar">

        <button className="btn" onClick={addBoard}><i className="ti ti-plus" /> Board</button>
        {board && <button className="btn btn--ghost btn--icon" onClick={renameBoard} title="Rename board"><i className="ti ti-pencil" /></button>}
        {board && <button className="btn btn--ghost btn--icon" onClick={deleteBoard} title="Delete board"><i className="ti ti-trash" /></button>}
        {board && <button className="btn" style={{ marginLeft: 'auto' }} disabled={changingColumns} onClick={addColumn}><i className="ti ti-columns-3" /> Add column</button>}
      </div>

      {!board ? (
        <p className="body-text" role="status">
          {boards.loading ? 'Loading boards…' : 'Create a board to start adding tasks.'}
        </p>
      ) : <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div ref={kanban} className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))` }}>
          {columns.map((col, i) => (
            <Column
              key={col}
              name={col}
              index={i}
              total={columns.length}
              tasks={visibleTasks.filter((t) => t.column_name === col).sort(compareTaskPriority)}
              projects={projectsForColumn(projects.rows, boardId, col)}
              focused={focusedColumn === col}
              locked={changingColumns}
              onCardClick={setEditing}
              onAdd={openNew}
              onMove={moveColumn}
              onRename={renameColumn}
              onDelete={deleteColumn}
            />
          ))}
        </div>
      </DndContext>}

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
                {editColumns.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Due date</label>
              <input className="input" type="date" value={editing.due_date || ''} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Label</label>
              <input className="input" value={editing.project_id || ''} onChange={(e) => setEditing({ ...editing, project_id: e.target.value })} placeholder="Optional tag" />
            </div>
          </div>
          {projectChoices.length > 0 && (
            <div className="field">
              <label className="field-label" htmlFor="task-project-column">Project column</label>
              <div className="row" style={{ gap: 8 }}>
                <select
                  className="select"
                  id="task-project-column"
                  value={editProject?.id || ''}
                  onChange={(e) => {
                    const p = projects.rows.find((x) => x.id === e.target.value);
                    if (!p) return;
                    setEditing({ ...editing, board_id: p.todo_board_id, column_name: p.todo_column_name });
                  }}
                >
                  {!editProject && <option value="">Choose a project column</option>}
                  {projectChoices.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.todo_column_name}</option>)}
                </select>
                {editProject && (
                  <button type="button" className="btn btn--ghost" onClick={() => { setEditing(null); openProject(editProject.id); }}>
                    Open <i className="ti ti-arrow-up-right" />
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
