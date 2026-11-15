import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/AuthProvider.jsx';
import { useToast } from '../components/Toaster.jsx';
import { useCrud, useRows } from './useData.js';
import { doneColumn } from './commandPalette.js';
import { DEFAULT_MINS, clampDuration, findFreeSlot, sanitizeBlocks, taskItems } from './taskBlocks.js';

/**
 * To Do tasks as calendar time blocks. Blocks live in
 * user_settings.ui_preferences.calendar.blocks ({ taskId: { start, mins } });
 * edits apply instantly and are saved in the background (reverted on failure).
 * Shared by the Calendar page and the Day Plan dashboard panel.
 */
export function useTaskPlanner() {
  const { settings, updateUiPreferences } = useAuth();
  const toast = useToast();
  const { rows: tasks, patch, loading, reload } = useCrud('tasks');
  const { rows: boards } = useRows('boards', []);

  const saved = settings?.ui_preferences?.calendar?.blocks;
  const [local, setLocal] = useState(null); // optimistic copy until the save lands
  useEffect(() => setLocal(null), [saved]);
  const blocks = useMemo(() => sanitizeBlocks(local ?? saved), [local, saved]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const doneOf = useCallback(
    (task) => {
      const board = boards.find((b) => b.id === task.board_id);
      return String(task.column_name || '') === doneColumn(board);
    },
    [boards]
  );

  const commit = useCallback(
    async (next) => {
      const previous = blocksRef.current;
      blocksRef.current = next;
      setLocal(next);
      try {
        await updateUiPreferences('calendar', { blocks: next });
      } catch {
        blocksRef.current = previous;
        setLocal(previous);
        toast({ tone: 'error', message: 'Couldn’t save that change. Check your connection.' });
      }
    },
    [updateUiPreferences, toast]
  );

  const items = useMemo(() => taskItems(blocks, tasks, doneOf), [blocks, tasks, doneOf]);
  const openTasks = useMemo(() => tasks.filter((t) => !doneOf(t)), [tasks, doneOf]);
  const unscheduled = useMemo(() => openTasks.filter((t) => !blocks[t.id]), [openTasks, blocks]);

  const schedule = useCallback(
    (taskId, start, mins) => {
      const cur = blocksRef.current[taskId];
      return commit({ ...blocksRef.current, [taskId]: { start: new Date(start).toISOString(), mins: clampDuration(mins ?? cur?.mins ?? DEFAULT_MINS) } });
    },
    [commit]
  );
  const unschedule = useCallback(
    (taskId) => {
      const { [taskId]: _gone, ...rest } = blocksRef.current;
      return commit(rest);
    },
    [commit]
  );
  const resize = useCallback(
    (taskId, mins) => {
      const cur = blocksRef.current[taskId];
      if (!cur) return undefined;
      return commit({ ...blocksRef.current, [taskId]: { ...cur, mins: clampDuration(mins) } });
    },
    [commit]
  );

  const toggleDone = useCallback(
    (task) => {
      const board = boards.find((b) => b.id === task.board_id);
      const done = doneOf(task);
      const reopen = (Array.isArray(board?.columns) && board.columns.find((c) => c !== doneColumn(board))) || 'Backlog';
      return patch(task.id, { column_name: done ? reopen : doneColumn(board) });
    },
    [boards, doneOf, patch]
  );

  /** Schedule or move a task and offer Undo. `title` names it when this hook hasn't loaded the row yet. */
  const place = useCallback(
    (taskId, start, mins, title) => {
      const prev = blocksRef.current[taskId];
      const task = tasks.find((t) => t.id === taskId);
      schedule(taskId, start, mins);
      const when = new Date(start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      toast({
        message: `${prev ? 'Moved' : 'Scheduled'} “${task?.title || title || 'task'}” · ${when}`,
        action: { label: 'Undo', onClick: () => (prev ? schedule(taskId, prev.start, prev.mins) : unschedule(taskId)) },
      });
    },
    [tasks, schedule, unschedule, toast]
  );

  /** Put a task in the first free gap at/after now (or `from`), around everything in `busyItems`. */
  const snapToNextFree = useCallback(
    (task, busyItems, { mins, from } = {}) => {
      const length = clampDuration(mins ?? blocksRef.current[task.id]?.mins ?? DEFAULT_MINS);
      const slot = findFreeSlot({ items: busyItems, from: from || new Date(), mins: length, skipTaskId: task.id });
      if (!slot) {
        toast({ tone: 'error', message: 'No free slot in the next 7 days.' });
        return null;
      }
      place(task.id, slot, length);
      return slot;
    },
    [place, toast]
  );

  return { tasks, openTasks, unscheduled, blocks, items, loading, reload, doneOf, schedule, place, unschedule, resize, toggleDone, snapToNextFree };
}
