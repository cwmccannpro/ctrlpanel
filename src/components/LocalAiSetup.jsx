import { useState } from 'react';
import Modal from './shared/Modal.jsx';
import { authApi } from '../lib/api.js';
import { formatDate } from '../lib/helpers.js';

// Settings → Nutrition: pair this account with the desktop model bridge
// (tools/local-ai-install.ps1). The key is shown once; only its hash is stored.
export default function LocalAiSetup({ local, claudeReady, refresh }) {
  const [credential, setCredential] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = async (action) => {
    setBusy(true); setError('');
    try { const result = await authApi.post(`/nutrition/local/${action}`, {}); setCredential(result.credential || ''); setConfirm(''); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const state = !local ? 'Checking desktop model…' : local.unavailable ? 'Desktop model storage isn’t set up yet (apply migrations/20261121-local-ai.sql).' :
    !local.paired ? 'Not connected' : local.online ? `Ready on your computer · ${local.model}` :
    local.last_seen ? `Desktop offline or model not loaded · last seen ${formatDate(local.last_seen)}` : 'Key created · waiting for the desktop bridge';
  const fallback = claudeReady ? 'Claude is used whenever the desktop is off, busy or can’t read the meal.' : 'With no Anthropic key, meals can only be estimated while the desktop is on.';

  return <div className="nutrition-setup-section">
    <div className="nutrition-setup-heading"><i className="ti ti-device-desktop" aria-hidden="true" /><h3>Run estimates on your computer</h3></div>
    <p className="body-text">When your Windows PC is on with Ollama running, meal estimates run there for free. {fallback}</p>
    <div className="nutrition-actions">
      <span className={`list-row-meta${local?.online ? ' text-green' : ''}`} role="status">{state}</span>
      <button className="btn btn--sm" onClick={refresh} disabled={busy}><i className="ti ti-refresh" aria-hidden="true" /> Recheck</button>
    </div>
    <div className="nutrition-actions">
      <button className="btn" disabled={busy || local?.unavailable} onClick={() => local?.paired ? setConfirm('pair') : change('pair')}><i className="ti ti-key" aria-hidden="true" />{local?.paired ? 'Replace desktop key' : 'Create desktop key'}</button>
      {local?.paired && <button className="btn btn--ghost" disabled={busy} onClick={() => setConfirm('revoke')}>Disconnect desktop</button>}
    </div>
    <details className="nutrition-copy-details"><summary>Desktop setup</summary>
      <ol className="nutrition-steps">
        <li><strong>Install Ollama and a vision model</strong><p className="list-row-meta">From ollama.com, then run <code>ollama pull qwen2.5vl:7b</code> (about 6 GB; fits an 8 GB GPU).</p></li>
        <li><strong>Create a desktop key above</strong><p className="list-row-meta">It can only receive your meal estimates and send results back. It can’t read or change anything else.</p></li>
        <li><strong>Run the installer from the CTRLpanel folder</strong><p className="list-row-meta"><code>powershell -File tools/local-ai-install.ps1</code> and paste the key at the hidden prompt. The bridge starts when you sign in to Windows.</p></li>
      </ol>
      <p className="list-row-meta">The bridge only makes outbound requests; no port is opened on your computer. Photos are passed to the model in memory and aren’t saved. Local estimates are rougher than Claude’s, especially micronutrients.</p>
    </details>
    {error && <p className="body-text text-red" role="alert">{error}</p>}
    {confirm && <Modal title={confirm === 'pair' ? 'Replace desktop key?' : 'Disconnect desktop?'} onClose={() => !busy && setConfirm('')}
      footer={<><button className="btn btn--ghost" onClick={() => setConfirm('')} disabled={busy}>Cancel</button><button className={`btn ${confirm === 'pair' ? 'btn--accent' : 'btn--danger'}`} onClick={() => change(confirm)} disabled={busy}>{busy ? 'Working…' : confirm === 'pair' ? 'Replace key' : 'Disconnect'}</button></>}>
      <p className="body-text">{confirm === 'pair' ? 'The current desktop stops receiving meals until you reinstall it with the new key.' : 'Meal estimates will go to Claude only until you connect a desktop again.'}</p>
    </Modal>}
    {credential && <Modal title="Desktop key created" onClose={() => setCredential('')} footer={<button className="btn btn--accent" onClick={() => setCredential('')}>Done</button>}>
      <p className="body-text">Paste this into the installer’s hidden prompt. It’s shown once; only its hash is stored.</p>
      <label className="sr-only" htmlFor="local-ai-key">Desktop model key</label>
      <input id="local-ai-key" className="input nutrition-code" readOnly value={credential} onFocus={(e) => e.target.select()} />
    </Modal>}
  </div>;
}
