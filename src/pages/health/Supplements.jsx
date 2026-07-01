import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Card from '../../components/shared/Card.jsx';
import Badge from '../../components/shared/Badge.jsx';
import Modal from '../../components/shared/Modal.jsx';
import Spinner from '../../components/shared/Spinner.jsx';
import { useRows } from '../../lib/useData.js';
import { update as sbUpdate, insert as sbInsert } from '../../lib/supabase.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../components/AuthProvider.jsx';
import { mockSupplements, SUPPLEMENT_TIMINGS } from '../../lib/mockData.js';

let tmpId = 0;

export default function Supplements() {
  const { rows: supps, setRows: setSupps, usingMock } = useRows('supplements', mockSupplements);
  const { connectorKey } = useAuth();
  const [taken, setTaken] = useState(new Set());
  const [adding, setAdding] = useState(null);

  const [stackResult, setStackResult] = useState(null);
  const [stackLoading, setStackLoading] = useState(false);
  const [intA, setIntA] = useState('');
  const [intB, setIntB] = useState('');
  const [intResult, setIntResult] = useState(null);
  const [intLoading, setIntLoading] = useState(false);

  const toggle = (s) => {
    setSupps((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    sbUpdate('supplements', s.id, { enabled: !s.enabled });
  };

  const toggleTaken = (id) =>
    setTaken((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const saveNew = () => {
    if (!adding.name?.trim()) return;
    const created = { ...adding, id: `new-${Date.now()}-${tmpId++}`, enabled: true, streak: 0 };
    setSupps((prev) => [...prev, created]);
    sbInsert('supplements', [{ name: adding.name, dose: adding.dose, timing: adding.timing, units_remaining: Number(adding.units_remaining) || 0, enabled: true }]);
    setAdding(null);
  };

  const analyzeStack = async () => {
    setStackLoading(true);
    setStackResult(null);
    try {
      const enabled = supps.filter((s) => s.enabled).map(({ name, dose, timing }) => ({ name, dose, timing }));
      const { result, error } = await api.post('/ai/supplement-analyze', { supplements: enabled, apiKey: connectorKey('anthropic') || undefined });
      setStackResult(error ? `⚠️ ${error}` : result);
    } catch (e) {
      setStackResult(`⚠️ ${e.message}\n\nStart the backend (npm run server) and set ANTHROPIC_API_KEY in .env.`);
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
          <div className="page-header-sub">{supps.filter((s) => s.enabled).length} active in stack {usingMock && '· demo data'}</div>
        </div>
        <button className="btn btn--accent" onClick={() => setAdding({ timing: 'Morning' })}>
          <i className="ti ti-plus" /> Add Supplement
        </button>
      </div>

      <div className="grid grid-2">
        {/* Stack list */}
        <Card className="card-section" static>
          <div className="card-section-title">Stack</div>
          {supps.map((s) => (
            <div className="list-row" key={s.id}>
              <div className={`switch ${s.enabled ? 'on' : ''}`} onClick={() => toggle(s)} />
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{s.name}</div>
                <div className="list-row-meta">{s.dose} · {s.streak}d streak</div>
              </div>
              <Badge variant="accent">{s.timing}</Badge>
              {s.units_remaining < 7 ? (
                <Badge variant="hot">{s.units_remaining} left</Badge>
              ) : (
                <span className="list-row-meta">{s.units_remaining} left</span>
              )}
            </div>
          ))}
        </Card>

        {/* Daily checklist by timing */}
        <Card className="card-section" static>
          <div className="card-section-title">Today's Checklist</div>
          {SUPPLEMENT_TIMINGS.map((slot) => {
            const items = supps.filter((s) => s.enabled && s.timing === slot);
            if (items.length === 0) return null;
            return (
              <div key={slot} style={{ marginBottom: 10 }}>
                <div className="section-label" style={{ marginBottom: 4 }}>{slot}</div>
                {items.map((s) => (
                  <div className="checklist-item" key={s.id} onClick={() => toggleTaken(s.id)}>
                    <div className={`check-box ${taken.has(s.id) ? 'checked' : ''}`}>
                      {taken.has(s.id) && <i className="ti ti-check" style={{ fontSize: 12 }} />}
                    </div>
                    <span className="list-row-title" style={{ textDecoration: taken.has(s.id) ? 'line-through' : 'none' }}>
                      {s.name}
                    </span>
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
          <button className="btn btn--accent btn--sm" onClick={analyzeStack} disabled={stackLoading}>
            {stackLoading ? <Spinner /> : <><i className="ti ti-sparkles" /> Analyze My Stack</>}
          </button>
        </div>
        {stackResult ? (
          <div className="ai-result">
            <ReactMarkdown>{stackResult}</ReactMarkdown>
          </div>
        ) : (
          <p className="body-text">Sends your active supplements to Claude for interactions, redundancies, timing, and insights.</p>
        )}
      </Card>

      {/* Quick Interaction Checker */}
      <Card className="card-section" static>
        <div className="card-section-title">Quick Interaction Checker</div>
        <div className="toolbar">
          <input className="input" placeholder="Supplement / drug A" value={intA} onChange={(e) => setIntA(e.target.value)} style={{ width: 200 }} />
          <i className="ti ti-arrows-exchange" style={{ color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Supplement / drug B" value={intB} onChange={(e) => setIntB(e.target.value)} style={{ width: 200 }} />
          <button className="btn btn--accent" onClick={checkInteraction} disabled={intLoading}>
            {intLoading ? <Spinner /> : 'Check Interaction'}
          </button>
        </div>
        {intResult && (
          <div className="ai-result mt-16">
            <ReactMarkdown>{intResult}</ReactMarkdown>
          </div>
        )}
      </Card>

      {adding && (
        <Modal
          title="Add Supplement"
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveNew}>Save</button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Name</label>
            <input className="input" value={adding.name || ''} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Dose</label>
              <input className="input" value={adding.dose || ''} onChange={(e) => setAdding({ ...adding, dose: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Timing</label>
              <select className="select" value={adding.timing} onChange={(e) => setAdding({ ...adding, timing: e.target.value })}>
                {SUPPLEMENT_TIMINGS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label className="field-label">Units remaining</label>
            <input className="input" type="number" value={adding.units_remaining || ''} onChange={(e) => setAdding({ ...adding, units_remaining: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  );
}
