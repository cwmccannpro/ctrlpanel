import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import { MasterControllerProvider, MasterControllerDock } from './components/MasterController.jsx';
import { WorkspaceProvider } from './components/WorkspaceProvider.jsx';
import { ToastProvider } from './components/Toaster.jsx';
import { CommandPaletteProvider, useCommandPalette } from './components/CommandPalette.jsx';
import { useAuth } from './components/AuthProvider.jsx';
import { initials } from './lib/helpers.js';
import { useMediaQuery, MOBILE_QUERY } from './lib/useMediaQuery.js';
import OfflineBanner from './components/OfflineBanner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import PageLoading from './components/PageLoading.jsx';
import { pageLoaders } from './routes.jsx';
import { prefetchPages } from './lib/prefetch.js';

function Topbar({ showMenu, navOpen, onMenu }) {
  const { displayName, user, signOut } = useAuth();
  const palette = useCommandPalette();
  return (
    <header className="app-topbar">
      {showMenu && (
        <button className="topbar-menu" onClick={onMenu} aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} aria-controls="app-sidebar">
          <i className={`ti ${navOpen ? 'ti-x' : 'ti-menu-2'}`} />
        </button>
      )}
      <button className="topbar-search" onClick={palette.open} aria-label="Search or jump to anything" title={`Search & quick add (${palette.modKey}+K)`}>
        <i className="ti ti-search" />
        <span className="topbar-search-label">Search or add</span>
        <kbd className="cmdk-kbd">{palette.modKey}+K</kbd>
      </button>
      <div className="topbar-user">
        <span className="topbar-avatar">{initials(displayName)}</span>
        <span className="topbar-name" title={user?.email}>{displayName}</span>
        <button className="btn btn--ghost btn--icon" onClick={signOut} title="Sign out">
          <i className="ti ti-logout" />
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const { settings } = useAuth();
  const collapsed = typeof settings?.sidebar_collapsed === 'boolean'
    ? settings.sidebar_collapsed
    : localStorage.getItem('ctrlpanel-sidebar') === 'collapsed';
  // Phones: the sidebar is an off-canvas drawer opened from the topbar.
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setNavOpen(false); }, [pathname, isMobile]);
  useEffect(() => prefetchPages(pageLoaders), []);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  return (
    <WorkspaceProvider>
      <ToastProvider>
        <MasterControllerProvider>
          <CommandPaletteProvider>
            <div className="app-shell">
              <Sidebar collapsed={collapsed && !isMobile} drawer={isMobile} open={navOpen} onClose={() => setNavOpen(false)} />
              {isMobile && navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
              <main className="app-main">
                <OfflineBanner />
                <Topbar showMenu={isMobile} navOpen={navOpen} onMenu={() => setNavOpen((v) => !v)} />
                <div className="app-content">
                  {/* A page that crashes or is still loading never takes the sidebar/topbar down. */}
                  <ErrorBoundary resetKey={pathname}>
                    <Suspense fallback={<PageLoading />}>
                      <Outlet />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </main>
              <MasterControllerDock />
            </div>
          </CommandPaletteProvider>
        </MasterControllerProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
