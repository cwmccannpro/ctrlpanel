import { socialSections } from './socialPlatforms.js';

// Stable route/folder IDs keep visibility choices intact after a rename.
// `dock: true` links start at the bottom until the user changes their placement.
export const TOP_LINKS = [
  { to: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'ti-calendar' },
  { to: '/todo', label: 'To Do', icon: 'ti-checkbox' },
  { to: '/context', label: 'Context', icon: 'ti-notebook' },
  { to: '/habits', label: 'Habits', icon: 'ti-repeat' },
  { to: '/health', label: 'Health', icon: 'ti-heart' },
  { to: '/finance', label: 'Finance', icon: 'ti-coin' },
  { to: '/room', label: 'Room Control', icon: 'ti-bulb', dock: true },
  { to: '/drive', label: 'Drive', icon: 'ti-car', dock: true },
];

export const SIDEBAR_ROOT = 'root';
export const SIDEBAR_PINNED = 'sidebar:pinned';
export const sidebarEntryId = (entry) => entry.id || entry.to;

const SETTINGS_LINK = { to: '/settings', label: 'Settings', icon: 'ti-settings', dock: true, alwaysVisible: true };
const PINNED_DIVIDER = { id: SIDEBAR_PINNED, label: 'Pinned to bottom' };

function orderEntries(entries, saved) {
  if (!Array.isArray(saved)) return entries;
  const remaining = new Map(entries.map((entry) => [sidebarEntryId(entry), entry]));
  const ordered = [];
  for (const id of saved) {
    if (!remaining.has(id)) continue;
    ordered.push(remaining.get(id));
    remaining.delete(id);
  }
  return [...ordered, ...remaining.values()];
}

export function orderedSidebarEntries(navigation, order) {
  const saved = order?.[SIDEBAR_ROOT];
  const dividerIndex = Array.isArray(saved) ? saved.indexOf(SIDEBAR_PINNED) : -1;
  const orderedIds = new Set(dividerIndex < 0 ? [] : saved);
  const aboveDivider = new Set(dividerIndex < 0 ? [] : saved.slice(0, dividerIndex));
  const pinned = (entry) => {
    const id = sidebarEntryId(entry);
    return orderedIds.has(id) ? !aboveDivider.has(id) : Boolean(entry.dock);
  };
  const entries = [...navigation.links, ...navigation.folders, SETTINGS_LINK];
  return [
    ...orderEntries(entries.filter((entry) => !pinned(entry)), saved),
    PINNED_DIVIDER,
    ...orderEntries(entries.filter(pinned), saved),
  ].map((entry) => entry.items ? { ...entry, items: orderEntries(entry.items, order?.[entry.id]) } : entry);
}

// Keep the saved slots of pages that haven't loaded or are temporarily unavailable.
export function mergeSidebarOrder(saved, moved) {
  if (!Array.isArray(saved)) return moved;
  const known = new Set(moved);
  let index = 0;
  const retained = [...new Set(saved.filter((id) => typeof id === 'string'))]
    .map((id) => known.has(id) ? moved[index++] : id);
  return [...retained, ...moved.slice(index)];
}

export function sidebarNavigation({ projects = [], socials } = {}) {
  return {
    links: TOP_LINKS,
    folders: [
      {
        id: 'folder:projects', label: 'Projects', icon: 'ti-folder', indexTo: '/projects', emptyLabel: 'No projects yet',
        items: projects.map((p) => ({ label: p.name || 'Untitled', to: `/projects/${p.id}` })),
      },
      {
        id: 'folder:socials', label: 'Socials', icon: 'ti-share', indexTo: '/socials', emptyLabel: 'No accounts yet',
        items: socialSections(socials).map((s) => ({ label: s.label, to: s.to })),
      },
    ],
  };
}

// Absence means visible, so existing accounts and newly added sections keep
// their current navigation. Only an explicit false hides an entry.
export const sidebarItemVisible = (visibility, id) => (visibility?.[id] ?? (id === '/context' ? visibility?.['/knowledge'] : undefined)) !== false;

export function visibleSidebarNavigation(navigation, visibility) {
  return {
    links: navigation.links.filter((link) => sidebarItemVisible(visibility, link.to)),
    folders: navigation.folders
      .filter((folder) => sidebarItemVisible(visibility, folder.id))
      .map((folder) => {
        const items = folder.items.filter((item) => sidebarItemVisible(visibility, item.to));
        return { ...folder, items, emptyLabel: folder.items.length && !items.length ? 'All pages hidden' : folder.emptyLabel };
      })
      // An empty static folder has no destinations; dynamic folders retain
      // their Manage link, including when no pages/accounts exist yet.
      .filter((folder) => folder.items.length || folder.indexTo),
  };
}
