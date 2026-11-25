// ============================================================
// CTRLpanel — Dashboard "Saved layouts" dialog (Customize → Saved layouts)
//
// Save the layout on screen under a name, rename, reorder or delete saved ones. Saved
// layouts show as buttons left of "Capture context" in the dashboard header. The rules
// (name length, cap, ordering) live in lib/dashboardLayout.js; the page owns the state.
// ============================================================
import { useState } from 'react';
import Modal from './shared/Modal.jsx';
import { CONFIG_NAME_MAX, MAX_CONFIGS, cleanConfigName } from '../lib/dashboardLayout.js';

function LayoutRow({ config, index, count, isActive, onRename, onMove, onDelete }) {
  const [name, setName] = useState(config.name);
  const commit = () => {
    const clean = cleanConfigName(name);
    if (!clean) { setName(config.name); return; }
    if (clean !== config.name) onRename(config.id, clean);
    setName(clean);
  };
  return (
    <li className="dash2-layout-row">
      <input
        className="input"
        value={name}
        maxLength={CONFIG_NAME_MAX}
        aria-label={`Name of saved layout ${index + 1}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { e.stopPropagation(); setName(config.name); }
        }}
      />
      {isActive && <span className="dash2-layout-badge">Showing</span>}
      <button className="dash2-tool" title="Move earlier" aria-label={`Move ${config.name} earlier`} disabled={index === 0} onClick={() => onMove(config.id, -1)}>
        <i className="ti ti-chevron-up" />
      </button>
      <button className="dash2-tool" title="Move later" aria-label={`Move ${config.name} later`} disabled={index === count - 1} onClick={() => onMove(config.id, 1)}>
        <i className="ti ti-chevron-down" />
      </button>
      <button className="dash2-tool" title="Delete this saved layout" aria-label={`Delete ${config.name}`} onClick={() => onDelete(config.id)}>
        <i className="ti ti-trash" />
      </button>
    </li>
  );
}

export default function DashboardLayouts({ configs, active, onClose, onSaveAs, onRename, onMove, onDelete }) {
  const [draft, setDraft] = useState('');
  const full = configs.length >= MAX_CONFIGS;
  const clean = cleanConfigName(draft);
  const taken = configs.some((c) => c.name.toLowerCase() === clean.toLowerCase());
  const activeName = configs.find((c) => c.id === active)?.name;

  const save = (e) => {
    e.preventDefault();
    if (!clean || full || taken) return;
    if (onSaveAs(clean)) setDraft('');
  };

  return (
    <Modal title="Saved layouts" onClose={onClose} className="dash2-layouts-modal">
      <form className="field" onSubmit={save}>
        <label className="field-label" htmlFor="dash2-layout-name">Save the current layout as</label>
        <div className="dash2-layout-new">
          <input
            id="dash2-layout-name"
            className="input"
            placeholder="e.g. Deep work, Morning, Weekly review"
            value={draft}
            maxLength={CONFIG_NAME_MAX}
            onChange={(e) => setDraft(e.target.value)}
            disabled={full}
            autoFocus
          />
          <button className="btn btn--sm btn--accent" type="submit" disabled={!clean || full || taken}>
            <i className="ti ti-device-floppy" /> Save
          </button>
        </div>
        <p className="dash2-panel-note" role="status">
          {full
            ? `You have ${MAX_CONFIGS} saved layouts, the most allowed. Delete one to save another.`
            : taken
              ? 'A saved layout already has that name.'
              : activeName
                ? `Done saves your changes to “${activeName}”. Saving here makes a new layout and leaves “${activeName}” as it was.`
                : 'Saved layouts appear as buttons next to Capture context, so you can switch with one click.'}
        </p>
      </form>

      {configs.length > 0 && (
        <>
          <div className="section-label" style={{ margin: '6px 0' }}>Your layouts</div>
          <ul className="dash2-layout-list">
            {configs.map((c, i) => (
              <LayoutRow
                key={c.id}
                config={c}
                index={i}
                count={configs.length}
                isActive={c.id === active}
                onRename={onRename}
                onMove={onMove}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
