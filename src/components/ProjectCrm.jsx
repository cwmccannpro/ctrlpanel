import { useState } from 'react';
import { Link } from 'react-router-dom';
import CrmSheet from './CrmSheet.jsx';
import LinkSheetModal from './LinkSheetModal.jsx';
import SheetsLogo from './SheetsLogo.jsx';
import { useWorkspace } from './WorkspaceProvider.jsx';
import { update, insert, remove } from '../lib/supabase.js';
import { clearSheetCache } from '../lib/sheetsCache.js';
import { useProjectContacts } from '../lib/useProjectContacts.js';
import { projectCrmPath } from '../lib/projectRoutes.js';
import '../styles/crm.css';

export default function ProjectCrm({ project, boardId = project?.crm_board_id, onBoardChange }) {
  const { crmBoards, projects } = useWorkspace();
  const [linking, setLinking] = useState(false);
  const [linkNonce, setLinkNonce] = useState(0); // bump after (re)connecting so the sheet view reloads
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const available = project ? crmBoards.rows : crmBoards.rows.filter(
    (board) => !projects.rows.some((item) => item.crm_board_id === board.id)
  );
  const board = available.find((b) => b.id === boardId);
  const legacy = useProjectContacts(board && !board.spreadsheet_id ? board.id : null);

  const saveBoard = async (patch) => {
    const result = await update('crm_boards', boardId, patch);
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.length) throw new Error('This CRM page is no longer available.');
    // Linking the page to a different spreadsheet: forget what we cached for the old one.
    if (patch.spreadsheet_id && board?.spreadsheet_id && patch.spreadsheet_id !== board.spreadsheet_id) clearSheetCache(board.spreadsheet_id);
    await crmBoards.reload();
  };
  const run = async (action) => {
    setError('');
    setBusy(true);
    try { await action(); } catch (e) { setError(e.message || 'Could not save this change.'); }
    finally { setBusy(false); }
  };
  const newBoard = () => {
    const name = prompt('CRM page name?', project?.name || '')?.trim();
    if (!name) return;
    run(async () => {
      const result = await insert('crm_boards', [{ name, columns: [] }]);
      if (result.error) throw new Error(result.error.message);
      const id = result.data?.[0]?.id;
      if (!id) throw new Error('CRM page could not be created.');
      await crmBoards.reload();
      await onBoardChange(id);
    });
  };
  const renameBoard = () => {
    const name = prompt('Rename CRM page', board.name)?.trim();
    if (name) run(() => saveBoard({ name }));
  };
  const deleteBoard = () => {
    if (!confirm(`Delete CRM page “${board.name}”? The Google spreadsheet will stay in Sheets.`)) return;
    run(async () => {
      const result = await remove('crm_boards', boardId);
      if (result.error) throw new Error(result.error.message);
      await crmBoards.reload();
      await onBoardChange(null);
    });
  };

  return (
    <div className="crm-page">
      <div className="toolbar crm-page-toolbar">
        <select className="select" aria-label={project ? 'Project CRM page' : 'Unassigned CRM page'} value={boardId || ''} disabled={busy || crmBoards.loading} onChange={(e) => {
          const next = e.target.value || null;
          run(() => onBoardChange(next));
        }}>
          <option value="">{project ? 'Select a CRM page' : 'Unassigned CRM pages'}</option>
          {available.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn btn--ghost btn--icon" aria-label="New CRM page" title="New CRM page" onClick={newBoard} disabled={busy}><i className="ti ti-plus" /></button>
        {board && (
          <>
            {!board.spreadsheet_id && <button className="btn btn--ghost btn--icon" title="Connect Google Sheets" aria-label="Connect Google Sheets" onClick={() => setLinking(true)}><SheetsLogo /></button>}
            <details className="col-toggle">
              <summary className="btn btn--ghost btn--icon" aria-label="Page options" title="Page options"><i className="ti ti-dots" /></summary>
              <div className="col-toggle-menu crm-page-menu">
                <button className="btn btn--ghost" onClick={renameBoard} disabled={busy}>Rename page</button>
                {board.spreadsheet_id && <button className="btn btn--ghost" onClick={() => setLinking(true)}>Change spreadsheet</button>}
                {project
                  ? <button className="btn btn--ghost" onClick={() => run(() => onBoardChange(null))} disabled={busy}>Unlink from project</button>
                  : <button className="btn btn--ghost" onClick={deleteBoard} disabled={busy}>Delete page</button>}
              </div>
            </details>
          </>
        )}
      </div>
      {error && <p className="body-text crm-error" role="alert">{error}</p>}
      {crmBoards.error && !board ? <p className="crm-error" role="alert">{crmBoards.error.message}</p>
        : crmBoards.loading && !board ? <p className="body-text">Loading CRM pages…</p>
        : board?.spreadsheet_id ? <CrmSheet key={`${board.id}:${board.spreadsheet_id}:${linkNonce}`} board={board} onSetup={() => setLinking(true)} />
        : board ? (
          <div>
            <div className="crm-empty">
              <SheetsLogo />
              <p>Connect a Google Sheet to use this CRM.</p>
              <button className="btn btn--accent" onClick={() => setLinking(true)}><SheetsLogo /> Connect Google Sheet</button>
            </div>
            {legacy.error && <p className="crm-error" role="alert">{legacy.error}</p>}
            {legacy.rows.length > 0 && <section aria-label="Saved contacts">
              <h2 className="section-label">Saved contacts</h2>
              {legacy.rows.map((contact) => <div className="list-row" key={contact.id}>
                <span className="list-row-title">{contact.business_name || 'Untitled'}</span>
                <span className="list-row-meta">{contact.email || contact.lead_temp}</span>
              </div>)}
            </section>}
          </div>
        )
        : boardId ? <p className="body-text">This CRM page is unavailable.</p>
        : project ? <div className="crm-empty">
            <i className="ti ti-address-book" />
            <p>Set up a CRM for {project.name}.</p>
            <span>Choose an existing page or create one to connect a Google Sheet.</span>
            <button className="btn btn--accent" onClick={newBoard} disabled={busy}><i className="ti ti-plus" /> Create CRM page</button>
          </div>
        : <div className="crm-page-list">
            {available.map((b) => <Link className="list-row" key={b.id} to={projectCrmPath(projects.rows, b.id)}><SheetsLogo /><span>{b.name}</span><span className="list-row-meta">{b.spreadsheet_title || 'Connect a sheet'}</span><i className="ti ti-chevron-right" /></Link>)}
            {!available.length && <div className="crm-empty"><p>No unassigned CRM pages.</p><button className="btn" onClick={newBoard} disabled={busy}><i className="ti ti-plus" /> New CRM</button></div>}
          </div>}
      {linking && board && <LinkSheetModal key={board.id} board={board} onClose={() => setLinking(false)} onLinked={async (patch) => { await saveBoard(patch); setLinkNonce((n) => n + 1); }} />}
    </div>
  );
}
