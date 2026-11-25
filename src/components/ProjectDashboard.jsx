import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from './AuthProvider.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import ProjectCrmPriority from './ProjectCrmPriority.jsx';
import ServiceLinks from './ServiceLinks.jsx';
import ProjectCharter from './ProjectCharter.jsx';
import ProjectTasks from './ProjectTasks.jsx';
import { columnsOf } from '../lib/boards.js';
import { KANBAN_COLUMNS } from '../lib/mockData.js';
import { queryTable } from '../lib/supabase.js';
import { projectPath } from '../lib/projectRoutes.js';
import {
  DEFAULT_PROJECT_LAYOUT, DEFAULT_PROJECT_SIDE_WIDTH, PROJECT_WIDGETS, MIN_PROJECT_WIDGET_HEIGHT,
  MAX_PROJECT_WIDGET_HEIGHT, moveProjectWidget, projectLayout, projectSideWidth, projectWidgetHeight, projectWidgetHeights,
} from '../lib/projectDashboard.js';

const EMPTY_SERVICES = [];

function ContextNotes({ project }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    queryTable('knowledge_notes', {
      select: 'id,title,pinned',
      filters: { project_id: project.id },
      order: 'updated_at',
      limit: 6,
    }).then(({ data, error }) => {
      if (active) setResult({ rows: data || [], error });
    }).catch((error) => { if (active) setResult({ rows: [], error }); });
    return () => { active = false; };
  }, [project.id]);

  const path = projectPath(project.id, 'context');
  return <>
    {!result ? <p className="project-widget-empty">Loading notes…</p>
      : result.error ? <p className="project-error" role="alert">{result.error.message}</p>
        : result.rows.length ? <ul className="project-widget-list">
          {result.rows.map((note) => <li key={note.id}>
            <Link to={`${path}?note=${note.id}`}>{note.pinned && <i className="ti ti-pin" />} {note.title}</Link>
          </li>)}
        </ul> : <p className="project-widget-empty">No project notes yet.</p>}
    <Link className="project-widget-link" to={path}>Open Context<i className="ti ti-arrow-right" /></Link>
  </>;
}

function widgetContent(id, project, patch, taskBoard) {
  switch (id) {
    case 'crm': return <ProjectCrmPriority project={project} />;
    case 'upcoming': return taskBoard
      ? <ProjectTasks key={`${taskBoard.id}:${project.todo_column_name}`} board={taskBoard} column={project.todo_column_name} />
      : <p className="project-widget-empty">No To Do column linked.</p>;
    case 'services': return <ServiceLinks value={project.service_links || EMPTY_SERVICES} onChange={(links) => patch({ service_links: links })} />;
    case 'charter': return <ProjectCharter value={project.charter} onSave={(charter) => patch({ charter })} />;
    case 'context': return <ContextNotes project={project} />;
    case 'canvas': return <>
      {project.excalidraw_preview
        ? <img className="rollup-thumb" src={project.excalidraw_preview} alt="Project canvas preview" />
        : <p className="project-widget-empty">The canvas is empty.</p>}
      <Link className="project-widget-link" to={projectPath(project.id, 'excalidraw')}>Open Excalidraw<i className="ti ti-arrow-right" /></Link>
    </>;
    default: return null;
  }
}

function Widget({ id, editing, lane, height, onResize, onMove, onRemove, project, patch, taskBoard }) {
  const { title, icon } = PROJECT_WIDGETS[id];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  const start = useRef(null);
  const currentHeight = (element) => element.closest('.project-widget').getBoundingClientRect().height;
  function resizeByKey(event) {
    const amount = event.shiftKey ? 48 : 12;
    const value = height ?? currentHeight(event.currentTarget);
    switch (event.key) {
      case 'ArrowUp': onResize(value - amount); break;
      case 'ArrowDown': onResize(value + amount); break;
      case 'Home': onResize(MIN_PROJECT_WIDGET_HEIGHT); break;
      case 'End': onResize(MAX_PROJECT_WIDGET_HEIGHT); break;
      case 'Delete': onResize(null); break;
      default: return;
    }
    event.preventDefault();
  }
  return <section className={`project-widget project-widget--${id}`} ref={setNodeRef} data-resized={height != null}
    style={{ height, transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}>
    <header className="project-widget-title">
      <h2><i className={`ti ${icon}`} aria-hidden="true" />{title}</h2>
      {editing && <div className="project-widget-tools">
        <button className="btn btn--ghost btn--icon" type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${title}`} title={`Reorder ${title}`}><i className="ti ti-grip-vertical" /></button>
        <button className="btn btn--ghost btn--icon" type="button" onClick={onMove} aria-label={`Move ${title} to ${lane ? 'main' : 'side'} column`} title={`Move to ${lane ? 'main' : 'side'} column`}><i className={`ti ti-arrow-${lane ? 'left' : 'right'}`} /></button>
        <button className="btn btn--ghost btn--icon" type="button" onClick={onRemove} aria-label={`Hide ${title}`} title={`Hide ${title}`}><i className="ti ti-x" /></button>
      </div>}
    </header>
    <div className="project-widget-content" inert={editing ? '' : undefined}>{widgetContent(id, project, patch, taskBoard)}</div>
    {editing && <div className="project-widget-resize" role="separator" aria-orientation="horizontal" tabIndex={0}
      aria-label={`Resize ${title}`} aria-valuemin={MIN_PROJECT_WIDGET_HEIGHT} aria-valuemax={MAX_PROJECT_WIDGET_HEIGHT}
      aria-valuenow={height ?? MIN_PROJECT_WIDGET_HEIGHT} aria-valuetext={height == null ? 'Automatic height' : `${height} pixels`}
      title="Drag or use arrow keys to resize. Double-click to reset."
      onKeyDown={resizeByKey} onDoubleClick={() => onResize(null)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        start.current = { y: event.clientY, height: currentHeight(event.currentTarget) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { if (start.current) onResize(start.current.height + event.clientY - start.current.y); }}
      onLostPointerCapture={() => { start.current = null; }}
    />}
  </section>;
}

function Column({ index, widgets, editing, onChange, heights, onResize, project, patch, taskBoard }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${index}`, disabled: !editing });
  return <div className="project-widgets-column" ref={setNodeRef} data-drop={isOver}>
    <SortableContext items={widgets} strategy={verticalListSortingStrategy}>
      {widgets.map((id) => <Widget key={id} id={id} project={project} patch={patch} taskBoard={taskBoard} editing={editing} lane={index}
        height={heights[id]} onResize={(height) => onResize(id, height)} onMove={() => onChange(id, 1 - index)} onRemove={() => onChange(id)} />)}
    </SortableContext>
    {editing && !widgets.length && <div className="project-widgets-drop">Drop a widget here</div>}
  </div>;
}

