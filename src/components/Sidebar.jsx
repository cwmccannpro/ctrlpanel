import { useState } from 'react';
import { NavLink } from 'react-router-dom';

// Top-level links (exact icons per AGENTS.md)
const TOP_LINKS = [
  { to: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true },
  { to: '/calendar', label: 'Calendar', icon: 'ti-calendar' },
  { to: '/todo', label: 'To Do', icon: 'ti-checkbox' },
];

// Collapsible folder sections
const FOLDERS = [
  {
    label: 'Agents',
    icon: 'ti-robot',
    base: '/agents',
    items: [
      { label: 'Outreach', to: '/agents' },
      { label: 'Financial', to: '/agents' },
      { label: 'Social Media', to: '/agents' },
    ],
  },
  {
    label: 'Projects',
    icon: 'ti-folder',
    base: '/projects',
    items: [
      { label: 'ViridianAI', to: '/projects' },
      { label: 'CTRLpanel', to: '/projects' },
      { label: 'ContentFactory', to: '/projects' },
    ],
  },
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
];

function navClass({ isActive }) {
  return `nav-item ${isActive ? 'active' : ''}`;
}

function Folder({ folder, collapsed }) {
  const [open, setOpen] = useState(true);

  if (collapsed) {
    // Icon-only: navigate to the folder's first/base destination
    return (
      <NavLink to={folder.items[0].to} className={navClass} title={folder.label}>
        <i className={`ti ${folder.icon}`} />
      </NavLink>
    );
  }

  return (
    <div>
      <div className="nav-folder-header" onClick={() => setOpen((o) => !o)}>
        <i className={`ti ${folder.icon}`} />
        <span>{folder.label}</span>
        <i className={`ti ti-chevron-right nav-folder-chevron ${open ? 'open' : ''}`} />
      </div>
      {open &&
        folder.items.map((item, i) => (
          <NavLink
            key={`${folder.label}-${i}`}
            to={item.to}
            className={({ isActive }) => `nav-subitem ${isActive ? 'active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
    </div>
  );
}

export default function Sidebar({ collapsed = false }) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
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

        {FOLDERS.map((folder) => (
          <Folder key={folder.label} folder={folder} collapsed={collapsed} />
        ))}

        {!collapsed && <div className="sidebar-divider" />}

        <NavLink to="/crm" className={navClass} title="CRM">
          <i className="ti ti-users" />
          {!collapsed && <span>CRM</span>}
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/settings" className={navClass} title="Settings">
          <i className="ti ti-settings" />
          {!collapsed && <span>Settings</span>}
        </NavLink>
      </div>
    </aside>
  );
}
