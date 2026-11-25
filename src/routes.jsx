// The signed-in app's page routes (children of the App shell route). Shared by
// src/main.jsx and the test harness so both render exactly the same pages.

import { lazy } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useWorkspace } from './components/WorkspaceProvider.jsx';
import { projectCrmPath } from './lib/projectRoutes.js';

// Every page is its own chunk: a first visit downloads the shell + the page you open; the
// rest are fetched on demand (and warmed while idle — see lib/prefetch.js).
const loaders = {
  Drive: () => import('./pages/Drive.jsx'),
  RoomControl: () => import('./pages/RoomControl.jsx'),
  Dashboard: () => import('./pages/Dashboard.jsx'),
  Calendar: () => import('./pages/Calendar.jsx'),
  ToDo: () => import('./pages/ToDo.jsx'),
  Habits: () => import('./pages/Habits.jsx'),
  Projects: () => import('./pages/Projects.jsx'),
  ProjectDetail: () => import('./pages/ProjectDetail.jsx'),
  KnowledgeBase: () => import('./pages/KnowledgeBase.jsx'),
  Settings: () => import('./pages/Settings.jsx'),
  Health: () => import('./pages/health/Health.jsx'),
  Finance: () => import('./pages/finance/Finance.jsx'),
  Socials: () => import('./pages/socials/Socials.jsx'),
  YouTube: () => import('./pages/socials/YouTube.jsx'),
  Instagram: () => import('./pages/socials/Instagram.jsx'),
  X: () => import('./pages/socials/X.jsx'),
  TikTok: () => import('./pages/socials/TikTok.jsx'),
};
const Dashboard = lazy(loaders.Dashboard);
const Drive = lazy(loaders.Drive);
const RoomControl = lazy(loaders.RoomControl);
const Calendar = lazy(loaders.Calendar);
const ToDo = lazy(loaders.ToDo);
const Habits = lazy(loaders.Habits);
const Projects = lazy(loaders.Projects);
const ProjectDetail = lazy(loaders.ProjectDetail);
const KnowledgeBase = lazy(loaders.KnowledgeBase);
const Settings = lazy(loaders.Settings);
const Health = lazy(loaders.Health);
const Finance = lazy(loaders.Finance);
const Socials = lazy(loaders.Socials);
const YouTube = lazy(loaders.YouTube);
const Instagram = lazy(loaders.Instagram);
const X = lazy(loaders.X);
const TikTok = lazy(loaders.TikTok);

// Order = prefetch order (most-visited first). Dashboard loads with the first render.
export const pageLoaders = [
  loaders.Drive,
  loaders.RoomControl,
  loaders.ToDo,
  loaders.Calendar,
  loaders.Habits,
  loaders.KnowledgeBase,
  loaders.Projects,
  loaders.ProjectDetail,
  loaders.Settings,
  loaders.Health,
  loaders.Finance,
  loaders.Socials,
  loaders.YouTube,
  loaders.Instagram,
  loaders.X,
  loaders.TikTok,
];

function LegacyKnowledgeRoute() {
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname: '/context', search, hash }} />;
}

function LegacyCrmRoute() {
  const { boardId } = useParams();
  const { projects } = useWorkspace();
  if (boardId && projects.loading) return <p className="body-text">Loading projects…</p>;
  return <Navigate replace to={projectCrmPath(projects.rows, boardId)} />;
}

export const appChildren = [
  { path: 'drive', element: <Drive /> },
  { path: 'room', element: <RoomControl /> },
  { index: true, element: <Dashboard /> },
  { path: 'calendar', element: <Calendar /> },
  { path: 'todo', element: <ToDo /> },
  { path: 'todo/:boardId', element: <ToDo /> },
  { path: 'habits', element: <Habits /> },
  { path: 'projects', element: <Projects /> },
  { path: 'projects/:id/:tab?', element: <ProjectDetail /> },
  { path: 'context', element: <KnowledgeBase /> },
  { path: 'knowledge', element: <LegacyKnowledgeRoute /> },
  { path: 'crm', element: <LegacyCrmRoute /> },
  { path: 'crm/:boardId', element: <LegacyCrmRoute /> },
  { path: 'health', element: <Health /> },
  // Existing links open the combined page at their section; queries are retained.
  { path: 'health/nutrition', element: <Health /> },
  { path: 'health/supplements', element: <Health /> },
  { path: 'health/fitness', element: <Health /> },
  { path: 'finance', element: <Finance /> },
  // Finance is one page; the old sub-pages open it at their section.
  { path: 'finance/networth', element: <Navigate to="/finance#assets" replace /> },
  { path: 'finance/budget', element: <Navigate to="/finance#cashflow" replace /> },
  { path: 'finance/investing', element: <Navigate to="/finance#investing" replace /> },
  { path: 'finance/debt', element: <Navigate to="/finance" replace /> },
  { path: 'socials', element: <Socials /> },
  // Kept so older links (and the OAuth callback) still land on the overview.
  { path: 'socials/youtube', element: <Socials /> },
  { path: 'socials/youtube/:id', element: <YouTube /> },
  { path: 'socials/instagram', element: <Socials /> },
  { path: 'socials/instagram/:id', element: <Instagram /> },
  { path: 'socials/x', element: <Socials /> },
  { path: 'socials/x/:id', element: <X /> },
  { path: 'socials/tiktok', element: <Socials /> },
  { path: 'socials/tiktok/:id', element: <TikTok /> },
  { path: 'settings', element: <Settings /> },
  { path: '*', element: <Dashboard /> },
];
