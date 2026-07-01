import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  supabase,
  isConfigured,
  signIn as sbSignIn,
  signUp as sbSignUp,
  signOut as sbSignOut,
  onAuthChange,
  getProfile,
  getUserSettings,
} from '../lib/supabase.js';
import { applyAccent, FONT_SIZES } from '../lib/helpers.js';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(isConfigured);

  // Initialize session + subscribe to auth changes
  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const sub = onAuthChange((s) => setSession(s));
    return () => sub.unsubscribe();
  }, []);

  // Load profile + settings whenever the user changes
  const refreshSettings = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setSettings(null);
      return;
    }
    const s = await getUserSettings(uid);
    setSettings(s);
    // Apply the user's saved theme/display prefs.
    if (s?.accent_color) applyAccent(s.accent_color);
    if (s?.font_size) {
      document.documentElement.style.setProperty('--font-scale', FONT_SIZES[s.font_size] || '16px');
    }
  }, [session?.user?.id]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setProfile(null);
      setSettings(null);
      return;
    }
    getProfile(uid).then(setProfile);
    refreshSettings();
  }, [session?.user?.id, refreshSettings]);

  const signIn = useCallback((creds) => sbSignIn(creds), []);
  const signUp = useCallback((creds) => sbSignUp(creds), []);
  const signOut = useCallback(async () => {
    await sbSignOut();
    setSession(null);
    setProfile(null);
  }, []);

  const user = session?.user || null;
  const displayName =
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'there';

  const connectors = settings?.connectors || [];
  const connectorKey = (type) => {
    const c = connectors.find((x) => x.type === type && x.enabled);
    return c?.config?.key || '';
  };

  const value = {
    configured: isConfigured,
    loading,
    session,
    user,
    profile,
    settings,
    connectors,
    connectorKey,
    refreshSettings,
    displayName,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