export default function ProjectDashboard({ project, patch }) {
  const { settings, updateUiPreferences, user } = useAuth();
  const { todoBoards } = useWorkspace();
  const boards = todoBoards.rows.filter((board) => board.user_id === user?.id && !board.id.startsWith('tmp-'));
  const taskBoard = boards.find((board) => board.id === project.todo_board_id && columnsOf(board, KANBAN_COLUMNS).includes(project.todo_column_name));
  const preference = `projectDashboard-${project.id}`;
  const saved = settings?.ui_preferences?.[preference];
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const layout = draft?.columns || projectLayout(saved?.columns);
  const sideWidth = draft?.sideWidth ?? projectSideWidth(saved?.sideWidth);
  const heights = draft?.heights ?? projectWidgetHeights(saved?.heights);
  const crmEnabled = Boolean(project.crm_board_id);
  const visibleLayout = crmEnabled ? layout : layout.map((column) => column.filter((id) => id !== 'crm'));
  const available = Object.keys(PROJECT_WIDGETS).filter((id) =>
    (id !== 'crm' || crmEnabled) && !layout.some((column) => column.includes(id))
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const change = (id, column, before) => {
    if (!saving) setDraft((current) => ({ ...current, columns: moveProjectWidget(current.columns, id, column, before) }));
  };
  const resize = (id, value) => {
    if (saving) return;
    setDraft((current) => ({ ...current, heights: { ...current.heights, [id]: projectWidgetHeight(value) } }));
  };

  function dragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const column = over.id === 'column-0' ? 0 : over.id === 'column-1' ? 1
      : layout.findIndex((items) => items.includes(over.id));
    if (column >= 0) change(active.id, column, over.id.startsWith('column-') ? undefined : over.id);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await updateUiPreferences(preference, { ...draft, heights: projectWidgetHeights(draft.heights) });
      setDraft(null);
    } catch (reason) {
      setError(reason.message || 'Could not save the dashboard.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="project-dashboard" aria-label="Project dashboard">
    <div className="project-dashboard-toolbar">
      {draft ? <>
        <label className="project-column-width"><span>Side column width</span>
          <input type="range" min="26" max="48" value={sideWidth} disabled={saving} onChange={(event) => setDraft({ ...draft, sideWidth: event.target.valueAsNumber })} />
        </label>
        {available.length > 0 && <select className="select" aria-label="Add widget" value="" disabled={saving} onChange={(event) => {
          const id = event.target.value;
          if (id) change(id, id === 'services' ? 1 : 0);
        }}>
          <option value="">Add widget</option>
          {available.map((id) => <option key={id} value={id}>{PROJECT_WIDGETS[id].title}</option>)}
        </select>}
        <button className="btn btn--ghost" disabled={saving} onClick={() => setDraft({ columns: DEFAULT_PROJECT_LAYOUT, sideWidth: DEFAULT_PROJECT_SIDE_WIDTH, heights: {} })}>Reset</button>
        <button className="btn btn--ghost" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
        <button className="btn btn--accent" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save layout'}</button>
      </> : <button className="btn btn--ghost" onClick={() => setDraft({ columns: layout, sideWidth, heights })}><i className="ti ti-layout-grid" /> Customize</button>}
    </div>
    {error && <p className="project-error" role="alert">{error}</p>}
    {!draft && visibleLayout.every((column) => !column.length) && <p className="project-widget-empty">Use Customize to add widgets.</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      <div className="project-widgets" style={{ '--project-side-width': `${sideWidth}fr`, '--project-main-width': `${100 - sideWidth}fr` }}
        data-single={!draft && visibleLayout.some((column) => !column.length)}>
        {visibleLayout.map((widgets, index) => (draft || widgets.length > 0) && <Column key={index} index={index} widgets={widgets}
          editing={!!draft} onChange={change} heights={heights} onResize={resize} project={project} patch={patch} taskBoard={taskBoard} />)}
      </div>
    </DndContext>
  </section>;
}
