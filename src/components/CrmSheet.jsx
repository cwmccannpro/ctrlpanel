import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Modal from './shared/Modal.jsx';
import Spinner from './shared/Spinner.jsx';
import SheetsLogo from './SheetsLogo.jsx';
import { useToast } from './Toaster.jsx';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { sheets } from '../lib/api.js';
import {
  PAGE_SIZE, cellLink, distinctValues, filterRows, rowSignature, sortRows, staleSelection,
  withAppended, withCell, withoutRows,
} from '../lib/sheetsTable.js';
import {
  getAccess, getCachedMeta, getCachedSheet, setAccess, setCachedMeta, setCachedSheet,
} from '../lib/sheetsCache.js';

const EMPTY = { headers: [], rows: [], truncated: false, rowLimit: 0 };
const FOCUS_REFRESH_MS = 20000; // returning to the tab re-reads, at most this often

/** A Google problem the user can act on, with the right next step. */
function SheetProblem({ error, onRetry, onSetup }) {
  const code = error?.code;
  const setupCodes = ['not_configured', 'auth', 'api_disabled'];
  return (
    <div className="crm-empty crm-problem" role="alert">
      <i className="ti ti-plug-connected-x" />
      <p>{error?.message || 'Could not load this sheet.'}</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={onRetry}><i className="ti ti-refresh" /> Try again</button>
        {(setupCodes.includes(code) || code === 'not_shared') && (
          <button className="btn btn--accent" onClick={onSetup}>
            {code === 'not_shared' ? 'Sharing steps' : 'Setup steps'}
          </button>
        )}
      </div>
    </div>
  );
}

