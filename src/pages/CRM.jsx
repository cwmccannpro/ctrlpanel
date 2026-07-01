import { useState, useMemo, useRef } from 'react';
import Badge from '../components/shared/Badge.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useRows } from '../lib/useData.js';
import { update as sbUpdate, insert as sbInsert, remove as sbRemove } from '../lib/supabase.js';
import { mockContacts, SERVICE_OPTIONS, LEAD_TEMPS } from '../lib/mockData.js';
import { formatDate } from '../lib/helpers.js';

// Column order per AGENTS.md
const COLUMNS = [
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

export default function CRM() {
  const { rows, setRows, usingMock } = useRows('crm_contacts', mockContacts);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'business_name', dir: 'asc' });
  const [visible, setVisible] = useState(() => Object.fromEntries(COLUMNS.map((c) => [c.key, true])));
  const [showCols, setShowCols] = useState(false);
  const [editCell, setEditCell] = useState(null); // { id, key }
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(null);
  const fileRef = useRef(null);

  const cols = COLUMNS.filter((c) => visible[c.key]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (q) {
      r = rows.filter((row) =>
        COLUMNS.some((c) => String(row[c.key] ?? '').toLowerCase().includes(q))
      );
    }
    const { key, dir } = sort;
    return [...r].sort((a, b) => {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, search, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const saveCell = (id, key, value) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    sbUpdate('crm_contacts', id, { [key]: value });
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
    const created = { ...adding, id: newId() };
    setRows((prev) => [created, ...prev]);
    sbInsert('crm_contacts', [{ ...adding }]);
    setAdding(null);
  };

  const importCsv = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return;
      const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const keyFor = (h) =>
        COLUMNS.find((c) => c.label.toLowerCase() === h || c.key === h.replace(/\s+/g, '_'))?.key;
      const imported = lines.slice(1).map((line) => {
        const cells = parseCsvLine(line);
        const row = { id: newId() };
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

  const renderCell = (row, col) => {
    const editing = editCell?.id === row.id && editCell?.key === col.key;
    if (col.type === 'bool') {
      return (
        <input
          type="checkbox"
          className="cb"
          checked={!!row[col.key]}
          onChange={(e) => saveCell(row.id, col.key, e.target.checked)}
        />
      );
    }
    if (editing) {
      if (col.type === 'select') {
        return (
          <select
            className="cell-input"
            autoFocus
            defaultValue={row[col.key] || ''}
            onBlur={(e) => saveCell(row.id, col.key, e.target.value)}
            onChange={(e) => saveCell(row.id, col.key, e.target.value)}
          >
            <option value="">—</option>
            {col.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      }
      return (
        <input
          className="cell-input"
          type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
          autoFocus
          defaultValue={row[col.key] ?? ''}
          onBlur={(e) => saveCell(row.id, col.key, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveCell(row.id, col.key, e.target.value)}
        />
      );
    }
    if (col.key === 'lead_temp' && row[col.key]) {
      return <Badge variant={row[col.key]}>{row[col.key]}</Badge>;
    }
    let display = row[col.key];
    if (col.type === 'date') display = formatDate(display);
    return <span>{display ?? '—'}</span>;
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">CRM</h1>
          <div className="page-header-sub">
            {rows.length} contacts {usingMock && '· demo data'}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-input">
          <i className="ti ti-search" />
          <input
            className="input"
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="col-toggle">
          <button className="btn" onClick={() => setShowCols((s) => !s)}>
            <i className="ti ti-columns" /> Columns
          </button>
          {showCols && (
            <div className="col-toggle-menu">
              {COLUMNS.map((c) => (
                <label key={c.key} className="col-toggle-item">
                  <input
                    type="checkbox"
                    className="cb"
                    checked={visible[c.key]}
                    onChange={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <i className="ti ti-file-import" /> Import CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv" hidden onChange={importCsv} />
        {selected.size > 0 && (
          <button className="btn btn--danger" onClick={bulkDelete}>
            <i className="ti ti-trash" /> Delete ({selected.size})
          </button>
        )}
        <button className="btn btn--accent" style={{ marginLeft: 'auto' }} onClick={() => setAdding({ lead_temp: 'Cold' })}>
          <i className="ti ti-plus" /> Add Contact
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              {cols.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)}>
                  {c.label}
                  {sort.key === c.key && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    className="cb"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                  />
                </td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={c.type !== 'bool' ? 'editable' : ''}
                    onClick={() => c.type !== 'bool' && setEditCell({ id: row.id, key: c.key })}
                  >
                    {renderCell(row, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal
          title="Add Contact"
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button className="btn btn--accent" onClick={saveNew}>
                Save
              </button>
            </>
          }
        >
          {COLUMNS.map((c) => (
            <div className="field" key={c.key}>
              <label className="field-label">{c.label}</label>
              {c.type === 'select' ? (
                <select
                  className="select"
                  value={adding[c.key] || ''}
                  onChange={(e) => setAdding({ ...adding, [c.key]: e.target.value })}
                >
                  <option value="">—</option>
                  {c.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : c.type === 'bool' ? (
                <input
                  type="checkbox"
                  className="cb"
                  checked={!!adding[c.key]}
                  onChange={(e) => setAdding({ ...adding, [c.key]: e.target.checked })}
                />
              ) : (
                <input
                  className="input"
                  type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                  value={adding[c.key] || ''}
                  onChange={(e) => setAdding({ ...adding, [c.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

// Minimal CSV line parser handling double-quoted fields.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
