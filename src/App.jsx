import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import { PENDING_INVITE_KEY } from './pages/InviteAccept.jsx';
import { MasterControllerProvider, MasterControllerDock } from './components/MasterController.jsx';
import { WorkspaceProvider } from './components/WorkspaceProvider.jsx';
import { useAuth } from './components/AuthProvider.jsx';
import { initials } from './lib/helpers.js';

function Topbar() {
  const { displayName, user, signOut } = useAuth();
  return (
    <header className="app-topbar">
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
  const navigate = useNavigate();

  // Resume an invite link the user opened while signed out (the token was
  // stashed before the login redirect — see pages/InviteAccept.jsx).
  useEffect(() => {
    const token = localStorage.getItem(PENDING_INVITE_KEY);
    if (token) navigate(`/invite/${token}`, { replace: true });
  }, [navigate]);

  return (
    <WorkspaceProvider>
      <MasterControllerProvider>
        <div className="app-shell">
          <Sidebar collapsed={collapsed} />
          <main className="app-main">
            <Topbar />
            <div className="app-content">
              <Outlet />
            </div>
          </main>
          <MasterControllerDock />
        </div>
      </MasterControllerProvider>
    </WorkspaceProvider>
  );
}
