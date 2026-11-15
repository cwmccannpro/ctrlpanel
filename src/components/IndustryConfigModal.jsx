// ============================================================
// Industry Problems Agent → config (gear button). Describes the BUILDER, not
// the industry: what they can build, how long they can spend, who they can sell
// to, and what to steer clear of. The agent scores every problem for
// attainability against this. Saved to agent_configs (agent_key
// 'industry_problems'); the backend reads it at the start of every run.
// ============================================================
import { useState } from 'react';
import Modal from './shared/Modal.jsx';
import { saveAgentConfig } from '../lib/supabase.js';
import {
  INDUSTRY_AGENT_KEY,
  SOLUTION_TYPES,
  BUYERS,
  BUILD_WEEKS,
  SEARCH_DEPTHS,
  RESULT_TARGETS,
  normalizeIndustryConfig,
} from '../lib/industryConfig.js';

export default function IndustryConfigModal({ initial, onClose, onSaved }) {
  const [cfg, setCfg] = useState(() => normalizeIndustryConfig(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const toggle = (key, value) =>
    setCfg((c) => ({ ...c, [key]: c[key].includes(value) ? c[key].filter((v) => v !== value) : [...c[key], value] }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const clean = normalizeIndustryConfig(cfg);
      await saveAgentConfig(INDUSTRY_AGENT_KEY, clean);
      onSaved(clean);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not save.');
      setSaving(false);
    }
  };

  const typesOk = cfg.solution_types.length > 0;
  const buyersOk = cfg.buyers.length > 0;
  const depth = SEARCH_DEPTHS.find((d) => d.value === cfg.max_searches);
  const weeks = BUILD_WEEKS.some((w) => w.value === cfg.build_weeks) ? BUILD_WEEKS : [...BUILD_WEEKS, { value: cfg.build_weeks, label: `≤ ${cfg.build_weeks} weeks` }];
  const targets = [...new Set([...RESULT_TARGETS, cfg.target_results])].sort((a, b) => a - b);

  return (
    <Modal
      wide
      title="Configure Industry Problems Agent"
      onClose={onClose}
      footer={
        <>
          {error && <span className="opp-config-error">{error}</span>}
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={save} disabled={saving || !typesOk || !buyersOk}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="opp-config">
        <div className="field">
          <label className="field-label" htmlFor="ind-builder">What you can build</label>
          <textarea
            id="ind-builder"
            className="textarea"
            rows={5}
            value={cfg.builder}
            onChange={(e) => set({ builder: e.target.value })}
            placeholder="Your skills and stack — e.g. React + Node + Supabase, Python data work, can wire up the Claude API. Solo, nights and weekends."
          />
          <p className="list-row-meta opp-hint">The agent scores every problem for how attainable it is for you, so be honest about time and skills.</p>
        </div>

        <div className="field">
          <span className="field-label">Solutions you'd build</span>
          <div className="chip-group">
            {SOLUTION_TYPES.map((t) => {
              const on = cfg.solution_types.includes(t.id);
              return (
                <button type="button" key={t.id} className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => toggle('solution_types', t.id)}>
                  {t.label}
                </button>
              );
            })}
          </div>
          {!typesOk && <p className="list-row-meta opp-hint">Pick at least one.</p>}
        </div>

        <div className="field">
          <span className="field-label">Who you'd sell to</span>
          <div className="chip-group">
            {BUYERS.map((b) => {
              const on = cfg.buyers.includes(b.id);
              return (
                <button type="button" key={b.id} className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => toggle('buyers', b.id)}>
                  {b.label}
                </button>
              );
            })}
          </div>
          {!buyersOk && <p className="list-row-meta opp-hint">Pick at least one.</p>}
        </div>

        <div className="opp-config-grid">
          <div className="field">
            <span className="field-label">Time to a first version</span>
            <div className="segmented">
              {weeks.map((w) => (
                <button type="button" key={w.value} className={cfg.build_weeks === w.value ? 'active' : ''} onClick={() => set({ build_weeks: w.value })}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ind-home">Home base (optional)</label>
            <input id="ind-home" className="input" value={cfg.home_base} placeholder="e.g. Buffalo, NY" onChange={(e) => set({ home_base: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label className="opp-check">
            <input type="checkbox" checked={cfg.avoid_regulated} onChange={(e) => set({ avoid_regulated: e.target.checked })} />
            Skip heavily regulated problems (patient data, payments or lending, securities, legal or medical advice)
          </label>
          <label className="opp-check">
            <input type="checkbox" checked={cfg.local_first} onChange={(e) => set({ local_first: e.target.checked })} disabled={!cfg.home_base.trim()} />
            Prefer problems whose buyers I could meet in person near my home base
          </label>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ind-avoid">Also avoid</label>
          <input
            id="ind-avoid"
            className="input"
            value={cfg.avoid}
            placeholder="e.g. marketplaces, anything needing hardware, crypto"
            onChange={(e) => set({ avoid: e.target.value })}
          />
        </div>

        <div className="opp-config-grid">
          <div className="field">
            <span className="field-label">Search depth</span>
            <div className="segmented">
              {SEARCH_DEPTHS.map((d) => (
                <button type="button" key={d.value} className={cfg.max_searches === d.value ? 'active' : ''} onClick={() => set({ max_searches: d.value })}>
                  {d.label} · {d.value}
                </button>
              ))}
            </div>
            <p className="list-row-meta opp-hint">
              {depth ? `${depth.estimate} per run` : `${cfg.max_searches} searches per run`} on your Anthropic key (estimate)
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ind-target">Problems per run</label>
            <select id="ind-target" className="select" value={cfg.target_results} onChange={(e) => set({ target_results: Number(e.target.value) })}>
              {targets.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