function AddRowModal({ headers, onAdd, onClose }) {
  const [values, setValues] = useState(() => headers.map(() => ''));
  const [busy, setBusy] = useState(false);
  const empty = values.every((v) => !v.trim());
  const submit = async (e) => {
    e.preventDefault();
    if (busy || empty) return;
    setBusy(true);
    const ok = await onAdd(values);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title="Add a row" onClose={busy ? () => {} : onClose} wide={headers.length > 6}>
      <form onSubmit={submit}>
        <div className="crm-addrow-grid">
          {headers.map((h, i) => (
            <label className="field" key={i}>
              <span className="field-label">{h}</span>
              <input
                className="input"
                autoFocus={i === 0}
                value={values[i]}
                disabled={busy}
                onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
              />
            </label>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn--accent" disabled={busy || empty}>{busy ? 'Adding…' : 'Add row'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function CrmSheet({ board, onSheetChange, onSetup }) {
  const id = board.spreadsheet_id;
  const toast = useToast();
  const initialTab = board.sheet_name || '';
  const initialData = initialTab ? getCachedSheet(id, initialTab) : null;

  const [meta, setMeta] = useState(() => getCachedMeta(id));
  const [sheetName, setSheetName] = useState(initialTab);
  const [data, setData] = useState(initialData || EMPTY);
  const [phase, setPhase] = useState(initialData ? 'ready' : 'loading'); // loading | ready | error
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [access, setAccessState] = useState(() => getAccess(id)); // unknown | edit | view
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [hidden, setHidden] = useState([]);
  const [sort, setSort] = useState({ col: null, dir: 'asc' });
  const [shown, setShown] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState(null); // { row, col, draft }
  const [selected, setSelected] = useState(() => new Map()); // sheet row → signature when selected
  const [adding, setAdding] = useState(false);

  const dataRef = useRef(data);
  dataRef.current = data;
  const sheetRef = useRef(sheetName);
  sheetRef.current = sheetName;
  const lastSync = useRef(0);
  const refreshTimer = useRef(null);
  const cancelEdit = useRef(false);

  const canEdit = access !== 'view';
  const touch = useMediaQuery('(pointer: coarse)'); // no double-click on touch: a tap edits
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  // After a write, re-read shortly so values show the way Sheets formatted them.
  const refreshSoon = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 900);
  }, [refresh]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  /* ---- Load: show the cached copy instantly, then revalidate in the background ---- */
  useEffect(() => {
    let alive = true;
    const cached = sheetName ? getCachedSheet(id, sheetName) : null;
    if (cached) {
      setData(cached);
      setPhase('ready');
    } else {
      setData(EMPTY);
      setPhase('loading');
    }
    setError(null);
    setSyncing(true);
    (async () => {
      try {
        const metaPromise = sheets.meta(id);
        // With a known tab, read its values in parallel with the tab list.
        const valuesPromise = sheetName ? sheets.values(id, sheetName).then((v) => ({ v }), (e) => ({ e })) : null;
        const m = await metaPromise;
        if (!alive) return;
        setMeta(m);
        setCachedMeta(id, m);
        const tab = m.sheets.some((s) => s.title === sheetName) ? sheetName : m.sheets[0]?.title;
        if (!tab) throw Object.assign(new Error('This spreadsheet has no tabs.'), { code: 'empty' });
        if (tab !== sheetName) {
          setSheetName(tab); // the saved tab is gone: this effect re-runs for the first one
          return;
        }
        const res = valuesPromise ? await valuesPromise : { v: await sheets.values(id, tab) };
        if (!alive) return;
        if (res.e) throw res.e;
        setCachedSheet(id, tab, res.v);
        setData(res.v);
        setPhase('ready');
        lastSync.current = Date.now();
      } catch (e) {
        if (!alive) return;
        setError(e);
        setPhase((p) => (p === 'ready' ? 'ready' : 'error'));
      } finally {
        if (alive) setSyncing(false);
      }
    })();
    return () => { alive = false; };
  }, [id, sheetName, revision]);

  // Drop view state (filters, hidden columns, sort) that no longer fits the sheet's columns.
  useEffect(() => {
    const cols = data.headers.length;
    setFilters((prev) => (Object.keys(prev).every((c) => Number(c) < cols) ? prev : Object.fromEntries(Object.entries(prev).filter(([c]) => Number(c) < cols))));
    setHidden((prev) => (prev.every((c) => c < cols) ? prev : prev.filter((c) => c < cols)));
    setSort((prev) => (prev.col != null && prev.col >= cols ? { col: null, dir: 'asc' } : prev));
  }, [data]);

  useEffect(() => { setShown(PAGE_SIZE); }, [search, filters, sort, sheetName]);

  // Coming back from editing in Google Sheets: pick the changes up.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastSync.current < FOCUS_REFRESH_MS) return;
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  /* ---- Derived view ---- */
  const filtered = useMemo(
    () => sortRows(filterRows(data.rows, search, filters), sort.col, sort.dir),
    [data.rows, search, filters, sort]
  );
  const page = filtered.slice(0, shown);
  const visibleCols = useMemo(() => data.headers.map((_, i) => i).filter((i) => !hidden.includes(i)), [data.headers, hidden]);
  const activeFilters = Object.keys(filters).length;
  const sheetId = meta?.sheets.find((s) => s.title === sheetName)?.sheetId;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit${sheetId != null ? `#gid=${sheetId}` : ''}`;

  /* ---- Writes ---- */
  // Local edits update the cache in the same step, so leaving and returning shows them.
  const mutateRows = useCallback((fn) => {
    setData((d) => {
      const next = { ...d, rows: fn(d.rows) };
      setCachedSheet(id, sheetRef.current, next);
      return next;
    });
  }, [id]);
  const markAccess = (value) => {
    setAccessState(value);
    setAccess(id, value);
  };
  const writeFailed = (e) => {
    if (e.code === 'read_only') markAccess('view');
    toast({ tone: 'error', message: e.message || 'That change could not be saved.' });
  };

  const commit = async (rowNumber, col, value) => {
    setEditing(null);
    const current = dataRef.current.rows.find((r) => r.row === rowNumber)?.cells[col] ?? '';
    if (value === current) return;
    mutateRows((rows) => withCell(rows, rowNumber, col, value));
    try {
      await sheets.setCell(id, sheetName, rowNumber, col, value);
      markAccess('edit');
      refreshSoon();
    } catch (e) {
      mutateRows((rows) => withCell(rows, rowNumber, col, current));
      writeFailed(e);
    }
  };

  const startEdit = (r, col) => {
    if (!canEdit) return;
    cancelEdit.current = false;
    setEditing({ row: r.row, col, draft: r.cells[col] ?? '' });
  };

  const onEditKey = (e, r, col) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit.current = true;
      setEditing(null);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit(r.row, col, editing.draft);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const at = visibleCols.indexOf(col);
      const next = visibleCols[at + (e.shiftKey ? -1 : 1)];
      commit(r.row, col, editing.draft);
      if (next !== undefined) {
        cancelEdit.current = false;
        setEditing({ row: r.row, col: next, draft: r.cells[next] ?? '' });
      }
    }
  };

  const addRow = async (values) => {
    try {
      const out = await sheets.append(id, sheetName, values);
      markAccess('edit');
      mutateRows((rows) => withAppended(rows, values, out.row));
      refreshSoon();
      toast('Row added to the sheet');
      return true;
    } catch (e) {
      writeFailed(e);
      return false;
    }
  };

  const toggleRow = (r) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.row)) next.delete(r.row);
      else next.set(r.row, rowSignature(r.cells));
      return next;
    });
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.row));
  const toggleAll = () =>
    setSelected(allSelected ? new Map() : new Map(filtered.slice(0, 1000).map((r) => [r.row, rowSignature(r.cells)])));

  const deleteSelected = async () => {
    const rowNumbers = [...selected.keys()];
    if (!rowNumbers.length) return;
    if (!confirm(`Delete ${rowNumbers.length} row${rowNumbers.length === 1 ? '' : 's'} from the Google Sheet? You can restore them from the sheet's version history.`)) return;
    try {
      // Rows shift if the sheet changed elsewhere: confirm they are still what was selected.
      const live = await sheets.values(id, sheetName);
      const stale = staleSelection(live.rows, selected);
      if (stale.length) {
        setData(live);
        setSelected(new Map());
        toast({ tone: 'error', message: 'The sheet changed since you selected those rows, so nothing was deleted. Select them again.' });
        return;
      }
      await sheets.deleteRows(id, sheetId, rowNumbers);
      markAccess('edit');
      mutateRows((rows) => withoutRows(rows, rowNumbers));
      setSelected(new Map());
      refreshSoon();
      toast(`Deleted ${rowNumbers.length} row${rowNumbers.length === 1 ? '' : 's'}`);
    } catch (e) {
      writeFailed(e);
    }
  };

  const pickSheet = async (name) => {
    setSheetName(name);
    setSearch('');
    setFilters({});
    setHidden([]);
    setSort({ col: null, dir: 'asc' });
    setSelected(new Map());
    setEditing(null);
    try { await onSheetChange?.(name); }
    catch (e) { toast({ tone: 'error', message: e.message || 'Could not save the selected tab.' }); }
  };

  /* ---- Render ---- */
  if (phase === 'error') return <SheetProblem error={error} onRetry={refresh} onSetup={onSetup} />;

  return (
    <>
      <div className="toolbar crm-view-toolbar">
        {meta?.sheets.length > 1 && (
          <select className="select" aria-label="Sheet tab" value={sheetName} onChange={(e) => pickSheet(e.target.value)}>
            {meta.sheets.map((s) => <option key={s.sheetId} value={s.title}>{s.title}</option>)}
          </select>
        )}
        <div className="search-input">
          <i className="ti ti-search" />
          <input className="input" aria-label="Search sheet" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn btn--ghost" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          <i className="ti ti-filter" /> Filter{activeFilters > 0 && ` (${activeFilters})`}
        </button>
        <details className="col-toggle">
          <summary className="btn btn--ghost btn--icon" title="Visible columns" aria-label="Visible columns"><i className="ti ti-columns" /></summary>
          <div className="col-toggle-menu">
            {data.headers.map((h, i) => (
              <label className="col-toggle-item" key={i}>
                <input
                  type="checkbox"
                  className="cb"
                  checked={!hidden.includes(i)}
                  disabled={!hidden.includes(i) && visibleCols.length === 1}
                  onChange={() => setHidden((prev) => (prev.includes(i) ? prev.filter((v) => v !== i) : [...prev, i]))}
                />
                {h}
              </label>
            ))}
          </div>
        </details>
        <button className="btn btn--ghost btn--icon" title="Refresh from Google Sheets" aria-label="Refresh sheet" disabled={syncing} onClick={refresh}>
          {syncing ? <Spinner /> : <i className="ti ti-refresh" />}
        </button>
        {access === 'view' && (
          <span className="crm-chip" title="Share the sheet with the service account as an Editor to edit here.">
            <i className="ti ti-eye" /> View only
          </span>
        )}
        {canEdit && data.headers.length > 0 && (
          <button className="btn" onClick={() => setAdding(true)}><i className="ti ti-plus" /> Add row</button>
        )}
        <a className="btn btn--ghost crm-open-sheet" href={sheetUrl} target="_blank" rel="noopener noreferrer" title="Open in Google Sheets">
          <SheetsLogo /> Open in Sheets <i className="ti ti-external-link" />
        </a>
      </div>

      {showFilters && (
        <div className="crm-filters">
          {data.headers.map((h, i) => (
            <label className="field" key={i}>
              <span className="field-label">{h}</span>
              <select
                className="select"
                value={Object.hasOwn(filters, i) ? JSON.stringify(filters[i]) : ''}
                onChange={(e) => setFilters((prev) => {
                  const next = { ...prev };
                  if (!e.target.value) delete next[i];
                  else next[i] = JSON.parse(e.target.value);
                  return next;
                })}
              >
                <option value="">All values</option>
                {distinctValues(data.rows, i).map((v) => <option value={JSON.stringify(v)} key={v}>{v || '(Empty)'}</option>)}
              </select>
            </label>
          ))}
          {activeFilters > 0 && <button className="btn btn--ghost" onClick={() => setFilters({})}>Clear filters</button>}
          {!data.headers.length && <p className="body-text">Filters appear when the sheet has columns.</p>}
        </div>
      )}

      {error && (
        <p className="body-text crm-error" role="alert">
          Couldn’t refresh from Google ({error.message}). Showing the last copy.
        </p>
      )}
      {data.truncated && (
        <p className="body-text crm-notice" role="status">
          Showing the first {data.rowLimit.toLocaleString()} rows. Open the sheet in Google Sheets to see the rest.
        </p>
      )}
      {selected.size > 0 && (
        <div className="crm-selectbar" role="status">
          <span>{selected.size} selected</span>
          <button className="btn btn--sm btn--danger" onClick={deleteSelected}><i className="ti ti-trash" /> Delete</button>
          <button className="btn btn--sm btn--ghost" onClick={() => setSelected(new Map())}>Clear</button>
        </div>
      )}

      {phase === 'loading' ? (
        <div className="crm-empty" role="status"><Spinner /><span>Loading sheet…</span></div>
      ) : !data.headers.length ? (
        <div className="crm-empty"><p>This sheet is empty.</p><span>Add column headings in row 1 in Google Sheets, then refresh.</span></div>
      ) : (
        <>
          <div className="table-wrap crm-scroll">
            <table className="data-table crm-read-table" aria-label={`${board.name} · ${sheetName}`}>
              <thead>
                <tr>
                  {canEdit && (
                    <th className="crm-check-col">
                      <input type="checkbox" className="cb" aria-label="Select all rows" checked={allSelected} onChange={toggleAll} />
                    </th>
                  )}
                  {visibleCols.map((c) => (
                    <th key={c} aria-sort={sort.col === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="crm-sort" onClick={() => setSort((p) => ({ col: c, dir: p.col === c && p.dir === 'asc' ? 'desc' : 'asc' }))}>
                        {data.headers[c]}
                        {sort.col === c && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.map((r) => (
                  <tr key={r.row} className={selected.has(r.row) ? 'is-selected' : ''}>
                    {canEdit && (
                      <td className="crm-check-col">
                        <input type="checkbox" className="cb" aria-label={`Select row ${r.row}`} checked={selected.has(r.row)} onChange={() => toggleRow(r)} />
                      </td>
                    )}
                    {visibleCols.map((c) => {
                      const text = r.cells[c] ?? '';
                      const isEditing = editing?.row === r.row && editing?.col === c;
                      const link = isEditing ? null : cellLink(text);
                      return (
                        <td
                          key={c}
                          className={`crm-cell ${canEdit ? 'is-editable' : ''} ${isEditing ? 'is-editing' : ''}`}
                          tabIndex={canEdit && !isEditing ? 0 : undefined}
                          onDoubleClick={() => !isEditing && startEdit(r, c)}
                          onClick={(e) => {
                            if (touch && !isEditing && !e.target.closest('a,button,input,textarea')) startEdit(r, c);
                          }}
                          onKeyDown={(e) => {
                            if (canEdit && !isEditing && e.key === 'Enter' && e.target === e.currentTarget) {
                              e.preventDefault();
                              startEdit(r, c);
                            }
                          }}
                        >
                          {isEditing ? (
                            <textarea
                              className="input crm-cell-input"
                              autoFocus
                              rows={Math.min(6, (editing.draft.match(/\n/g) || []).length + 1)}
                              value={editing.draft}
                              aria-label={`Edit ${data.headers[c]}`}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setEditing((p) => ({ ...p, draft: e.target.value }))}
                              onKeyDown={(e) => onEditKey(e, r, c)}
                              onBlur={() => { if (!cancelEdit.current && editing) commit(r.row, c, editing.draft); }}
                            />
                          ) : link ? (
                            <>
                              <a href={link.href} target={link.kind === 'url' ? '_blank' : undefined} rel="noopener noreferrer">{text}</a>
                              {canEdit && (
                                <button className="crm-cell-edit" aria-label={`Edit ${data.headers[c]}`} title="Edit" onClick={() => startEdit(r, c)}>
                                  <i className="ti ti-pencil" />
                                </button>
                              )}
                            </>
                          ) : (
                            text || <span className="crm-blank">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="crm-empty">
                <p>{data.rows.length ? 'No rows match your search or filters.' : 'No rows yet. Add one here or in Google Sheets.'}</p>
                {data.rows.length > 0 && <button className="btn btn--ghost" onClick={() => { setSearch(''); setFilters({}); }}>Clear search and filters</button>}
              </div>
            )}
          </div>
          <div className="crm-footer">
            <span className="list-row-meta" aria-live="polite">
              {filtered.length.toLocaleString()} of {data.rows.length.toLocaleString()} rows
              {canEdit && access !== 'edit' && (touch ? ' · tap a cell to edit' : ' · double-click a cell to edit')}
            </span>
            {filtered.length > shown && (
              <button className="btn btn--sm btn--ghost" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
              </button>
            )}
          </div>
        </>
      )}
      {adding && <AddRowModal headers={data.headers} onAdd={addRow} onClose={() => setAdding(false)} />}
    </>
  );
}
