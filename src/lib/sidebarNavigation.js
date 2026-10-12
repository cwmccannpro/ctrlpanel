import { AGENTS } from './agentRegistry.js';
import { socialSections } from './socialPlatforms.js';

// Stable route/folder IDs keep visibility choices intact after a rename.
export const TOP_LINKS = [
  { to: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'ti-calendar' },
  { to: '/todo', label: 'To Do', icon: 'ti-checkbox' },
  { to: '/knowledge', label: 'Knowledge Base', icon: 'ti-notebook' },
  { to: '/habits', label: 'Habits', icon: 'ti-repeat' },
  { to: '/health', label: 'Health', icon: 'ti-heart' },
  { to: '/finance', label: 'Finance', icon: 'ti-coin' },
  { to: '/review', label: 'Weekly Review', icon: 'ti-report' },
];

export function sidebarNavigation({ projects = [], crmBoards = [], socials } = {}) {
  return {
    links: TOP_LINKS,
    folders: [
      {
        id: 'folder:crm', label: 'CRM', icon: 'ti-users', indexTo: '/crm', emptyLabel: 'No CRM pages yet',
        items: crmBoards.map((b) => ({ label: b.name || 'Untitled', to: `/crm/${b.id}` })),
      },
      {
        id: 'folder:agents', label: 'Agents', icon: 'ti-robot', indexTo: '/agents', emptyLabel: 'No agents yet',
        items: AGENTS.map((a) => ({ label: a.name, to: a.to })),
      },
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
export const sidebarItemVisible = (visibility, id) => visibility?.[id] !== false;

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
