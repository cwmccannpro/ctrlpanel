import { useState, useEffect, useRef } from 'react';
import Card from '../components/shared/Card.jsx';
import Modal from '../components/shared/Modal.jsx';
import { useAuth } from '../components/AuthProvider.jsx';
import SharingCenter from '../components/SharingCenter.jsx';
import { saveUserSettings, saveProfile } from '../lib/supabase.js';
import { useCrud } from '../lib/useData.js';
import { ACCENT_OPTIONS, getSavedAccent, saveAccent, FONT_SIZES, formatDate } from '../lib/helpers.js';

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
  const [lifeWidget, setLifeWidget] = useState(
    localStorage.getItem('ctrlpanel-life-widget') === 'true'
  );
  const [addCustom, setAddCustom] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const fileRef = useRef(null);

  // Nutrition API keys — external clients (e.g. a custom GPT) log meals with
  // these. Only a SHA-256 hash is stored; the plaintext shows once on create.
  const apiKeys = useCrud('api_keys', 'created_at');
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState(null); // plaintext, shown once
  const [keyBusy, setKeyBusy] = useState(false);

  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const generateApiKey = async () => {
    setKeyBusy(true);
    try {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const raw = `ctp_${hex(bytes.buffer)}`;
      const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
      await apiKeys.add({ name: keyName.trim() || 'API key', key_prefix: raw.slice(0, 12), key_hash: hash });
      setNewKey(raw);
      setKeyName('');
    } finally {
      setKeyBusy(false);
    }
  };

  const copyNewKey = () => {
    navigator.clipboard?.writeText(newKey).then(() => flash('Key copied to clipboard.'));
  };

  // Sync local state from the loaded profile/settings
  useEffect(() => {
    setName(profile?.full_name || displayName || '');
  }, [profile, displayName]);

  useEffect(() => {
    if (settings?.accent_color) setAccent(settings.accent_color);
    if (settings?.font_size) setFont(settings.font_size);
    if (typeof settings?.show_life_widget === 'boolean') setLifeWidget(settings.show_life_widget);
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

  const toggleLifeWidget = () => {
    const next = !lifeWidget;
    setLifeWidget(next);
    localStorage.setItem('ctrlpanel-life-widget', String(next));
    persistSettings({ show_life_widget: next });
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
        <div className="spread" style={{ marginBottom: 12 }}>
          <span className="body-text">Font size</span>
          <div className="segmented">
            {Object.keys(FONT_SIZES).map((s) => (
              <button key={s} className={font === s ? 'active' : ''} onClick={() => pickFont(s)}>{s}</button>
            ))}
          </div>
        </div>
        <p className="list-row-meta" style={{ marginTop: 12 }}>
          Dashboard widgets (Life View, Habits, finances, and more) are managed on the Dashboard via <strong>Add Widget</strong>.
        </p>
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

      {/* Sharing & Friends — invite people to sections of your CTRLpanel */}
      <SharingCenter />

      {/* Nutrition API */}
      <Card className="card-section" static>
        <div className="card-section-title">Nutrition API</div>
        <p className="body-text" style={{ marginBottom: 12 }}>
          Let an external client (like a custom GPT) log meals for you. Send a POST to{' '}
          <code style={{ color: 'var(--text-primary)' }}>{window.location.origin}/api/nutrition/log</code>{' '}
          with header <code style={{ color: 'var(--text-primary)' }}>Authorization: Bearer &lt;key&gt;</code> and JSON body{' '}
          <code style={{ color: 'var(--text-primary)' }}>
            {'{ food_name, calories, protein, carbs, fat, notes?, timestamp?, image_url? }'}
          </code>
          . Entries appear in your Nutrition log and count toward daily goals.
        </p>

        <div className="row" style={{ gap: 8, marginBottom: apiKeys.rows.length ? 12 : 0 }}>
          <input
            className="input"
            placeholder="Key name (e.g. Custom GPT)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <button className="btn btn--accent" onClick={generateApiKey} disabled={keyBusy}>
            <i className="ti ti-key" /> Generate key
          </button>
        </div>

        {apiKeys.rows.map((k) => (
          <div className="list-row" key={k.id}>
            <i className="ti ti-key" />
            <span className="list-row-title">{k.name}</span>
            <span className="list-row-meta">{k.key_prefix}…</span>
            <span className="list-row-meta">
              created {formatDate(k.created_at)}{k.last_used_at ? ` · last used ${formatDate(k.last_used_at)}` : ' · never used'}
            </span>
            <button
              className="btn btn--ghost btn--icon"
              title="Revoke key"
              onClick={() => confirm(`Revoke "${k.name}"? Clients using it stop working immediately.`) && apiKeys.remove(k.id)}
            >
              <i className="ti ti-trash" />
            </button>
          </div>
        ))}
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

      {newKey && (
        <Modal
          title="API key created"
          onClose={() => setNewKey(null)}
          footer={
            <>
              <button className="btn" onClick={copyNewKey}><i className="ti ti-copy" /> Copy key</button>
              <button className="btn btn--accent" onClick={() => setNewKey(null)}>Done</button>
            </>
          }
        >
          <p className="body-text" style={{ marginBottom: 12 }}>
            Copy this key now — for security only a hash is stored, so it <strong>won't be shown again</strong>.
          </p>
          <div
            className="input"
            style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', height: 'auto', padding: 10, userSelect: 'all' }}
          >
            {newKey}
          </div>
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
