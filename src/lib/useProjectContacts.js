import { useEffect, useState } from 'react';
import { queryTable } from './supabase.js';

const empty = { rows: [], error: '', loading: false };

export function useProjectContacts(boardId) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!boardId) return;
    let active = true;
    queryTable('crm_contacts', {
      select: 'id,business_name,service,email,lead_temp,last_touch',
      filters: { board_id: boardId },
      order: 'created_at',
      limit: 1000,
    }).then(({ data, error }) => {
      if (active) setResult({ boardId, rows: data || [], error: error?.message || '', loading: false });
    }).catch((error) => {
      if (active) setResult({ ...empty, boardId, error: error.message });
    });
    return () => { active = false; };
  }, [boardId]);
  if (!boardId) return empty;
  return result?.boardId === boardId ? result : { ...empty, loading: true };
}
