// Board/column rules for the To Do page (pure, so they can be unit-tested).

/** A board's columns, or the defaults when it has none. */
export const columnsOf = (board, defaults) => (board?.columns?.length ? board.columns : defaults);

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
