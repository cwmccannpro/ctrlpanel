import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCrud } from '../lib/useData.js';
import { socialApi } from '../lib/api.js';
import { useAuth } from './AuthProvider.jsx';

// Shared per-user projects, CRM pages, boards + socials so the sidebar
// sub-pages and their pages read/write the same state (stay in sync live).
const WorkspaceContext = createContext(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

/**
 * Socials sections. `youtube_channels` and `instagram_accounts` are service-role
 * only (tokens live on the row), so the lists come from /api/youtube/status and
 * /api/instagram/status rather than the RLS client. Kept here so the sidebar and
 * the Socials pages share one list — connecting, renaming or disconnecting a
 * section updates the sidebar immediately.
 *
 * The two platforms load independently: one being unconfigured or failing
 * (e.g. the Instagram migration isn't applied yet) never hides the other.
 * `channels` / `ready` / `error` stay YouTube's; Instagram lives under
 * `instagram` ({ ready, accounts, error, rename, disconnect }).
 */
const errorText = (reason, fallback) => reason?.message || fallback;

const emptySocialState = () => ({ loaded: false, platforms: Object.fromEntries(Object.keys(socialApi).map(key => [key, { ready: false, accounts: [], error: '', setup: null }])) });
function useSocials() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const activeUser = useRef(userId);
  const revision = useRef(0);
  activeUser.current = userId;
  const [state, setState] = useState(emptySocialState);
  const reload = useCallback(async () => {
    const pending = ++revision.current;
    const keys = Object.keys(socialApi);
    const results = await Promise.allSettled(keys.map(key => socialApi[key].status()));
    if (activeUser.current !== userId || pending !== revision.current) return;
    setState(previous => ({ owner: userId, loaded: true, platforms: Object.fromEntries(keys.map((key, index) => {
      const result = results[index];
      return [key, result.status === 'fulfilled'
        ? { ready: !!result.value.ready, accounts: result.value.channels || result.value.accounts || [], error: result.value.error || '', setup: result.value.setup }
        : { ...previous.platforms[key], error: errorText(result.reason, `Could not reach ${key}.`) }];
    })) }));
  }, [userId]);
  useEffect(() => { activeUser.current = userId; setState(emptySocialState()); if (userId) reload(); return () => { activeUser.current = null; revision.current++; }; }, [userId, reload]);
  const visibleState = state.owner === userId ? state : emptySocialState();
  const actions = Object.fromEntries(Object.keys(socialApi).map(key => [key, {
    ...visibleState.platforms[key],
    rename: async (id, label) => {
      const saved = await socialApi[key].rename(id, label || '');
      if (activeUser.current !== userId) return saved;
      revision.current++;
      setState(previous => ({ ...previous, platforms: { ...previous.platforms, [key]: { ...previous.platforms[key],
        accounts: previous.platforms[key].accounts.map(a => a.id === id ? { ...a, ...saved } : a) } } }));
      return saved;
    },
    disconnect: async id => {
      await socialApi[key].disconnect(id);
      if (activeUser.current !== userId) return;
      revision.current++;
      setState(previous => ({ ...previous, platforms: { ...previous.platforms, [key]: { ...previous.platforms[key],
        accounts: previous.platforms[key].accounts.filter(a => a.id !== id) } } }));
    },
  }]));
  return { loaded: visibleState.loaded, reload, ...actions.youtube, channels: actions.youtube.accounts,
    instagram: actions.instagram, x: actions.x };
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
