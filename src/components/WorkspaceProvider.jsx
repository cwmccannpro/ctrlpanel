import { createContext, useContext } from 'react';
import { useCrud } from '../lib/useData.js';

// Shared per-user projects + agents so the sidebar sub-pages and the
// Projects/Agents pages read/write the same state (stay in sync live).
const WorkspaceContext = createContext(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export function WorkspaceProvider({ children }) {
  const projects = useCrud('projects', 'created_at');
  const agents = useCrud('agents', 'created_at');
  const crmBoards = useCrud('crm_boards', 'created_at');
  const todoBoards = useCrud('boards', 'created_at');
  return (
    <WorkspaceContext.Provider value={{ projects, agents, crmBoards, todoBoards }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
