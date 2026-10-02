import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useCrud } from '../lib/useData.js';
import { youtube } from '../lib/api.js';

// Shared per-user projects, CRM pages, boards + socials so the sidebar
// sub-pages and their pages read/write the same state (stay in sync live).
const WorkspaceContext = createContext(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

/**
 * Socials sections. `youtube_channels` is service-role only (tokens live on the
 * row), so the list comes from /api/youtube/status rather than the RLS client.
 * Kept here so the sidebar and the Socials pages share one list — connecting,
 * renaming or disconnecting a channel updates the sidebar immediately.
 */
function useSocials() {
  const [state, setState] = useState({ ready: false, channels: [], loaded: false, error: '' });

  const reload = useCallback(async () => {
    try {
      const s = await youtube.status();
      setState({ ready: !!s.ready, channels: s.channels || [], loaded: true, error: '' });
    } catch (e) {
      setState((p) => ({ ...p, loaded: true, error: e.message || 'Could not reach the YouTube integration.' }));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Optimistic rename, reconciled with the row the server returns.
  const rename = useCallback(async (id, label) => {
    const next = label?.trim() ? label.trim() : null;
    setState((p) => ({ ...p, channels: p.channels.map((c) => (c.id === id ? { ...c, label: next } : c)) }));
    const saved = await youtube.rename(id, next || '');
    setState((p) => ({ ...p, channels: p.channels.map((c) => (c.id === id ? { ...c, ...saved } : c)) }));
    return saved;
  }, []);

  const disconnect = useCallback(async (id) => {
    await youtube.disconnect(id);
    setState((p) => ({ ...p, channels: p.channels.filter((c) => c.id !== id) }));
    reload();
  }, [reload]);

  return { ...state, reload, rename, disconnect };
}

export function WorkspaceProvider({ children }) {
  const projects = useCrud('projects', 'created_at');
  const crmBoards = useCrud('crm_boards', 'created_at');
  const todoBoards = useCrud('boards', 'created_at');
  const socials = useSocials();
  return (
    <WorkspaceContext.Provider value={{ projects, crmBoards, todoBoards, socials }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
