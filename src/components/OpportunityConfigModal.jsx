// ============================================================
// Opportunities Agent → config (gear button). Edits what the agent looks
// for: profile (typed or imported from a resume PDF), current focus,
// industries, kinds, level, locations, keywords, examples and search depth.
// Saved to agent_configs (agent_key 'opportunities') — the backend reads it
// at the start of every run, so changes apply to the next run.
// ============================================================
import { useRef, useState } from 'react';
import Modal from './shared/Modal.jsx';
import { useAuth } from './AuthProvider.jsx';
import { agentsApi } from '../lib/api.js';
import { saveAgentConfig } from '../lib/supabase.js';
import {
  OPPORTUNITIES_AGENT_KEY,
  OPPORTUNITY_KINDS,
  INDUSTRY_PRESETS,
  CITY_PRESETS,
  EXPERIENCE_LEVELS,
  SEARCH_DEPTHS,
  RESULT_TARGETS,
  normalizeConfig,
} from '../lib/opportunityConfig.js';

const MAX_PDF_BYTES = 700 * 1024;

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function OpportunityConfigModal({ initial, onClose, onSaved }) {
  const { connectorKey } = useAuth();
  const [cfg, setCfg] = useState(() => normalizeConfig(initial));
  const [customIndustry, setCustomIndustry] = useState('');
  const [customCity, setCustomCity] = useState('');
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const toggle = (key, value) =>
    setCfg((c) => ({ ...c, [key]: c[key].includes(value) ? c[key].filter((v) => v !== value) : [...c[key], value] }));
  const addCustom = (key, value, reset) => {
    const v = value.trim();
    if (!v) return;
    setCfg((c) => (c[key].includes(v) ? c : { ...c, [key]: [...c[key], v] }));
    reset('');
  };
  // Presets plus anything custom the user added, each a toggle chip.
  const chipsFor = (key, presets) =>
    [...new Set([...presets, ...cfg[key]])].map((v) => {
      const on = cfg[key].includes(v);
      return (
        <button type="button" key={v} className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => toggle(key, v)}>
          {v}
        </button>
      );
    });

  const importResume = async (file) => {
    if (!file) return;
    setError('');
    if (file.type !== 'application/pdf') return setError('Choose a PDF file.');
    if (file.size > MAX_PDF_BYTES) return setError('That PDF is too large (max 700 KB).');
    setImporting(true);
    try {
      const { profile } = await agentsApi.extractProfile(await readAsBase64(file), connectorKey('anthropic') || undefined);
      set({ profile });
    } catch (e) {
      setError(e.message || 'Could not read that resume.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const clean = normalizeConfig(cfg);
      await saveAgentConfig(OPPORTUNITIES_AGENT_KEY, clean);
      onSaved(clean);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not save.');
      setSaving(false);
    }
  };

  const kindsOk = cfg.kinds.length > 0;
  const depth = SEARCH_DEPTHS.find((d) => d.value === cfg.max_searches);
  const levels = EXPERIENCE_LEVELS.includes(cfg.level) ? EXPERIENCE_LEVELS : [...EXPERIENCE_LEVELS, cfg.level];
  const targets = [...new Set([...RESULT_TARGETS, cfg.target_results])].sort((a, b) => a - b);

  return (
    <Modal
      wide
      title="Configure Opportunities Agent"
      onClose={onClose}
      footer={
        <>
          {error && <span className="opp-config-error">{error}</span>}
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={save} disabled={saving || importing || !kindsOk}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="opp-config">
        <div className="field">
          <div className="opp-field-head">
            <label className="field-label" htmlFor="opp-profile">Profile</label>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()} disabled={importing}>
              <i className={`ti ${importing ? 'ti-loader-2 opp-spin' : 'ti-file-upload'}`} />
              {importing ? 'Reading resume…' : 'Import from resume PDF'}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => importResume(e.target.files?.[0])} />
          </div>
          <textarea
            id="opp-profile"
            className="textarea"
            rows={7}
            value={cfg.profile}
            onChange={(e) => set({ profile: e.target.value })}
            placeholder="Education, experience, skills and certifications — or import your resume."
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="opp-focus">Current focus</label>
          <textarea
            id="opp-focus"
            className="textarea"
            rows={2}
            value={cfg.focus}
            onChange={(e) => set({ focus: e.target.value })}
            placeholder="e.g. Studying for actuarial Exam FM; learning AI and in-demand tech skills"
          />
        </div>

        <div className="field">
          <span className="field-label">Industries</span>
          <div className="chip-group">{chipsFor('industries', INDUSTRY_PRESETS)}</div>
          <div className="chip-add">
            <input
              className="input"
              value={customIndustry}
              placeholder="Add an industry"
              onChange={(e) => setCustomIndustry(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom('industries', customIndustry, setCustomIndustry)}
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => addCustom('industries', customIndustry, setCustomIndustry)}>
              <i className="ti ti-plus" /> Add
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Opportunity types</span>
          <div className="chip-group">
            {OPPORTUNITY_KINDS.map((k) => {
              const on = cfg.kinds.includes(k.id);
              return (
                <button type="button" key={k.id} className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => toggle('kinds', k.id)}>
                  {k.label}
                </button>
              );
            })}
          </div>
          {!kindsOk && <p className="list-row-meta opp-hint">Pick at least one type.</p>}
        </div>

        <div className="opp-config-grid">
          <div className="field">
            <label className="field-label" htmlFor="opp-level">Experience level</label>
            <select id="opp-level" className="select" value={cfg.level} onChange={(e) => set({ level: e.target.value })}>
              {levels.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="opp-home">Home base</label>
            <input
              id="opp-home"
              className="input"
              value={cfg.home_base}
              placeholder="e.g. Buffalo, NY"
              onChange={(e) => set({ home_base: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">In-person cities within reach</span>
          <div className="chip-group">{chipsFor('cities', CITY_PRESETS)}</div>
          <div className="chip-add">
            <input
              className="input"
              value={customCity}
              placeholder="Add a city"
              onChange={(e) => setCustomCity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom('cities', customCity, setCustomCity)}
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => addCustom('cities', customCity, setCustomCity)}>
              <i className="ti ti-plus" /> Add
            </button>
          </div>
        </div>

        <div className="field">
          <label className="opp-check">
            <input type="checkbox" checked={cfg.remote_us} onChange={(e) => set({ remote_us: e.target.checked })} />
            Include remote opportunities open to US residents
          </label>
          <label className="opp-check">
            <input type="checkbox" checked={cfg.nationwide} onChange={(e) => set({ nationwide: e.target.checked })} />
            Include standout programs and events anywhere in the US worth traveling for
          </label>
        </div>

        <div className="opp-config-grid">
          <div className="field">
            <label className="field-label" htmlFor="opp-include">Prioritize (keywords)</label>
            <input
              id="opp-include"
              className="input"
              value={cfg.include_keywords}
              placeholder="e.g. entry-level, SQL, fellowship"
              onChange={(e) => set({ include_keywords: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="opp-exclude">Exclude (keywords)</label>
            <input
              id="opp-exclude"
              className="input"
              value={cfg.exclude_keywords}
              placeholder="e.g. senior, commission-only, unpaid"
              onChange={(e) => set({ exclude_keywords: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="opp-examples">Examples of things I like</label>
          <textarea
            id="opp-examples"
            className="textarea"
            rows={2}
            value={cfg.examples}
            onChange={(e) => set({ examples: e.target.value })}
            placeholder="e.g. the Claude Corps program; free cloud or AI certifications; SOA exam prep"
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
            <label className="field-label" htmlFor="opp-target">Results per run</label>
            <select id="opp-target" className="select" value={cfg.target_results} onChange={(e) => set({ target_results: Number(e.target.value) })}>
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
