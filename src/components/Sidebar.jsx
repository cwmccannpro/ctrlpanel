import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';

const MIN_WIDTH = 120;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 148;
const WIDTH_KEY = 'ctrlpanel-sidebar-width';

// Top-level links (exact icons per AGENTS.md)
const TOP_LINKS = [
  { to: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'ti-calendar' },
  { to: '/todo', label: 'To Do', icon: 'ti-checkbox' },
  { to: '/habits', label: 'Habits', icon: 'ti-repeat' },
];

// Static grouping folders (fixed sub-pages)
const STATIC_FOLDERS = [
  {
    label: 'Health',
    icon: 'ti-heart',
    base: '/health',
    items: [
      { label: 'Nutrition', to: '/health/nutrition' },
      { label: 'Supplements', to: '/health/supplements' },
      { label: 'Fitness', to: '/health/fitness' },
    ],
  },
  {
    label: 'Finance',
    icon: 'ti-coin',
    base: '/finance',
    items: [
      { label: 'Net Worth', to: '/finance/networth' },
      { label: 'Budget', to: '/finance/budget' },
      { label: 'Investing', to: '/finance/investing' },
    ],
  },
  {
    label: 'Reports',
    icon: 'ti-report',
    base: '/reports/mail',
    items: [
      { label: 'Mail Triage', to: '/reports/mail' },
    ],
  },
];

function navClass({ isActive }) {
  return `nav-item ${isActive ? 'active' : ''}`;
}

function Folder({ folder, collapsed }) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();

  if (collapsed) {
    return (
      <NavLink to={folder.base || folder.items[0]?.to || '/'} className={navClass} title={folder.label}>
        <i className={`ti ${folder.icon}`} />
      </NavLink>
    );
  }

  const headerClick = () => {
    if (folder.base) {
      navigate(folder.base);
      setOpen(true);
    } else {
      setOpen((o) => !o);
    }
  };

  return (
    <div>
      <div className="nav-folder-header" onClick={headerClick}>
        <i className={`ti ${folder.icon}`} />
        <span>{folder.label}</span>
        <i
          className={`ti ti-chevron-right nav-folder-chevron ${open ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        />
      </div>
      {open && folder.items.length === 0 && folder.emptyLabel && (
        <div className="nav-subitem muted" style={{ cursor: 'default' }}>{folder.emptyLabel}</div>
      )}
      {open &&
        folder.items.map((item, i) => (
          <NavLink
            key={`${item.to}-${i}`}
            to={item.to}
            end
            className={({ isActive }) => `nav-subitem ${isActive ? 'active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
    </div>
  );
}

export default function Sidebar({ collapsed = false }) {
  const { projects, agents, crmBoards } = useWorkspace();
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    return Number.isFinite(saved) ? saved : DEFAULT_WIDTH;
  });
  const draggingRef = useRef(false);

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
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width]);

  // CRM, Agents + Projects are dynamic per-user; Health + Finance are fixed.
  const folders = [
    {
      label: 'CRM',
      icon: 'ti-users',
      base: '/crm',
      items: crmBoards.rows.map((b) => ({ label: b.name || 'Untitled', to: `/crm/${b.id}` })),
    },
    {
      label: 'Agents',
      icon: 'ti-robot',
      base: '/agents',
      emptyLabel: 'No agents yet',
      items: agents.rows.map((a) => ({ label: a.name || 'Untitled', to: `/agents/${a.id}` })),
    },
    {
      label: 'Projects',
      icon: 'ti-folder',
      base: '/projects',
      emptyLabel: 'No projects yet',
      items: projects.rows.map((p) => ({ label: p.name || 'Untitled', to: `/projects/${p.id}` })),
    },
    ...STATIC_FOLDERS,
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} style={collapsed ? undefined : { width }}>
      <div className="sidebar-brand">
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
          <Folder key={folder.label} folder={folder} collapsed={collapsed} />
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/settings" className={navClass} title="Settings">
          <i className="ti ti-settings" />
          {!collapsed && <span>Settings</span>}
        </NavLink>
      </div>

      {!collapsed && (
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
