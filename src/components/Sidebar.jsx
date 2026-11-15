import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { useAuth } from './AuthProvider.jsx';
import Modal from './shared/Modal.jsx';
import { sidebarNavigation, visibleSidebarNavigation } from '../lib/sidebarNavigation.js';

const SidebarVisibility = lazy(() => import('./SidebarVisibility.jsx'));

const MIN_WIDTH = 120;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 204;
const WIDTH_KEY = 'ctrlpanel-sidebar-width';
const FOLDERS_KEY = 'ctrlpanel-sidebar-folders';

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
  const [customizing, setCustomizing] = useState(false);
  const customizeButtonRef = useRef(null);
  const closeCustomize = useCallback(() => {
    setCustomizing(false);
    customizeButtonRef.current?.focus();
  }, []);
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
  const isOpen = (label) => openFolders[label] ?? label !== 'Socials';
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
  // registry (src/lib/agentRegistry.js); Finance is fixed, and Health is a plain top-level link. `indexTo`
  // is the section's overview page — reached from the header's manage button,
  // never by clicking the folder itself.
  const navigation = sidebarNavigation({ projects: projects.rows, crmBoards: crmBoards.rows, socials, settings });
  const { links, folders } = visibleSidebarNavigation(navigation, settings?.ui_preferences?.sidebarVisibility);

  return (
    <><aside
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
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={navClass} title={link.label}>
            <i className={`ti ${link.icon}`} />
            {!collapsed && <span>{link.label}</span>}
          </NavLink>
        ))}

        {!collapsed && <div className="sidebar-divider" />}

        {folders.map((folder) => (
          <Folder
            key={folder.id}
            folder={folder}
            collapsed={collapsed}
            open={isOpen(folder.label)}
            onToggle={toggleFolder}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" ref={customizeButtonRef} className="nav-item nav-customize" title="Customize sidebar" aria-label="Customize sidebar" onClick={() => setCustomizing(true)}>
          <i className="ti ti-adjustments" aria-hidden="true" />
          {!collapsed && <span>Customize sidebar</span>}
        </button>
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
    {customizing && createPortal(
      <div className="sidebar-visibility-modal" onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const controls = [...e.currentTarget.querySelectorAll('button, input, a[href]')].filter((el) => !el.matches(':disabled'));
        const first = controls[0];
        const last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}>
        <Modal title="Sidebar sections" onClose={closeCustomize}>
          <Suspense fallback={<div className="body-text" role="status">Loading sidebar choices…</div>}>
            <SidebarVisibility autoFocus />
          </Suspense>
        </Modal>
      </div>, document.body
    )}
    </>
  );
}
