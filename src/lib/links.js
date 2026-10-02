// Cross-links between tasks, projects, notes and events, derived from the relations the
// database already has — no new columns:
//   project.todo_board_id → boards.id → tasks.board_id        (a project's tasks)
//   knowledge_notes.project_id → projects.id                   (a project's notes)
//   events carry no id link, so they match on the project's name appearing in the title.
import { dayKey } from './helpers.js';
import { doneColumn } from './commandPalette.js';

const real = (id) => id && !String(id).startsWith('tmp-');

/** The project whose To Do board this is, or null. */
export function projectForBoard(projects = [], boardId) {
  return real(boardId) ? projects.find((p) => p.todo_board_id === boardId) || null : null;
}

export const projectForTask = (task, projects) => projectForBoard(projects, task?.board_id);

export const tasksOfProject = (tasks = [], project) =>
  project?.todo_board_id ? tasks.filter((t) => t.board_id === project.todo_board_id) : [];

export const notesOfProject = (notes = [], projectId) => notes.filter((n) => n.project_id === projectId);

/** Events whose title mentions the project (case-insensitive; names under 3 chars are too vague to match). */
export function eventsMentioning(events = [], project, { fromKey = dayKey(new Date()), limit = 5 } = {}) {
  const name = String(project?.name || '').trim().toLowerCase();
  if (name.length < 3) return [];
  return events
    .filter((e) => String(e.title || '').toLowerCase().includes(name) && String(e.starts_at || '').slice(0, 10) >= fromKey)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .slice(0, limit);
}

/**
 * What a project page should surface at a glance: open work, what is late or due soon,
 * the notes written for it, and events that mention it.
 */
export function projectDigest({ project, tasks = [], boards = [], notes = [], events = [], today = dayKey(new Date()), soonDays = 14 }) {
  const board = boards.find((b) => b.id === project?.todo_board_id);
  const done = (t) => (t.column_name || '') === 'Done' || (t.column_name || '') === doneColumn(board);
  const mine = tasksOfProject(tasks, project);
  const open = mine.filter((t) => !done(t));
  const [y, m, d] = today.split('-').map(Number);
  const limit = new Date(y, m - 1, d + soonDays);
  const limitKey = dayKey(limit);
  const dueKey = (t) => String(t.due_date || '').slice(0, 10);
  const byDue = (a, b) => dueKey(a).localeCompare(dueKey(b));
  return {
    total: mine.length,
    open: open.length,
    overdue: open.filter((t) => dueKey(t) && dueKey(t) < today).sort(byDue),
    dueSoon: open.filter((t) => dueKey(t) && dueKey(t) >= today && dueKey(t) <= limitKey).sort(byDue),
    notes: notesOfProject(notes, project?.id),
    events: eventsMentioning(events, project, { fromKey: today }),
  };
}
