import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useAuth } from './AuthProvider.jsx';
import { channelLabel } from '../lib/helpers.js';
import { AGENTS } from '../lib/agentRegistry.js';

const MIN_WIDTH = 120;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 204;
const WIDTH_KEY = 'ctrlpanel-sidebar-width';
const FOLDERS_KEY = 'ctrlpanel-sidebar-folders';

// Top-level links (exact icons per AGENTS.md)
const TOP_LINKS = [
  { to: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'ti-calendar' },
  { to: '/todo', label: 'To Do', icon: 'ti-checkbox' },
  { to: '/knowledge', label: 'Knowledge Base', icon: 'ti-notebook' },
  { to: '/habits', label: 'Habits', icon: 'ti-repeat' },
  { to: '/review', label: 'Weekly Review', icon: 'ti-report' },
];

// Static grouping folders (fixed sub-pages)
const STATIC_FOLDERS = [
  {
    label: 'Health',
    icon: 'ti-heart',
    items: [
      { label: 'Nutrition', to: '/health/nutrition' },
      { label: 'Supplements', to: '/health/supplements' },
      { label: 'Fitness', to: '/health/fitness' },
    ],
  },
  {
    label: 'Finance',
    icon: 'ti-coin',
    items: [
      { label: 'Net Worth', to: '/finance/networth' },
      { label: 'Budget', to: '/finance/budget' },
      { label: 'Investing', to: '/finance/investing' },
    ],
  },
];

function navClass({ isActive }) {
  return `nav-item ${isActive ? 'active' : ''}`;
}

function subClass({ isActive }) {
  return `nav-subitem ${isActive ? 'active' : ''}`;
}

/**
 * A sidebar folder is only ever a folder: clicking the header expands or
 * collapses it, it never navigates anywhere. Sections that have an overview
 * page (where new items get created) expose it through the small manage
 * button on the right of the header instead.
 */
