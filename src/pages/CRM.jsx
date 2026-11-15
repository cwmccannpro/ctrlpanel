import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import CrmSheet from '../components/CrmSheet.jsx';
import LinkSheetModal from '../components/LinkSheetModal.jsx';
import SheetsLogo from '../components/SheetsLogo.jsx';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { update, insert, remove } from '../lib/supabase.js';
import { clearSheetCache } from '../lib/sheetsCache.js';
import '../styles/crm.css';

export default function CRM() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { crmBoards } = useWorkspace();
  const [linking, setLinking] = useState(false);
  const [linkNonce, setLinkNonce] = useState(0); // bump after (re)connecting so the sheet view reloads
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const board = crmBoards.rows.find((b) => b.id === boardId);

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
    const name = prompt('CRM page name?')?.trim();
    if (!name) return;
    run(async () => {
      const result = await insert('crm_boards', [{ name, columns: [] }]);
      if (result.error) throw new Error(result.error.message);
      await crmBoards.reload();
      navigate(`/crm/${result.data[0].id}`);
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
      navigate('/crm');
    });
  };

  return (
    <div className="fade-in crm-page">
      <h1 className="sr-only">{board?.name || 'CRM'}</h1>
      <div className="toolbar crm-page-toolbar">
        <select className="select" aria-label="CRM page" value={boardId || ''} onChange={(e) => navigate(e.target.value ? `/crm/${e.target.value}` : '/crm')}>
          <option value="">CRM pages</option>
          {crmBoards.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                <button className="btn btn--ghost" onClick={deleteBoard} disabled={busy}>Delete page</button>
              </div>
            </details>
          </>
        )}
      </div>
      {error && <p className="body-text crm-error" role="alert">{error}</p>}
      {crmBoards.loading && !board ? <p className="body-text">Loading CRM pages…</p>
        : board?.spreadsheet_id ? <CrmSheet key={`${board.id}:${board.spreadsheet_id}:${linkNonce}`} board={board} onSheetChange={(name) => saveBoard({ sheet_name: name })} onSetup={() => setLinking(true)} />
        : board ? (
          <div className="crm-empty">
            <SheetsLogo />
            <p>Connect a Google Sheet to use this CRM.</p>
            <span>Your contacts live in the sheet; CTRLpanel shows them here and lets you edit them if you share it as an Editor.</span>
            <button className="btn btn--accent" onClick={() => setLinking(true)}><SheetsLogo /> Connect Google Sheet</button>
          </div>
        )
        : boardId ? <p className="body-text">This CRM page is unavailable.</p>
        : <div className="crm-page-list">
            {crmBoards.rows.map((b) => <Link className="list-row" key={b.id} to={`/crm/${b.id}`}><SheetsLogo /><span>{b.name}</span><span className="list-row-meta">{b.spreadsheet_title || 'Connect a sheet'}</span><i className="ti ti-chevron-right" /></Link>)}
            {!crmBoards.rows.length && <div className="crm-empty"><p>No CRM pages yet.</p><button className="btn" onClick={newBoard} disabled={busy}><i className="ti ti-plus" /> New CRM</button></div>}
          </div>}
      {linking && board && <LinkSheetModal key={board.id} board={board} onClose={() => setLinking(false)} onLinked={async (patch) => { await saveBoard(patch); setLinkNonce((n) => n + 1); }} />}
    </div>
  );
}
