import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';

import './styles/globals.css';
import './styles/components.css';
import { loadAccent, loadDisplayPrefs } from './lib/helpers.js';

import { AuthProvider, useAuth } from './components/AuthProvider.jsx';
import Spinner from './components/shared/Spinner.jsx';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import InviteAccept from './pages/InviteAccept.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Calendar from './pages/Calendar.jsx';
import ToDo from './pages/ToDo.jsx';
import Habits from './pages/Habits.jsx';
import Reports from './pages/reports/Reports.jsx';
import ReportSourceDetail from './pages/reports/ReportSourceDetail.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import CRM from './pages/CRM.jsx';
import Settings from './pages/Settings.jsx';
import Nutrition from './pages/health/Nutrition.jsx';
import Supplements from './pages/health/Supplements.jsx';
import Fitness from './pages/health/Fitness.jsx';
import NetWorth from './pages/finance/NetWorth.jsx';
import Budget from './pages/finance/Budget.jsx';
import Investing from './pages/finance/Investing.jsx';

// Apply saved theme + display preferences on start.
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
  // Handles its own auth: signed-out visitors are sent through login first.
  { path: '/invite/:token', element: <InviteAccept /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'calendar', element: <Calendar /> },
      { path: 'todo', element: <ToDo /> },
      { path: 'todo/:boardId', element: <ToDo /> },
      { path: 'habits', element: <Habits /> },
      { path: 'reports', element: <Reports /> },
      { path: 'reports/:sourceId', element: <ReportSourceDetail /> },
      { path: 'projects', element: <Projects /> },
      { path: 'projects/:id', element: <ProjectDetail /> },
      { path: 'crm', element: <CRM /> },
      { path: 'crm/:boardId', element: <CRM /> },
      { path: 'health/nutrition', element: <Nutrition /> },
      { path: 'health/supplements', element: <Supplements /> },
      { path: 'health/fitness', element: <Fitness /> },
      { path: 'finance/networth', element: <NetWorth /> },
      { path: 'finance/budget', element: <Budget /> },
      { path: 'finance/investing', element: <Investing /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <Dashboard /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