function Folder({ folder, collapsed, open, onToggle }) {
  const [flyTop, setFlyTop] = useState(null);
  const rowRef = useRef(null);
  const items = folder.items || [];

  const empty = items.length === 0 && folder.emptyLabel && (
    <div className="nav-subitem nav-subitem--empty">{folder.emptyLabel}</div>
  );

  const links = items.map((item, i) => (
    <NavLink key={`${item.to}-${i}`} to={item.to} end className={subClass}>
      {item.label}
    </NavLink>
  ));

  // Collapsed rail: the icon opens a hover flyout with the same sub-pages.
  // Positioned fixed because the sidebar itself scrolls / clips overflow.
  if (collapsed) {
    return (
      <div
        className="nav-folder nav-folder--rail"
        ref={rowRef}
        onMouseEnter={() => setFlyTop(rowRef.current?.getBoundingClientRect().top ?? 0)}
        onMouseLeave={() => setFlyTop(null)}
      >
        <div className="nav-item" title={folder.label}>
          <i className={`ti ${folder.icon}`} />
        </div>
        {flyTop !== null && (
          <div className="nav-flyout" style={{ top: flyTop }}>
            <div className="nav-flyout-title">{folder.label}</div>
            {empty}
            {links}
            {folder.indexTo && (
              <NavLink to={folder.indexTo} end className="nav-flyout-manage">
                <i className="ti ti-plus" /> Manage {folder.label}
              </NavLink>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="nav-folder">
      <div
        className="nav-folder-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => onToggle(folder.label)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(folder.label);
          }
        }}
      >
        <i className={`ti ${folder.icon}`} />
        <span className="nav-folder-label">{folder.label}</span>
        {folder.indexTo && (
          <NavLink
            to={folder.indexTo}
            end
            className="nav-folder-action"
            title={`Manage ${folder.label}`}
            onClick={(e) => e.stopPropagation()}
          >
            <i className="ti ti-plus" />
          </NavLink>
        )}
        <i className={`ti ti-chevron-right nav-folder-chevron ${open ? 'open' : ''}`} />
      </div>
      {open && empty}
      {open && links}
    </div>
  );
}

export default function Sidebar({ collapsed = false, drawer = false, open = false, onClose }) {
  const { projects, crmBoards, socials } = useWorkspace();
  const { settings, updateUiPreferences } = useAuth();
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    return Number.isFinite(saved) ? saved : DEFAULT_WIDTH;
  });
  const [openFolders, setOpenFolders] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLDERS_KEY));
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  });
  const draggingRef = useRef(false);
  const hydratedRef = useRef(false);
  const savedWidth = Number(settings?.ui_preferences?.sidebar?.width);
  const savedFolders = settings?.ui_preferences?.sidebar?.folders;

  useEffect(() => {
    if (Number.isFinite(savedWidth)) {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, savedWidth)));
    }
  }, [savedWidth]);

  // Adopt the saved open/closed state once, so a toggle made while settings
  // were still loading isn't stomped by the server copy.
  useEffect(() => {
    if (hydratedRef.current || !savedFolders || typeof savedFolders !== 'object') return;
    hydratedRef.current = true;
    setOpenFolders(savedFolders);
  }, [savedFolders]);

  // Folders default to open; only an explicit `false` collapses one.
  const isOpen = (label) => openFolders[label] ?? !['Health', 'Socials'].includes(label);
  const toggleFolder = (label) => {
    const next = { ...openFolders, [label]: !isOpen(label) };
    setOpenFolders(next);
    hydratedRef.current = true;
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
    updateUiPreferences('sidebar', { folders: next }).catch(() => {});
  };

  const onMouseDown = useCallback(
    (e) => {
      if (collapsed) return;
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [collapsed]
  );

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(WIDTH_KEY, String(width));
      updateUiPreferences('sidebar', { width }).catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [updateUiPreferences, width]);

  // CRM, Projects + Socials are dynamic per-user; Agents come from the agent
  // registry (src/lib/agentRegistry.js); Health + Finance are fixed. `indexTo`
  // is the section's overview page — reached from the header's manage button,
  // never by clicking the folder itself.
  const folders = [
    {
      label: 'CRM',
      icon: 'ti-users',
      indexTo: '/crm',
      emptyLabel: 'No CRM pages yet',
      items: crmBoards.rows.map((b) => ({ label: b.name || 'Untitled', to: `/crm/${b.id}` })),
    },
    {
      label: 'Agents',
      icon: 'ti-robot',
      indexTo: '/agents',
      emptyLabel: 'No agents yet',
      items: AGENTS.map((a) => ({ label: a.name, to: a.to })),
    },
    {
      label: 'Projects',
      icon: 'ti-folder',
      indexTo: '/projects',
      emptyLabel: 'No projects yet',
      items: projects.rows.map((p) => ({ label: p.name || 'Untitled', to: `/projects/${p.id}` })),
    },
    ...STATIC_FOLDERS,
    {
      label: 'Socials',
      icon: 'ti-share',
      indexTo: '/socials',
      emptyLabel: 'No channels yet',
      items: socials.channels.map((c) => ({ label: channelLabel(c), to: `/socials/youtube/${c.id}` })),
    },
  ];

  return (
    <aside
      id="app-sidebar"
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${drawer ? 'sidebar--drawer' : ''} ${drawer && open ? 'is-open' : ''}`}
      style={collapsed || drawer ? undefined : { width }}
      aria-hidden={drawer && !open ? 'true' : undefined}
    >
      <div className="sidebar-brand">
        {drawer && (
          <button className="nav-close" onClick={onClose} aria-label="Close menu"><i className="ti ti-x" /></button>
        )}
        {collapsed ? (
          <div className="sidebar-brand-name" style={{ textAlign: 'center' }}>C</div>
        ) : (
          <>
            <div className="sidebar-brand-name">CTRLpanel</div>
            <div className="sidebar-brand-tag">by cwmccann.pro</div>
          </>
        )}
      </div>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav">
        {TOP_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={navClass} title={link.label}>
            <i className={`ti ${link.icon}`} />
            {!collapsed && <span>{link.label}</span>}
          </NavLink>
        ))}

        {!collapsed && <div className="sidebar-divider" />}

        {folders.map((folder) => (
          <Folder
            key={folder.label}
            folder={folder}
            collapsed={collapsed}
            open={isOpen(folder.label)}
            onToggle={toggleFolder}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/settings" className={navClass} title="Settings">
          <i className="ti ti-settings" />
          {!collapsed && <span>Settings</span>}
        </NavLink>
      </div>

      {!collapsed && !drawer && (
        <div
          className="sidebar-resizer"
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize"
        />
      )}
    </aside>
  );
}
