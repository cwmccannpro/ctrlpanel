import { useCallback, useMemo } from 'react';
import { useAuth } from '../components/AuthProvider.jsx';
import { DEFAULT_MINS, sanitizeBlocks } from './taskBlocks.js';
import { setTaskDrag, useTaskDrag } from './taskDrag.js';

/**
 * Makes a dashboard task row draggable onto the Day Plan timeline.
 *
 *   const plan = useTaskDragSource();
 *   <div className={plan.rowClass(task)} {...plan.dragProps(task)}>
 *
 * A task that already has a time keeps its length when dragged again (it moves
 * rather than duplicating); anything else starts at the default length.
 * `plannedAt(task)` is the block's start (a Date) or null, for a "planned" marker.
 */
export function useTaskDragSource() {
  const { settings } = useAuth();
  const [drag] = useTaskDrag();
  const saved = settings?.ui_preferences?.calendar?.blocks;
  const blocks = useMemo(() => sanitizeBlocks(saved), [saved]);

  const dragProps = useCallback(
    (task) => {
      // A row that is still being inserted has a temporary id: nothing to schedule yet.
      if (!task?.id || String(task.id).startsWith('tmp-')) return {};
      return {
        draggable: true,
        onDragStart: (e) => {
          const mins = blocks[task.id]?.mins || DEFAULT_MINS;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', task.title || 'Task');
          // Deferred so the browser snapshots the row before it dims.
          setTimeout(() => setTaskDrag({ taskId: task.id, mins, grabMin: Math.min(10, mins / 2), from: 'panel', title: task.title }), 0);
        },
        onDragEnd: () => setTaskDrag(null),
      };
    },
    [blocks]
  );

  const plannedAt = useCallback((task) => (blocks[task?.id] ? new Date(blocks[task.id].start) : null), [blocks]);
  const rowClass = useCallback(
    (task) => `is-draggable${drag?.taskId === task?.id ? ' is-dragging' : ''}`,
    [drag]
  );

  return { dragProps, plannedAt, rowClass };
}
