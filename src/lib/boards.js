// Board/column rules for the To Do page (pure, so they can be unit-tested).

/** A board's columns, or the defaults when it has none. */
export const columnsOf = (board, defaults) => (board?.columns?.length ? board.columns : defaults);

const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
export const compareTaskPriority = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
  || String(a.created_at || '').localeCompare(String(b.created_at || ''));

/**
 * Columns for the combined "All Boards" view: the default columns, then every custom
 * column any board (or task) uses — otherwise tasks sitting in "Doing" or "Inbox" are
 * invisible there.
 */
export function allBoardsColumns(defaults, boards = [], tasks = []) {
  const extra = [];
  const add = (c) => {
    if (c && !defaults.includes(c) && !extra.includes(c)) extra.push(c);
  };
  boards.forEach((b) => (b.columns || []).forEach(add));
  tasks.forEach((t) => add(t.column_name));
  return [...defaults, ...extra];
}

/**
 * In the combined view a card can be dragged over any column, but it may only land
 * in a column its own board has — otherwise it would vanish from that board.
 */
export function canDropInColumn(task, boards = [], defaults, column) {
  const board = boards.find((b) => b.id === task?.board_id);
  return columnsOf(board, defaults).includes(column);
}

/**
 * The one board the dashboard and the bare /todo route use: the board most projects
 * link to, then the one holding the most open tasks, then the newest. Ignores
 * unsaved (tmp-) rows. Returns null when there are no boards.
 */
export function primaryBoard(boards = [], { tasks = [], projects = [] } = {}) {
  const saved = boards.filter((b) => b && !String(b.id).startsWith('tmp-'));
  if (saved.length <= 1) return saved[0] || null;
  const links = (b) => projects.filter((p) => p.todo_board_id === b.id).length;
  const open = (b) => tasks.filter((t) => t.board_id === b.id && !/^done$/i.test(String(t.column_name || '').trim())).length;
  const score = (b) => [links(b), open(b), String(b.created_at || '')];
  return [...saved].sort((a, b) => {
    const [la, oa, ca] = score(a);
    const [lb, ob, cb] = score(b);
    return lb - la || ob - oa || cb.localeCompare(ca);
  })[0];
}
