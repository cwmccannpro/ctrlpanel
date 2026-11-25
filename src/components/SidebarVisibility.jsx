import { useEffect, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from './AuthProvider.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { SIDEBAR_PINNED, SIDEBAR_ROOT, mergeSidebarOrder, orderedSidebarEntries, sidebarEntryId, sidebarItemVisible, sidebarNavigation } from '../lib/sidebarNavigation.js';
import '../styles/sidebarVisibility.css';

function keyboardRowCoordinates(event, { context: { active, over, droppableRects } }) {
  const step = { ArrowUp: -1, ArrowDown: 1 }[event.code];
  if (!step || !active) return;
  event.preventDefault();
  const items = active.data.current?.sortable?.items || [];
  const current = items.indexOf(over?.id ?? active.id);
  if (current < 0) return;
  const target = droppableRects.get(items[current + step]);
  if (target) return { x: target.left, y: target.top };
}

function sidebarCollisions(args) {
  if (args.pointerCoordinates) return pointerWithin(args);
  // Align by the row's top edge so a folder with children can move past a shorter link.
  const collisions = [];
  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (rect) collisions.push({
      id: container.id,
      data: { droppableContainer: container, value: Math.abs(rect.top - args.collisionRect.top) },
    });
  }
  return collisions.sort((a, b) => a.data.value - b.data.value);
}

function SidebarOrderRow({ entry, shown, visibilityDisabled, locked, sortable, autoFocus, onToggle, children }) {
  const id = sidebarEntryId(entry);
  const divider = id === SIDEBAR_PINNED;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    disabled: { draggable: locked || !sortable || divider, droppable: locked || !sortable },
  });
  return (
    <div
      className={`sidebar-order-item${isDragging ? ' is-dragging' : ''}`}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {divider ? <div className={`sidebar-order-divider${isOver ? ' is-over' : ''}`}>{entry.label}</div> : <>
        <div className="sidebar-visibility-row">
          {sortable && <button className="btn btn--ghost btn--icon sidebar-order-handle" type="button" ref={setActivatorNodeRef}
            {...attributes} {...listeners} aria-label={`Reorder ${entry.label}`} title={`Reorder ${entry.label}`}
            disabled={locked} autoFocus={autoFocus}>
            <i className="ti ti-grip-vertical" aria-hidden="true" />
          </button>}
          <label className="sidebar-visibility-option">
            {entry.icon && <i className={`ti ${entry.icon}`} aria-hidden="true" />}
            <span>{entry.label}</span>
            {entry.alwaysVisible ? <small className="list-row-meta">Always visible</small> : <input
              type="checkbox" checked={shown(id)} disabled={visibilityDisabled}
              aria-label={`Show ${entry.label} in sidebar`} onChange={(event) => onToggle(id, event.target.checked)}
            />}
          </label>
        </div>
        {children}
      </>}
    </div>
  );
}

function SidebarOrderList({ entries, group, sensors, locked, visibilityDisabled = false, autoFocus = false, shown, onToggle, onReorder }) {
  const ids = entries.map(sidebarEntryId);
  const sortable = entries.length > 1;
  const label = (id) => entries[ids.indexOf(id)]?.label || id;
  const dragEnd = ({ active, over }) => {
    if (!over || locked || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from >= 0 && to >= 0) onReorder(group, arrayMove(ids, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={sidebarCollisions} onDragEnd={dragEnd} accessibility={{ announcements: {
      onDragStart: ({ active }) => `Picked up ${label(active.id)}.`,
      onDragOver: ({ active, over }) => over && active.id !== over.id ? `${label(active.id)} over ${label(over.id)}.` : undefined,
      onDragEnd: ({ active, over }) => over ? `Dropped ${label(active.id)}.` : `Could not move ${label(active.id)}.`,
      onDragCancel: ({ active }) => `Canceled moving ${label(active.id)}.`,
    } }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {entries.map((entry, index) => (
          <SidebarOrderRow key={sidebarEntryId(entry)} entry={entry} shown={shown} visibilityDisabled={visibilityDisabled}
            locked={locked} sortable={sortable} autoFocus={autoFocus && index === 0} onToggle={onToggle}>
            {entry.items?.length > 0 && <div className="sidebar-visibility-group">
              <SidebarOrderList entries={entry.items} group={entry.id} sensors={sensors} shown={shown}
                locked={locked} visibilityDisabled={!shown(entry.id)} onToggle={onToggle} onReorder={onReorder} />
            </div>}
          </SidebarOrderRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

export default function SidebarVisibility({ autoFocus = false }) {
  const { settings, updateUiPreferences } = useAuth();
  const { projects, socials } = useWorkspace();
  const [pending, setPending] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardRowCoordinates })
  );

  const preferences = settings?.ui_preferences;
  const visibility = preferences?.sidebarVisibility || {};
  const order = preferences?.sidebarOrder || {};
  const draftVisibility = pending?.section === 'sidebarVisibility' ? { ...visibility, ...pending.patch } : visibility;
  const shown = (id) => sidebarItemVisible(draftVisibility, id);
  const entries = orderedSidebarEntries(sidebarNavigation({ projects: projects.rows, socials }),
    pending?.section === 'sidebarOrder' ? { ...order, ...pending.patch } : order);
  const locked = !settings || !!pending;

  useEffect(() => {
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [pending]);

  const save = async (section, patch) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    restoreFocusRef.current = document.activeElement;
    setPending({ section, patch });
    setStatus('Saving…');
    setError('');
    try {
      await updateUiPreferences(section, patch);
      setStatus('Saved');
    } catch (err) {
      setStatus('');
      setError(`Couldn’t save sidebar choices: ${err.message}`);
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  return (
    <div className="sidebar-visibility">
      <div className="sidebar-visibility-tools">
        <p className="body-text">Drag to reorder. Move items below the divider to pin them.</p>
        <button className="btn btn--sm" type="button" disabled={locked || !Object.values(visibility).includes(false)}
          onClick={() => save('sidebarVisibility', Object.fromEntries(Object.keys(visibility).map((id) => [id, true])))}
        >Show all</button>
      </div>
      <fieldset disabled={locked} aria-busy={!!pending}>
        <legend className="sr-only">Sidebar order and visibility</legend>
        <SidebarOrderList entries={entries} group={SIDEBAR_ROOT} sensors={sensors} locked={locked} autoFocus={autoFocus}
          shown={shown} onToggle={(id, checked) => save('sidebarVisibility', { [id]: checked })}
          onReorder={(group, ids) => save('sidebarOrder', { [group]: mergeSidebarOrder(order[group], ids) })} />
      </fieldset>
      <span className="list-row-meta" role="status">{settings ? status : 'Loading sidebar choices…'}</span>
      {error && <p className="text-red" role="alert">{error}</p>}
    </div>
  );
}
