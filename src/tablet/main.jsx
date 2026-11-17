import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../components/AuthProvider.jsx';
import { ToastProvider } from '../components/Toaster.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import Login from '../pages/Login.jsx';
import Register from '../pages/Register.jsx';
import { loadAccent, loadDisplayPrefs } from '../lib/helpers.js';
import { loadTheme } from '../lib/themes.js';
import '../styles/globals.css';
import '../styles/components.css';
import '../styles/themes.css';
const Drive = lazy(() => import('../pages/Drive.jsx'));
const FullApp = lazy(() => import('./FullApp.jsx'));
loadTheme(); loadAccent(); loadDisplayPrefs();
function Tablet() {
  const { session, loading } = useAuth();
  if (loading) return <div className="auth-wrap">Connecting to CTRLpanel…</div>;
  if (!session) return <Routes><Route path="/register" element={<Register />} /><Route path="*" element={<Login afterSignIn="/drive" />} /></Routes>;
  return <ErrorBoundary><Suspense fallback={<div className="auth-wrap">Opening CTRLpanel…</div>}><Routes><Route path="/drive" element={<Drive />} /><Route path="/login" element={<Navigate to="/drive" replace />} /><Route path="*" element={<FullApp />} /></Routes></Suspense></ErrorBoundary>;
}
// Deliberately no web service worker: the APK owns its offline code and updates.
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthProvider><ToastProvider><BrowserRouter><Tablet /></BrowserRouter></ToastProvider></AuthProvider></React.StrictMode>);
