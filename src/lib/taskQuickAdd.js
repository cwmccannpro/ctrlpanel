import { parseCapture, taskRowFromCapture } from './commandPalette.js';
import { columnsOf } from './boards.js';
import { KANBAN_COLUMNS } from './mockData.js';

/** A quick capture belongs to the category shown by its dashboard panel. */
export function quickTaskRow(text, board, column, now = new Date()) {
  if (!board?.id || String(board.id).startsWith('tmp-')) throw new Error('Choose a saved board first.');
  const columns = columnsOf(board, KANBAN_COLUMNS);
  if (!columns.includes(column)) throw new Error('This category has changed. Choose a category and try again.');
  const capture = parseCapture(text, now);
  if (!capture.title) throw new Error('Enter a task name.');
  return { ...taskRowFromCapture(capture, board), column_name: column };
}

// Separate the checked write from the UI so a rejected/empty DB response
// cannot clear the draft or announce success. Ownership is assigned by RLS.
export async function saveQuickTask(text, board, column, insertTask, now = new Date()) {
  const row = quickTaskRow(text, board, column, now);
  const { data, error } = await insertTask('tasks', [row]);
  if (error) throw new Error(error.message || 'Couldn’t save the task. Try again.');
  if (!data?.[0]?.id) throw new Error('The task wasn’t saved. Try again.');
  return data[0];
}
