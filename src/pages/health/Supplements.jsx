import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Card from '../../components/shared/Card.jsx';
import Badge from '../../components/shared/Badge.jsx';
import Modal from '../../components/shared/Modal.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import { useCrud } from '../../lib/useData.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../components/AuthProvider.jsx';
import { SUPPLEMENT_TIMINGS } from '../../lib/mockData.js';

export default function Supplements() {
  const { rows: supps, add, patch, remove } = useCrud('supplements');
  const { connectorKey } = useAuth();
  const [taken, setTaken] = useState(new Set());
  const [editing, setEditing] = useState(null);

  const [stackResult, setStackResult] = useState(null);
  const [stackLoading, setStackLoading] = useState(false);
  const [intA, setIntA] = useState('');
  const [intB, setIntB] = useState('');
  const [intResult, setIntResult] = useState(null);
  const [intLoading, setIntLoading] = useState(false);

  const toggle = (s) => patch(s.id, { enabled: !s.enabled });

  const toggleTaken = (id) =>
    setTaken((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = () => {
    if (!editing.name?.trim()) return;
    const payload = {
      name: editing.name,
      dose: editing.dose || null,
      timing: editing.timing || 'Morning',
      units_remaining: editing.units_remaining === '' || editing.units_remaining == null ? null : Number(editing.units_remaining),
    };
    if (editing.id && !String(editing.id).startsWith('tmp-')) patch(editing.id, payload);
    else add({ ...payload, enabled: true });
    setEditing(null);
  };

  const analyzeStack = async () => {
    setStackLoading(true);
    setStackResult(null);
    try {
      const enabled = supps.filter((s) => s.enabled).map(({ name, dose, timing }) => ({ name, dose, timing }));
      const { result, error } = await api.post('/ai/supplement-analyze', { supplements: enabled, apiKey: connectorKey('anthropic') || undefined });
      setStackResult(error ? `⚠️ ${error}` : result);
    } catch (e) {
      setStackResult(`⚠️ ${e.message}`);
    } finally {
      setStackLoading(false);
    }
  };

  const checkInteraction = async () => {
    if (!intA.trim() || !intB.trim()) return;
    setIntLoading(true);
    setIntResult(null);
    try {
      const { result, error } = await api.post('/ai/interaction-check', { a: intA, b: intB, apiKey: connectorKey('anthropic') || undefined });
      setIntResult(error ? `⚠️ ${error}` : result);
    } catch (e) {
      setIntResult(`⚠️ ${e.message}`);
    } finally {
      setIntLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Supplements</h1>
          <div className="page-header-sub">{supps.filter((s) => s.enabled).length} active in stack</div>
        </div>
        <button className="btn btn--accent" onClick={() => setEditing({ timing: 'Morning' })}><i className="ti ti-plus" /> Add Supplement</button>
      </div>

      <div className="grid grid-2">
        {/* Stack list */}
        <Card className="card-section" static>
          <div className="card-section-title">Stack</div>
          {supps.length === 0 && <p className="body-text">No supplements yet. Add your first above.</p>}
          {supps.map((s) => (
            <div className="list-row" key={s.id}>
              <div className={`switch ${s.enabled ? 'on' : ''}`} onClick={() => toggle(s)} />
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{s.name}</div>
                <div className="list-row-meta">{s.dose}</div>
              </div>
              <Badge variant="accent">{s.timing}</Badge>
              {s.units_remaining != null && (s.units_remaining < 7 ? <Badge variant="hot">{s.units_remaining} left</Badge> : <span className="list-row-meta">{s.units_remaining} left</span>)}
              <button className="btn btn--ghost btn--icon" onClick={() => setEditing(s)} title="Edit"><i className="ti ti-pencil" /></button>
              <button className="btn btn--ghost btn--icon" onClick={() => remove(s.id)} title="Delete"><i className="ti ti-x" /></button>
            </div>
          ))}
        </Card>

        {/* Daily checklist by timing */}
        <Card className="card-section" static>
          <div className="card-section-title">Today's Checklist</div>
          {supps.filter((s) => s.enabled).length === 0 && <p className="body-text">Enable supplements to build your checklist.</p>}
          {SUPPLEMENT_TIMINGS.map((slot) => {
            const items = supps.filter((s) => s.enabled && s.timing === slot);
            if (items.length === 0) return null;
            return (
              <div key={slot} style={{ marginBottom: 10 }}>
                <div className="section-label" style={{ marginBottom: 4 }}>{slot}</div>
                {items.map((s) => (
                  <div className="checklist-item" key={s.id} onClick={() => toggleTaken(s.id)}>
                    <div className={`check-box ${taken.has(s.id) ? 'checked' : ''}`}>{taken.has(s.id) && <i className="ti ti-check" style={{ fontSize: 12 }} />}</div>
                    <span className="list-row-title" style={{ textDecoration: taken.has(s.id) ? 'line-through' : 'none' }}>{s.name}</span>
                    <span className="list-row-meta">{s.dose}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      </div>

      {/* AI Stack Evaluator */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <span>AI Stack Evaluator</span>
          <button className="btn btn--accent btn--sm" onClick={analyzeStack} disabled={stackLoading || supps.filter((s) => s.enabled).length === 0}>
            {stackLoading ? <Spinner /> : <><i className="ti ti-sparkles" /> Analyze My Stack</>}
          </button>
        </div>
        {stackResult ? <div className="ai-result"><ReactMarkdown>{stackResult}</ReactMarkdown></div> : <p className="body-text">Sends your active supplements to Claude for interactions, redundancies, timing, and insights.</p>}
      </Card>

      {/* Quick Interaction Checker */}
      <Card className="card-section" static>
        <div className="card-section-title">Quick Interaction Checker</div>
        <div className="toolbar">
          <input className="input" placeholder="Supplement / drug A" value={intA} onChange={(e) => setIntA(e.target.value)} style={{ width: 200 }} />
          <i className="ti ti-arrows-exchange" style={{ color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Supplement / drug B" value={intB} onChange={(e) => setIntB(e.target.value)} style={{ width: 200 }} />
          <button className="btn btn--accent" onClick={checkInteraction} disabled={intLoading}>{intLoading ? <Spinner /> : 'Check Interaction'}</button>
        </div>
        {intResult && <div className="ai-result mt-16"><ReactMarkdown>{intResult}</ReactMarkdown></div>}
      </Card>

      {editing && (
        <Modal
          title={editing.id ? 'Edit Supplement' : 'Add Supplement'}
          onClose={() => setEditing(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
        >
          <div className="field"><label className="field-label">Name</label><input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></div>
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Dose</label><input className="input" value={editing.dose || ''} onChange={(e) => setEditing({ ...editing, dose: e.target.value })} /></div>
            <div className="field"><label className="field-label">Timing</label><select className="select" value={editing.timing} onChange={(e) => setEditing({ ...editing, timing: e.target.value })}>{SUPPLEMENT_TIMINGS.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>
          <div className="field"><label className="field-label">Units remaining</label><input className="input" type="number" value={editing.units_remaining ?? ''} onChange={(e) => setEditing({ ...editing, units_remaining: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}
