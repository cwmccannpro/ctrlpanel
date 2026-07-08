import { useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Badge from '../components/shared/Badge.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useRows } from '../lib/useData.js';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import { update as sbUpdate, insert as sbInsert, remove as sbRemove } from '../lib/supabase.js';
import { SERVICE_OPTIONS, LEAD_TEMPS } from '../lib/mockData.js';
import { formatDate } from '../lib/helpers.js';

// Fixed columns (order per AGENTS.md)
const FIXED_COLUMNS = [
  { key: 'business_name', label: 'Business Name', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'business_type', label: 'Business Type', type: 'text' },
  { key: 'service', label: 'Service', type: 'select', options: SERVICE_OPTIONS },
  { key: 'lead_temp', label: 'Lead Temp', type: 'select', options: LEAD_TEMPS },
  { key: 'rating', label: 'Rating', type: 'number' },
  { key: 'total_reviews', label: 'Total Reviews', type: 'number' },
  { key: 'opening_hours', label: 'Opening Hours', type: 'text' },
  { key: 'search_location', label: 'Search Location', type: 'text' },
  { key: 'times_called', label: 'Times Called', type: 'number' },
  { key: 'last_touch', label: 'Last Touch', type: 'date' },
  { key: 'left_voicemail', label: 'Left Voicemail', type: 'bool' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

let tmpId = 0;
const newId = () => `new-${Date.now()}-${tmpId++}`;
const slug = (label) =>
  'c_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Math.random().toString(36).slice(2, 5);

// Read/write a cell value from a fixed column or the custom jsonb bag.
const cellValue = (row, col) => (col.custom ? row.custom?.[col.key] ?? '' : row[col.key] ?? '');

export default function CRM() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { crmBoards } = useWorkspace();
  const { rows, setRows } = useRows('crm_contacts', []);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'business_name', dir: 'asc' });
  const [hidden, setHidden] = useState(new Set());
  const [showCols, setShowCols] = useState(false);
  const [editCell, setEditCell] = useState(null); // { id, key }
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(null);
  const fileRef = useRef(null);

  const board = crmBoards.rows.find((b) => b.id === boardId) || null;
  const customCols = (board?.columns || []).map((c) => ({ ...c, type: 'text', custom: true }));
  const allCols = [...FIXED_COLUMNS, ...customCols];
  const cols = allCols.filter((c) => !hidden.has(c.key));

  // Contacts scoped to the selected board (or all)
  const scoped = boardId ? rows.filter((r) => r.board_id === boardId) : rows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = scoped;
    if (q) r = scoped.filter((row) => allCols.some((c) => String(cellValue(row, c)).toLowerCase().includes(q)));
    const { key, dir } = sort;
    const col = allCols.find((c) => c.key === key);
    return [...r].sort((a, b) => {
      const av = col ? cellValue(a, col) : '';
      const bv = col ? cellValue(b, col) : '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, search, sort, customCols.length]);

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const saveCell = (row, col, value) => {
    if (col.custom) {
      const next = { ...(row.custom || {}), [col.key]: value };
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, custom: next } : r)));
      sbUpdate('crm_contacts', row.id, { custom: next });
    } else {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [col.key]: value } : r)));
      sbUpdate('crm_contacts', row.id, { [col.key]: value });
    }
    setEditCell(null);
  };

  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const bulkDelete = () => {
    setRows((prev) => prev.filter((r) => !selected.has(r.id)));
    selected.forEach((id) => sbRemove('crm_contacts', id));
    setSelected(new Set());
  };

  const saveNew = () => {
    if (!adding.business_name?.trim()) return;
    const record = { ...adding, board_id: boardId || null };
    setRows((prev) => [{ ...record, id: newId() }, ...prev]);
    sbInsert('crm_contacts', [record]);
    setAdding(null);
  };

  // ---- Board (CRM page) management ----
  const changeBoard = (val) => navigate(val === 'all' ? '/crm' : `/crm/${val}`);
  const newBoard = async () => {
    const name = prompt('CRM page name?');
    if (!name) return;
    const created = await crmBoards.add({ name, columns: [] });
    if (created?.id) navigate(`/crm/${created.id}`);
  };
  const renameBoard = () => {
    const name = prompt('Rename CRM page', board.name);
    if (name) crmBoards.patch(boardId, { name });
  };
  const deleteBoard = () => {
    if (!confirm(`Delete CRM page "${board.name}"? Contacts stay under All contacts.`)) return;
    crmBoards.remove(boardId);
    navigate('/crm');
  };

  // ---- Custom columns ----
  const addColumn = () => {
    const label = prompt('New column name?');
    if (!label) return;
    crmBoards.patch(boardId, { columns: [...(board.columns || []), { key: slug(label), label }] });
  };
  const deleteColumn = (key) => crmBoards.patch(boardId, { columns: (board.columns || []).filter((c) => c.key !== key) });

  const renderCell = (row, col) => {
    const editing = editCell?.id === row.id && editCell?.key === col.key;
    if (col.type === 'bool') {
      return <input type="checkbox" className="cb" checked={!!row[col.key]} onChange={(e) => saveCell(row, col, e.target.checked)} />;
    }
    if (editing) {
      if (col.type === 'select') {
        return (
          <select className="cell-input" autoFocus defaultValue={cellValue(row, col)} onBlur={(e) => saveCell(row, col, e.target.value)} onChange={(e) => saveCell(row, col, e.target.value)}>
            <option value="">—</option>
            {col.options.map((o) => <option key={o}>{o}</option>)}
          </select>
        );
      }
      return (
        <input
          className="cell-input"
          type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
          autoFocus
          defaultValue={cellValue(row, col)}
          onBlur={(e) => saveCell(row, col, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveCell(row, col, e.target.value)}
        />
      );
    }
    if (col.key === 'lead_temp' && row[col.key]) return <Badge variant={row[col.key]}>{row[col.key]}</Badge>;
    let display = cellValue(row, col);
    if (col.type === 'date') display = formatDate(display);
    return <span>{display === '' || display == null ? '—' : display}</span>;
  };

  const importCsv = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return;
      const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const keyFor = (h) => FIXED_COLUMNS.find((c) => c.label.toLowerCase() === h || c.key === h.replace(/\s+/g, '_'))?.key;
      const imported = lines.slice(1).map((line) => {
        const cells = parseCsvLine(line);
        const row = { id: newId(), board_id: boardId || null };
        headers.forEach((h, i) => {
          const k = keyFor(h);
          if (k) row[k] = cells[i];
        });
        return row;
      });
      setRows((prev) => [...imported, ...prev]);
      sbInsert('crm_contacts', imported.map(({ id, ...rest }) => rest));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{board ? board.name : 'CRM'}</h1>
          <div className="page-header-sub">{scoped.length} contacts{board ? ' · this page' : ''}</div>
        </div>
      </div>

      <div className="toolbar">
        {/* CRM page selector */}
        <select className="select" value={boardId || 'all'} onChange={(e) => changeBoard(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All contacts</option>
          {crmBoards.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn" onClick={newBoard}><i className="ti ti-plus" /> New page</button>
        {board && <button className="btn btn--ghost btn--icon" onClick={renameBoard} title="Rename page"><i className="ti ti-pencil" /></button>}
        {board && <button className="btn btn--ghost btn--icon" onClick={deleteBoard} title="Delete page"><i className="ti ti-trash" /></button>}

        <div className="search-input" style={{ marginLeft: 8 }}>
          <i className="ti ti-search" />
          <input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="col-toggle">
          <button className="btn" onClick={() => setShowCols((s) => !s)}><i className="ti ti-columns" /> Columns</button>
          {showCols && (
            <div className="col-toggle-menu">
              {allCols.map((c) => (
                <div key={c.key} className="col-toggle-item">
                  <label className="row" style={{ gap: 8, flex: 1, cursor: 'pointer' }}>
                    <input type="checkbox" className="cb" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                    {c.label}
                  </label>
                  {c.custom && <button className="btn btn--ghost btn--icon" onClick={() => deleteColumn(c.key)} title="Delete column"><i className="ti ti-trash" /></button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {board && <button className="btn" onClick={addColumn}><i className="ti ti-table-plus" /> Add column</button>}

        <button className="btn" onClick={() => fileRef.current?.click()}><i className="ti ti-file-import" /> Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv" hidden onChange={importCsv} />

        {selected.size > 0 && <button className="btn btn--danger" onClick={bulkDelete}><i className="ti ti-trash" /> Delete ({selected.size})</button>}
        <button className="btn btn--accent" style={{ marginLeft: 'auto' }} onClick={() => setAdding({ lead_temp: 'Cold' })}><i className="ti ti-plus" /> Add Contact</button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36, cursor: 'default' }} />
              {cols.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)}>
                  {c.label}{c.custom && ' *'}
                  {sort.key === c.key && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><input type="checkbox" className="cb" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} /></td>
                {cols.map((c) => (
                  <td key={c.key} className={c.type !== 'bool' ? 'editable' : ''} onClick={() => c.type !== 'bool' && setEditCell({ id: row.id, key: c.key })}>
                    {renderCell(row, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="body-text" style={{ padding: 16 }}>No contacts yet. Add one, or import a CSV.</p>}
      </div>

      {adding && (
        <Modal
          title="Add Contact"
          onClose={() => setAdding(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAdding(null)}>Cancel</button><button className="btn btn--accent" onClick={saveNew}>Save</button></>}
        >
          {FIXED_COLUMNS.map((c) => (
            <div className="field" key={c.key}>
              <label className="field-label">{c.label}</label>
              {c.type === 'select' ? (
                <select className="select" value={adding[c.key] || ''} onChange={(e) => setAdding({ ...adding, [c.key]: e.target.value })}>
                  <option value="">—</option>
                  {c.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : c.type === 'bool' ? (
                <input type="checkbox" className="cb" checked={!!adding[c.key]} onChange={(e) => setAdding({ ...adding, [c.key]: e.target.checked })} />
              ) : (
                <input className="input" type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'} value={adding[c.key] || ''} onChange={(e) => setAdding({ ...adding, [c.key]: e.target.value })} />
              )}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
