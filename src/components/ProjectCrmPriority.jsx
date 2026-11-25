import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from './shared/Badge.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { sheets } from '../lib/api.js';
import { crmFollowups } from '../lib/dashboardStats.js';
import { sheetCrmPriorities } from '../lib/projectCrmPriority.js';
import { projectPath } from '../lib/projectRoutes.js';
import { useProjectContacts } from '../lib/useProjectContacts.js';
import { getCachedMeta, getCachedSheet, setCachedMeta, setCachedSheet } from '../lib/sheetsCache.js';

function sheetName(meta, preferred) {
  return (meta?.sheets.find((sheet) => sheet.title === preferred) || meta?.sheets[0])?.title;
}

export default function ProjectCrmPriority({ project }) {
  const { crmBoards } = useWorkspace();
  const board = crmBoards.rows.find((row) => row.id === project.crm_board_id);
  const spreadsheet = board?.spreadsheet_id;
  const preferred = board?.sheet_name;
  const legacy = useProjectContacts(board && !spreadsheet ? board.id : null);
  const key = spreadsheet ? `${spreadsheet}:${preferred || ''}` : '';
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!spreadsheet) return;
    let active = true;
    async function load() {
      try {
        const meta = await sheets.meta(spreadsheet);
        if (!active) return;
        setCachedMeta(spreadsheet, meta);
        const tab = sheetName(meta, preferred);
        if (!tab) throw new Error('This spreadsheet has no sheets.');
        const data = await sheets.values(spreadsheet, tab);
        if (!active) return;
        setCachedSheet(spreadsheet, tab, data);
        setResult({ key, data });
      } catch (error) {
        if (active) setResult({ key, error: error.message || 'Could not read CRM priorities.' });
      }
    }
    load();
    return () => { active = false; };
  }, [key, spreadsheet, preferred]);

  const current = result?.key === key ? result : null;
  const cachedTab = spreadsheet ? sheetName(getCachedMeta(spreadsheet), preferred) : '';
  const data = spreadsheet ? current?.data || (cachedTab && getCachedSheet(spreadsheet, cachedTab)) : null;
  const priorities = data ? sheetCrmPriorities(data) : null;
  const queue = spreadsheet ? priorities?.rows || [] : crmFollowups({ contacts: legacy.rows, limit: 5 }).queue.map(
    (row) => ({ ...row, label: row.since == null ? 'No last touch' : `${row.since}d since contact` })
  );
  const loading = !!project.crm_board_id && ((!board && crmBoards.loading) || legacy.loading || (spreadsheet && !current && !data));
  const error = current?.error || legacy.error || crmBoards.error?.message;
  let empty = 'No follow-ups due.';
  if (!board) empty = 'Set up a CRM to track follow-ups.';
  else if (!spreadsheet && !legacy.rows.length) empty = 'Connect a Google Sheet to see follow-ups.';
  else if (priorities && !priorities.hasSignals && data.rows.length) empty = 'Add a Follow-up date or Priority column to your sheet.';

  return <div className="project-priorities">
    {loading ? <p className="project-widget-empty" role="status">Loading follow-ups…</p>
      : error && !queue.length ? <p className="project-error" role="alert">{error}</p>
        : queue.length ? <ul className="project-widget-list">
          {queue.map((row) => <li key={row.id} className="project-priority-row">
            <span className="project-priority-name">{row.name}</span>
            <span className={row.label === 'Overdue' ? 'project-priority-date text-red' : 'project-priority-date'}>{row.label}</span>
            {row.temp ? <Badge variant={row.temp.toLowerCase()}>{row.temp}</Badge>
              : row.priority ? <Badge variant={row.rank <= 1 ? 'warm' : undefined}>{row.priority}</Badge> : null}
          </li>)}
        </ul> : <p className="project-widget-empty">{empty}</p>}
    {error && queue.length > 0 && <p className="project-error" role="alert">{error} Showing last loaded rows.</p>}
    <Link className="project-widget-link" to={projectPath(project.id, 'crm')}>{board ? 'Open CRM' : 'Set up CRM'}<i className="ti ti-arrow-right" /></Link>
  </div>;
}
