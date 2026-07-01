import { useState, useEffect, useRef } from 'react';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import { saveUserSettings, saveProfile } from '../lib/supabase.js';
import { ACCENT_OPTIONS, getSavedAccent, saveAccent, FONT_SIZES } from '../lib/helpers.js';

function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-scale', FONT_SIZES[size] || '16px');
}

// Built-in connectors the user can enable + configure.
const KNOWN_CONNECTORS = [
  { type: 'anthropic', name: 'Anthropic (Claude AI)', icon: 'ti-sparkles', fields: [{ key: 'key', label: 'API Key', type: 'password', placeholder: 'sk-ant-…' }] },
  { type: 'alpha_vantage', name: 'Stock Prices (Alpha Vantage)', icon: 'ti-chart-line', fields: [{ key: 'key', label: 'API Key', type: 'password' }] },
  { type: 'google_calendar', name: 'Google Calendar', icon: 'ti-calendar', fields: [{ key: 'url', label: 'Webhook / OAuth URL', type: 'text', placeholder: 'configured on backend' }] },
];

let tmpId = 0;

export default function Settings() {
  const { user, profile, displayName, settings, connectors, refreshSettings } = useAuth();

  const [name, setName] = useState('');
  const [accent, setAccent] = useState(getSavedAccent());
  const [font, setFont] = useState('Medium');
  const [sidebar, setSidebar] = useState(localStorage.getItem('ctrlpanel-sidebar') || 'full');
  const [conns, setConns] = useState([]);
  const [addCustom, setAddCustom] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const fileRef = useRef(null);

  // Sync local state from the loaded profile/settings
  useEffect(() => {
    setName(profile?.full_name || displayName || '');
  }, [profile, displayName]);

  useEffect(() => {
    if (settings?.accent_color) setAccent(settings.accent_color);
    if (settings?.font_size) setFont(settings.font_size);
    // Merge saved connectors with the known built-ins for display
    const list = [...(connectors || [])];
    KNOWN_CONNECTORS.forEach((k) => {
      if (!list.find((c) => c.type === k.type)) list.push({ id: k.type, type: k.type, name: k.name, enabled: false, config: {} });
    });
    setConns(list);
  }, [settings, connectors]);

  const flash = (msg) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 3000);
  };

  const persistSettings = async (patch) => {
    if (user?.id) {
      await saveUserSettings(user.id, patch);
      refreshSettings();
    }
  };

  const persistConnectors = async (next) => {
    setConns(next);
    await persistSettings({ connectors: next });
  };

  const saveName = async () => {
    if (user?.id) {
      await saveProfile(user.id, { full_name: name });
      flash('Profile saved.');
    }
  };

  const pickAccent = (hex) => {
    setAccent(hex);
    saveAccent(hex);
    persistSettings({ accent_color: hex });
  };

  const pickFont = (size) => {
    setFont(size);
    localStorage.setItem('ctrlpanel-font', size);
    applyFontSize(size);
    persistSettings({ font_size: size });
  };

  const setSidebarMode = (mode) => {
    setSidebar(mode);
    localStorage.setItem('ctrlpanel-sidebar', mode);
    persistSettings({ sidebar_collapsed: mode === 'collapsed' });
    window.location.reload();
  };

  const toggleConnector = (id) =>
    persistConnectors(conns.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));

  const setConnectorField = (id, key, value) =>
    setConns((prev) => prev.map((c) => (c.id === id ? { ...c, config: { ...c.config, [key]: value } } : c)));

  const removeConnector = (id) => persistConnectors(conns.filter((c) => c.id !== id));

  const saveCustom = () => {
    if (!addCustom.name?.trim()) return;
    const c = { id: `c-${Date.now()}-${tmpId++}`, type: 'custom', name: addCustom.name, enabled: true, config: { key: addCustom.key || '', url: addCustom.url || '' } };
    persistConnectors([...conns, c]);
    setAddCustom(null);
  };

  const exportData = () => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('ctrlpanel-')) data[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ctrlpanel-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
        window.location.reload();
      } catch {
        alert('Invalid data file.');
      }
    };
    reader.readAsText(file);
  };

  const resetLocal = () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ctrlpanel-'))
      .forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  const knownMeta = (type) => KNOWN_CONNECTORS.find((k) => k.type === type);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-header-sub">Personalize your CTRLpanel</div>
        </div>
      </div>

      {/* Profile */}
      <Card className="card-section" static>
        <div className="card-section-title">Profile</div>
        <div className="field">
          <label className="field-label">Display name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
        </div>
        <div className="field">
          <label className="field-label">Email</label>
          <input className="input" value={user?.email || ''} disabled />
        </div>
      </Card>

      {/* Color scheme */}
      <Card className="card-section" static>
        <div className="card-section-title">Color Scheme</div>
        <div className="swatch-grid">
          {ACCENT_OPTIONS.map((c) => (
            <div key={c.value} className={`swatch ${accent === c.value ? 'active' : ''}`} style={{ background: c.value }} onClick={() => pickAccent(c.value)}>
              {accent === c.value && <i className="ti ti-check" />}
              {c.name}
            </div>
          ))}
        </div>
      </Card>

      {/* Display */}
      <Card className="card-section" static>
        <div className="card-section-title">Display</div>
        <div className="spread" style={{ marginBottom: 12 }}>
          <span className="body-text">Sidebar</span>
          <div className="segmented">
            <button className={sidebar === 'full' ? 'active' : ''} onClick={() => setSidebarMode('full')}>Full</button>
            <button className={sidebar === 'collapsed' ? 'active' : ''} onClick={() => setSidebarMode('collapsed')}>Collapsed</button>
          </div>
        </div>
        <div className="spread">
          <span className="body-text">Font size</span>
          <div className="segmented">
            {Object.keys(FONT_SIZES).map((s) => (
              <button key={s} className={font === s ? 'active' : ''} onClick={() => pickFont(s)}>{s}</button>
            ))}
          </div>
        </div>
      </Card>

      {/* Connectors */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Connectors</span>
          <button className="btn btn--sm" onClick={() => setAddCustom({})}>
            <i className="ti ti-plus" /> Add custom
          </button>
        </div>
        <p className="body-text" style={{ marginBottom: 12 }}>
          Attach the integrations you want. Keys are saved to your account and used only for your data.
        </p>

        {conns.map((c) => {
          const meta = knownMeta(c.type);
          const fields = meta?.fields || [{ key: 'url', label: 'URL', type: 'text' }, { key: 'key', label: 'Key / Token', type: 'password' }];
          return (
            <div key={c.id} className="connector">
              <div className="spread">
                <div className="row">
                  <i className={`ti ${meta?.icon || 'ti-plug'}`} style={{ color: 'var(--accent)' }} />
                  <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{c.name}</span>
                </div>
                <div className="row">
                  <div className={`switch ${c.enabled ? 'on' : ''}`} onClick={() => toggleConnector(c.id)} />
                  {c.type === 'custom' && (
                    <button className="btn btn--ghost btn--icon" onClick={() => removeConnector(c.id)} title="Remove">
                      <i className="ti ti-trash" />
                    </button>
                  )}
                </div>
              </div>
              {c.enabled && (
                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  {fields.map((f) => (
                    <div className="field" key={f.key} style={{ marginBottom: 0 }}>
                      <label className="field-label">{f.label}</label>
                      <input
                        className="input"
                        type={f.type}
                        placeholder={f.placeholder}
                        value={c.config?.[f.key] || ''}
                        onChange={(e) => setConnectorField(c.id, f.key, e.target.value)}
                        onBlur={() => persistConnectors(conns)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Data */}
      <Card className="card-section" static>
        <div className="card-section-title">Data</div>
        <div className="row gap-16" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportData}><i className="ti ti-download" /> Export Local Prefs</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><i className="ti ti-upload" /> Import</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={importData} />
          <button className="btn btn--danger" onClick={() => setResetOpen(true)} style={{ marginLeft: 'auto' }}>
            <i className="ti ti-alert-triangle" /> Reset Local Prefs
          </button>
        </div>
      </Card>

      {saved && <p className="list-row-meta text-green">{saved}</p>}

      {addCustom && (
        <Modal
          title="Add Custom Connector"
          onClose={() => setAddCustom(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAddCustom(null)}>Cancel</button><button className="btn btn--accent" onClick={saveCustom}>Add</button></>}
        >
          <div className="field"><label className="field-label">Name</label><input className="input" value={addCustom.name || ''} onChange={(e) => setAddCustom({ ...addCustom, name: e.target.value })} placeholder="e.g. Slack webhook" autoFocus /></div>
          <div className="field"><label className="field-label">URL (optional)</label><input className="input" value={addCustom.url || ''} onChange={(e) => setAddCustom({ ...addCustom, url: e.target.value })} placeholder="https://…" /></div>
          <div className="field"><label className="field-label">Key / Token (optional)</label><input className="input" type="password" value={addCustom.key || ''} onChange={(e) => setAddCustom({ ...addCustom, key: e.target.value })} /></div>
        </Modal>
      )}

      {resetOpen && (
        <Modal
          title="Reset Local Preferences?"
          onClose={() => setResetOpen(false)}
          footer={<><button className="btn btn--ghost" onClick={() => setResetOpen(false)}>Cancel</button><button className="btn btn--danger" onClick={resetLocal}>Reset</button></>}
        >
          <p className="body-text">This clears local display preferences in this browser. Your account data in Supabase is not affected.</p>
        </Modal>
      )}
    </div>
  );
}
