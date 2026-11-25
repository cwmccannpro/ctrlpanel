export const PROJECT_WIDGETS = {
  crm: { title: 'CRM priorities', icon: 'ti-address-book' },
  upcoming: { title: 'To Do', icon: 'ti-columns-3' },
  services: { title: 'Services', icon: 'ti-link' },
  charter: { title: 'Charter', icon: 'ti-target-arrow' },
  context: { title: 'Context notes', icon: 'ti-notebook' },
  canvas: { title: 'Excalidraw preview', icon: 'ti-pencil' },
};

export const DEFAULT_PROJECT_LAYOUT = [['crm', 'upcoming'], ['services']];
export const DEFAULT_PROJECT_SIDE_WIDTH = 33;
export const MIN_PROJECT_WIDGET_HEIGHT = 124;
export const MAX_PROJECT_WIDGET_HEIGHT = 900;

export function projectSideWidth(value) {
  return Number.isFinite(value) ? Math.max(26, Math.min(48, value)) : DEFAULT_PROJECT_SIDE_WIDTH;
}

export function projectWidgetHeight(value) {
  return Number.isFinite(value)
    ? Math.round(Math.max(MIN_PROJECT_WIDGET_HEIGHT, Math.min(MAX_PROJECT_WIDGET_HEIGHT, value)))
    : null;
}

export function projectWidgetHeights(saved) {
  return Object.fromEntries(Object.keys(PROJECT_WIDGETS).map((id) => [id, projectWidgetHeight(saved?.[id])])
    .filter(([, height]) => height != null));
}

export function projectLayout(saved) {
  if (!Array.isArray(saved) || saved.length !== 2 || !saved.every(Array.isArray)) return DEFAULT_PROJECT_LAYOUT;
  const seen = new Set();
  return saved.map((column) => column.filter((id) => {
    if (!Object.hasOwn(PROJECT_WIDGETS, id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }));
}

export function moveProjectWidget(layout, id, destination, before) {
  if (id === before) return layout;
  const source = layout.findIndex((column) => column.includes(id));
  const next = layout.map((column) => column.filter((widget) => widget !== id));
  if (destination == null) return next;
  const index = before ? layout[destination].indexOf(before) : next[destination].length;
  if (index < 0) return layout;
  if (source === destination) {
    next[destination].splice(index, 0, id);
  } else {
    next[destination] = [...next[destination].slice(0, index), id, ...next[destination].slice(index)];
  }
  return next;
}
