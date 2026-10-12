// The signed-in app's page routes (children of the App shell route). Shared by
// src/main.jsx and the test harness so both render exactly the same pages.

import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

// Every page is its own chunk: a first visit downloads the shell + the page you open; the
// rest are fetched on demand (and warmed while idle — see lib/prefetch.js).
const loaders = {
  Dashboard: () => import('./pages/Dashboard.jsx'),
  Calendar: () => import('./pages/Calendar.jsx'),
  ToDo: () => import('./pages/ToDo.jsx'),
  Habits: () => import('./pages/Habits.jsx'),
  Review: () => import('./pages/Review.jsx'),
  Agents: () => import('./pages/agents/Agents.jsx'),
  OpportunitiesAgent: () => import('./pages/agents/OpportunitiesAgent.jsx'),
  IndustryProblemsAgent: () => import('./pages/agents/IndustryProblemsAgent.jsx'),
  Projects: () => import('./pages/Projects.jsx'),
  ProjectDetail: () => import('./pages/ProjectDetail.jsx'),
  KnowledgeBase: () => import('./pages/KnowledgeBase.jsx'),
  CRM: () => import('./pages/CRM.jsx'),
  Settings: () => import('./pages/Settings.jsx'),
  Health: () => import('./pages/health/Health.jsx'),
  Finance: () => import('./pages/finance/Finance.jsx'),
  Socials: () => import('./pages/socials/Socials.jsx'),
  YouTube: () => import('./pages/socials/YouTube.jsx'),
  Instagram: () => import('./pages/socials/Instagram.jsx'),
  X: () => import('./pages/socials/X.jsx'),
};
const Dashboard = lazy(loaders.Dashboard);
const Calendar = lazy(loaders.Calendar);
const ToDo = lazy(loaders.ToDo);
const Habits = lazy(loaders.Habits);
const Review = lazy(loaders.Review);
const Agents = lazy(loaders.Agents);
const OpportunitiesAgent = lazy(loaders.OpportunitiesAgent);
const IndustryProblemsAgent = lazy(loaders.IndustryProblemsAgent);
const Projects = lazy(loaders.Projects);
const ProjectDetail = lazy(loaders.ProjectDetail);
const KnowledgeBase = lazy(loaders.KnowledgeBase);
const CRM = lazy(loaders.CRM);
const Settings = lazy(loaders.Settings);
const Health = lazy(loaders.Health);
const Finance = lazy(loaders.Finance);
const Socials = lazy(loaders.Socials);
const YouTube = lazy(loaders.YouTube);
const Instagram = lazy(loaders.Instagram);
const X = lazy(loaders.X);

// Order = prefetch order (most-visited first). Dashboard loads with the first render.
export const pageLoaders = [
  loaders.ToDo,
  loaders.Calendar,
  loaders.Habits,
  loaders.Review,
  loaders.KnowledgeBase,
  loaders.Projects,
  loaders.ProjectDetail,
  loaders.CRM,
  loaders.Settings,
  loaders.Health,
  loaders.Finance,
  loaders.Agents,
  loaders.OpportunitiesAgent,
  loaders.IndustryProblemsAgent,
  loaders.Socials,
  loaders.YouTube,
  loaders.Instagram,
  loaders.X,
];

export const appChildren = [
  { index: true, element: <Dashboard /> },
  { path: 'calendar', element: <Calendar /> },
  { path: 'todo', element: <ToDo /> },
  { path: 'todo/:boardId', element: <ToDo /> },
  { path: 'habits', element: <Habits /> },
  { path: 'review', element: <Review /> },
  { path: 'agents', element: <Agents /> },
  { path: 'agents/opportunities', element: <OpportunitiesAgent /> },
  { path: 'agents/industry-problems', element: <IndustryProblemsAgent /> },
  { path: 'projects', element: <Projects /> },
  { path: 'projects/:id', element: <ProjectDetail /> },
  { path: 'knowledge', element: <KnowledgeBase /> },
  { path: 'crm', element: <CRM /> },
  { path: 'crm/:boardId', element: <CRM /> },
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
  { path: 'settings', element: <Settings /> },
  { path: '*', element: <Dashboard /> },
];
