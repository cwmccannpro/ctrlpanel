import { Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import { MasterControllerProvider, useMasterController } from './components/MasterController.jsx';
import { useAuth } from './components/AuthProvider.jsx';
import { initials } from './lib/helpers.js';

function Topbar() {
  const { toggle } = useMasterController();
  const { displayName, user, signOut } = useAuth();
  return (
    <header className="app-topbar">
      <button className="btn btn--accent btn--sm" onClick={toggle}>
        <i className="ti ti-sparkles" /> Master Controller
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
  const collapsed = localStorage.getItem('ctrlpanel-sidebar') === 'collapsed';

  return (
    <MasterControllerProvider>
      <div className="app-shell">
        <Sidebar collapsed={collapsed} />
        <main className="app-main">
          <Topbar />
          <div className="app-content">
            <Outlet />
          </div>
        </main>
      </div>
    </MasterControllerProvider>
  );
}
