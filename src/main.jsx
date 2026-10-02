import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';

import './styles/globals.css';
import './styles/components.css';
import './styles/themes.css';
import './styles/mobile.css';
import { loadAccent, loadDisplayPrefs } from './lib/helpers.js';
import { loadTheme } from './lib/themes.js';
import { registerServiceWorker } from './lib/registerSW.js';

import { AuthProvider, useAuth } from './components/AuthProvider.jsx';
import Spinner from './components/shared/Spinner.jsx';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import { appChildren } from './routes.jsx';
import { RouteError } from './components/ErrorBoundary.jsx';

// Installable app + offline shell (production only; never in dev).
registerServiceWorker();

// Apply saved theme + display preferences on start.
loadTheme();
loadAccent();
loadDisplayPrefs();

// Gate the app behind authentication.
function RequireAuth({ children }) {
  const { loading, session } = useAuth();
  if (loading) {
    return (
      <div className="auth-wrap">
        <Spinner large />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: appChildren,
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
