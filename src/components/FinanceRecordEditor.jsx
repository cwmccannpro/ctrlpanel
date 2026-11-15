import { useEffect, useRef, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { FINANCE_TABLES, financeDay, validateFinanceRecord } from '../lib/financeSheet.js';

export default function FinanceRecordEditor({ table, row, finance, onClose }) {
  const def = FINANCE_TABLES[table];
  const [baseRow, setBaseRow] = useState(row);
  const [values, setValues] = useState(() => Object.fromEntries(def.fields.map((f) => [f.key, row?.[f.key] ?? (f.type === 'date' ? financeDay() : f.type === 'boolean' ? false : f.options?.[0] || '')])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removed, setRemoved] = useState(false);
  const ref = useRef(null);
  // Modal focus is contained, and returns to the edit/add control on close.
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current.closest('.modal');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', `${row ? 'Edit' : 'Add'} ${def.label}`);
    const trap = (e) => {
      if (e.key !== 'Tab') return;
      const els = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
      if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0]?.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    ref.current.querySelector('input:not(:disabled)')?.focus();
    return () => { dialog.removeEventListener('keydown', trap); previous?.focus(); };
  }, []);
  const run = async (remove = false) => {
    setBusy(true); setError('');
    try {
      if (remove) await finance.remove(table, baseRow);
      else await finance.save(table, baseRow, validateFinanceRecord(table, values));
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const loadLatest = async () => {
    setBusy(true);
    try {
      const workbook = await finance.reload();
      const latest = workbook.data?.[table]?.find((r) => r.id === baseRow.id);
      if (!latest) { setRemoved(true); setError('This record was removed from Google Sheets. Close the editor to continue.'); return; }
      setBaseRow(latest); setValues(Object.fromEntries(def.fields.map((f) => [f.key, latest[f.key] ?? '']))); setError(''); setDeleting(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <Modal title={`${row ? 'Edit' : 'Add'} ${def.label.toLowerCase()}`} onClose={() => !busy && onClose()}>
    <form ref={ref} className="fin-editor" onSubmit={(e) => { e.preventDefault(); run(); }}>
      <p className="fin-caption">Saved directly to your Google Sheet. Calculated fields stay managed by their formulas.</p>
      <div className="fin-editor-grid">{def.fields.map((f) => {
        const locked = baseRow?.locked?.includes(f.key);
        const options = f.type === 'category' ? (finance.data.budget || []).map((r) => ({ id: r.id, name: r.name })) : f.type === 'account' ? (finance.data.accounts || []).map((r) => ({ id: r.id, name: r.name })) : f.options?.filter((v) => finance.includeDebt || table !== 'accounts' || v !== 'Liability').map((v) => ({ id: v, name: v }));
        const change = (v) => setValues((old) => ({ ...old, [f.key]: v }));
        return <label className={`field ${f.key === 'notes' ? 'fin-span' : ''}`} key={f.key}>
          <span className="field-label">{f.label}{locked && ' · Formula'}</span>
          {f.type === 'boolean' ? <span className="fin-checkbox"><input type="checkbox" checked={!!values[f.key]} disabled={locked || busy} onChange={(e) => change(e.target.checked)} /> Include in monthly plan</span> : options ? <select className="select" disabled={locked || busy} value={values[f.key]} onChange={(e) => change(e.target.value)}>{!f.options && <option value="">Unassigned</option>}{!f.options && values[f.key] && !options.some((o) => o.id === values[f.key]) && <option value={values[f.key]}>Archived reference</option>}{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any" min={f.min} disabled={locked || busy} value={values[f.key] ?? ''} onChange={(e) => change(e.target.value)} placeholder={f.optional ? 'Unknown' : ''} required={f.key === 'name' || f.type === 'date' || (f.type === 'number' && !f.optional)} />}
        </label>;
      })}</div>
      {error && <p className="fin-error" role="alert">{error}{baseRow && !removed && error.includes('changed') && <button type="button" className="btn btn--sm" disabled={busy} onClick={loadLatest}>Reload latest values</button>}</p>}
      {deleting && <p className="fin-error">Remove this record from the sheet? Its cells will be cleared. <button type="button" className="btn btn--sm" disabled={busy} onClick={() => run(true)}>Confirm removal</button><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setDeleting(false)}>Keep record</button></p>}
      <div className="fin-form-actions">{row && <button className="btn btn--ghost" type="button" disabled={busy || removed || !!baseRow.locked?.length} onClick={() => setDeleting(true)}>Remove</button>}<span className="fin-spacer" /><button className="btn btn--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn--accent" disabled={busy || removed}>{busy ? 'Saving…' : 'Save to Sheets'}</button></div>
    </form>
  </Modal>;
}
