// The signed-in app's page routes (children of the App shell route). Shared by
// src/main.jsx and the test harness so both render exactly the same pages.

import { lazy } from 'react';

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
  Projects: () => import('./pages/Projects.jsx'),
  ProjectDetail: () => import('./pages/ProjectDetail.jsx'),
  KnowledgeBase: () => import('./pages/KnowledgeBase.jsx'),
  CRM: () => import('./pages/CRM.jsx'),
  Settings: () => import('./pages/Settings.jsx'),
  Nutrition: () => import('./pages/health/Nutrition.jsx'),
  Supplements: () => import('./pages/health/Supplements.jsx'),
  Fitness: () => import('./pages/health/Fitness.jsx'),
  NetWorth: () => import('./pages/finance/NetWorth.jsx'),
  Budget: () => import('./pages/finance/Budget.jsx'),
  Investing: () => import('./pages/finance/Investing.jsx'),
  Socials: () => import('./pages/socials/Socials.jsx'),
  YouTube: () => import('./pages/socials/YouTube.jsx'),
};
const Dashboard = lazy(loaders.Dashboard);
const Calendar = lazy(loaders.Calendar);
const ToDo = lazy(loaders.ToDo);
const Habits = lazy(loaders.Habits);
const Review = lazy(loaders.Review);
const Agents = lazy(loaders.Agents);
const OpportunitiesAgent = lazy(loaders.OpportunitiesAgent);
const Projects = lazy(loaders.Projects);
const ProjectDetail = lazy(loaders.ProjectDetail);
const KnowledgeBase = lazy(loaders.KnowledgeBase);
const CRM = lazy(loaders.CRM);
const Settings = lazy(loaders.Settings);
const Nutrition = lazy(loaders.Nutrition);
const Supplements = lazy(loaders.Supplements);
const Fitness = lazy(loaders.Fitness);
const NetWorth = lazy(loaders.NetWorth);
const Budget = lazy(loaders.Budget);
const Investing = lazy(loaders.Investing);
const Socials = lazy(loaders.Socials);
const YouTube = lazy(loaders.YouTube);

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
  loaders.Nutrition,
  loaders.Supplements,
  loaders.Fitness,
  loaders.NetWorth,
  loaders.Budget,
  loaders.Investing,
  loaders.Agents,
  loaders.OpportunitiesAgent,
  loaders.Socials,
  loaders.YouTube,
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
  { path: 'projects', element: <Projects /> },
  { path: 'projects/:id', element: <ProjectDetail /> },
  { path: 'knowledge', element: <KnowledgeBase /> },
  { path: 'crm', element: <CRM /> },
  { path: 'crm/:boardId', element: <CRM /> },
  { path: 'health/nutrition', element: <Nutrition /> },
  { path: 'health/supplements', element: <Supplements /> },
  { path: 'health/fitness', element: <Fitness /> },
  { path: 'finance/networth', element: <NetWorth /> },
  { path: 'finance/budget', element: <Budget /> },
  { path: 'finance/investing', element: <Investing /> },
  { path: 'socials', element: <Socials /> },
  // Kept so older links (and the OAuth callback) still land on the overview.
  { path: 'socials/youtube', element: <Socials /> },
  { path: 'socials/youtube/:id', element: <YouTube /> },
  { path: 'settings', element: <Settings /> },
  { path: '*', element: <Dashboard /> },
];
