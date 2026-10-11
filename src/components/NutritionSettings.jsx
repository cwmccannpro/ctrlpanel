import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from './shared/Card.jsx';
import Modal from './shared/Modal.jsx';
import { useAuth } from './AuthProvider.jsx';
import { useToast } from './Toaster.jsx';
import { authApi } from '../lib/api.js';
import { useNutritionRows } from '../lib/useNutritionRows.js';
import { createNutritionKey, revokeNutritionKey, checkNutritionKey } from '../lib/nutritionClient.js';
import { nutritionTimeZone } from '../lib/nutrition.js';
import { nutritionOpenApi, publicNutritionOrigin, NUTRITION_GPT_INSTRUCTIONS } from '../lib/nutritionIntegration.js';
import { formatDate } from '../lib/helpers.js';
import { copyNutritionText } from '../lib/nutritionClipboard.js';
import '../styles/nutrition.css';

export default function NutritionSettings() {
  const { settings, updateUiPreferences } = useAuth();
  const toast = useToast();
  const keys = useNutritionRows('api_keys', 'id,name,key_prefix,created_at,last_used_at', 'created_at');
  const section = useRef(null);
  const setupText = useRef(null);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [form, setForm] = useState({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, publicOrigin: window.location.protocol === 'https:' ? window.location.origin : '' });
  const [keyName, setKeyName] = useState('Nutrition GPT');
  const [newKey, setNewKey] = useState('');
  const [testKey, setTestKey] = useState('');
  const [testResult, setTestResult] = useState('');
  const [revoke, setRevoke] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setStatusError('');
    try { setStatus(await authApi.get('/nutrition/status')); }
    catch (e) { setStatusError(e.message); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const prefs = settings?.ui_preferences?.nutrition;
    if (prefs) setForm((prev) => ({ ...prev, ...prefs }));
  }, [settings?.ui_preferences?.nutrition]);
  useEffect(() => { if (window.location.hash === '#nutrition') section.current?.scrollIntoView({ block: 'start' }); }, []);

  let schema = '';
  let origin = '';
  try { origin = publicNutritionOrigin(form.publicOrigin); schema = JSON.stringify(nutritionOpenApi(origin), null, 2); } catch { /* prompt for a deployed origin */ }
  const setField = (key, value) => { setForm((prev) => ({ ...prev, [key]: value })); setError(''); };
  const copy = async (text, label) => {
    setError('');
    try { await copyNutritionText(text); toast(`${label} copied`); }
    catch (e) {
      setError(e.message);
      if (label !== 'Key' && setupText.current) { setupText.current.open = true; setupText.current.scrollIntoView({ block: 'center' }); }
    }
  };
  const run = async (action, fn) => {
    if (busy) return;
    setBusy(action); setError('');
    try { await fn(); } catch (e) { setError(e.message || 'Could not complete this step.'); }
    finally { setBusy(''); }
  };
  const save = () => run('preferences', async () => {
    const timeZone = nutritionTimeZone(form.timeZone);
    const publicOrigin = form.publicOrigin.trim() ? publicNutritionOrigin(form.publicOrigin) : '';
    await updateUiPreferences('nutrition', { timeZone, publicOrigin });
    toast('Nutrition settings saved');
    await refresh();
  });
  const generate = () => run('key', async () => {
    // Bind uploads to the timezone displayed here, even if the owner has not
    // separately pressed Save before creating their first nutrition key.
    await updateUiPreferences('nutrition', { timeZone: nutritionTimeZone(form.timeZone), ...(origin ? { publicOrigin: origin } : {}) });
    const raw = await createNutritionKey(keyName);
    setNewKey(raw); setTestResult('');
    await keys.reload();
  });
  const test = (raw) => run('test', async () => {
    setTestResult('');
    const result = await checkNutritionKey(raw);
    setTestResult(`Connected to your nutrition log · ${result.timezone}. No meal was added.`);
    await keys.reload();
  });
  const remove = () => run('revoke', async () => {
    await revokeNutritionKey(revoke.id);
    setRevoke(null); toast('Nutrition key revoked');
    await keys.reload();
  });

  return (
    <Card className="card-section nutrition-settings" static>
      <div id="nutrition" ref={section} className="card-section-title">
        <span>Nutrition</span>
        <Link className="btn btn--sm" to="/health/nutrition"><i className="ti ti-arrow-up-right" aria-hidden="true" /> Open log</Link>
      </div>
      <p className="body-text">Take a photo or describe a meal in CTRLpanel, or use your private nutrition GPT. All save to the same meal log.</p>

      <div className="nutrition-setup-section">
        <div className="nutrition-setup-heading"><i className="ti ti-camera" aria-hidden="true" /><h3>Photo or text logging in the app</h3></div>
        <p className="body-text">Choose Log meal by photo or Describe a meal in Nutrition. We estimate calories and macros automatically; review and save. No nutrition numbers to type.</p>
        <div className="nutrition-actions">
          <Link className="btn btn--accent" to="/health/nutrition?log=photo"><i className="ti ti-camera" aria-hidden="true" /> Log by photo</Link>
          <Link className="btn" to="/health/nutrition?log=text">Describe a meal</Link>
          <span className="list-row-meta">{status?.photoReady ? 'Meal analyzer ready' : status ? 'Enable Anthropic in Connectors above to estimate meals' : 'Checking meal analyzer…'}</span>
        </div>
        <p className="list-row-meta">Analysis uses Claude and usually costs about 0.5–2¢ USD per meal, billed to your Anthropic API key. Each result shows a token-based cost estimate. Photos are sent for analysis; CTRLpanel saves the reviewed numbers and notes.</p>
      </div>

      <div className="nutrition-setup-section">
        <div className="nutrition-setup-heading"><i className="ti ti-clock" aria-hidden="true" /><h3>Meal day</h3></div>
        <div className="field">
          <label className="field-label" htmlFor="nutrition-timezone">Meal timezone</label>
          <input id="nutrition-timezone" className="input" value={form.timeZone} onChange={(e) => setField('timeZone', e.target.value)} list="nutrition-timezones" spellCheck="false" />
          <datalist id="nutrition-timezones">{(Intl.supportedValuesOf?.('timeZone') || ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']).map((zone) => <option value={zone} key={zone} />)}</datalist>
          <p className="list-row-meta">Keeps evening meals on the right day, including uploads from your GPT. Save this before connecting.</p>
        </div>
        <button className="btn" onClick={save} disabled={Boolean(busy)}>{busy === 'preferences' ? 'Saving…' : 'Save nutrition settings'}</button>
      </div>

      <div className="nutrition-setup-section">
        <div className="nutrition-setup-heading"><i className="ti ti-plug-connected" aria-hidden="true" /><h3>Connect your custom GPT</h3></div>
        <div className="nutrition-actions">
          <span className="list-row-meta" role="status">{statusError || status?.message || (status?.ready ? 'Nutrition upload service ready' : 'Checking upload service…')}</span>
          <button className="btn btn--sm" onClick={refresh}><i className="ti ti-refresh" aria-hidden="true" /> Recheck</button>
        </div>
        <ol className="nutrition-steps">
          <li>
            <strong>Use your live CTRLpanel address</strong>
            <label className="sr-only" htmlFor="nutrition-origin">Deployed CTRLpanel address</label>
            <input id="nutrition-origin" className="input" type="url" value={form.publicOrigin} onChange={(e) => setField('publicOrigin', e.target.value)} placeholder="https://ctrlpanel.cwmccann.pro" />
            <p className="list-row-meta">GPT Actions need a public HTTPS address. A localhost address cannot receive ChatGPT uploads.</p>
          </li>
          <li>
            <strong>Create a nutrition key</strong>
            <div className="nutrition-actions">
              <label className="sr-only" htmlFor="nutrition-key-name">Nutrition key name</label>
              <input id="nutrition-key-name" className="input" value={keyName} maxLength={100} onChange={(e) => setKeyName(e.target.value)} placeholder="Nutrition GPT" />
              <button className="btn" onClick={generate} disabled={Boolean(busy) || keys.loading || Boolean(keys.error)}><i className="ti ti-key" aria-hidden="true" />{busy === 'key' ? 'Creating…' : 'Generate key'}</button>
            </div>
            <p className="list-row-meta">In your GPT’s Configure → Actions, set Authentication to API Key → Bearer and paste the key. Keep the GPT private; its key can write meals to your account.</p>
          </li>
          <li>
            <strong>Add the action and instructions</strong>
            <div className="nutrition-actions">
              <button className="btn" onClick={() => copy(schema, 'Action schema')} disabled={!schema}><i className="ti ti-copy" aria-hidden="true" /> Copy action schema</button>
              <button className="btn" onClick={() => copy(NUTRITION_GPT_INSTRUCTIONS, 'GPT instructions')}><i className="ti ti-copy" aria-hidden="true" /> Copy GPT instructions</button>
            </div>
            <p className="list-row-meta">Paste the schema into Actions, then add the instructions to your GPT’s Instructions field and save the GPT.</p>
            <details ref={setupText} className="nutrition-copy-details"><summary>View setup text</summary>
              <label className="field-label" htmlFor="nutrition-schema">Action schema</label><textarea id="nutrition-schema" className="input nutrition-code" readOnly value={schema || 'Enter your live HTTPS address above to generate the schema.'} rows={8} />
              <label className="field-label" htmlFor="nutrition-instructions">GPT instructions</label><textarea id="nutrition-instructions" className="input nutrition-code" readOnly value={NUTRITION_GPT_INSTRUCTIONS} rows={8} />
              {origin && <p className="list-row-meta">You can also import the schema from <a href={`${origin}/api/nutrition/openapi.json`} target="_blank" rel="noreferrer">your schema URL</a> after deployment.</p>}
            </details>
          </li>
          <li><strong>Verify, then send a meal photo</strong><p className="body-text">Use Test beside checkNutritionConnection in the GPT editor. Then send a meal photo with “Log this meal.” The GPT estimates the food and sends the numbers to CTRLpanel. It confirms only after your log accepts the meal.</p></li>
        </ol>
        <p className="list-row-meta"><a href="https://developers.openai.com/api/docs/actions/authentication" target="_blank" rel="noreferrer">GPT Action authentication</a> · <a href="https://developers.openai.com/api/docs/actions/production" target="_blank" rel="noreferrer">Action requirements</a>. ChatGPT may ask you to allow the action the first time.</p>
      </div>

      <div className="nutrition-setup-section">
        <h3>Nutrition keys</h3>
        {keys.loading && <p className="body-text">Loading keys…</p>}
        {keys.error && <p role="alert" className="text-red body-text">Could not load keys: {keys.error}</p>}
        {!keys.loading && !keys.error && !keys.rows.length && <p className="body-text">No nutrition keys yet. Generate one above to connect your GPT.</p>}
        {keys.rows.map((key) => <div className="list-row nutrition-key-row" key={key.id}>
          <i className="ti ti-key" aria-hidden="true" />
          <div><strong>{key.name}</strong><p className="list-row-meta">{key.key_prefix}… · {key.last_used_at ? `Last used ${formatDate(key.last_used_at)}` : 'Never used'}</p></div>
          <button className="btn btn--ghost btn--icon" onClick={() => setRevoke(key)} aria-label={`Revoke ${key.name}`} disabled={Boolean(busy)}><i className="ti ti-trash" aria-hidden="true" /></button>
        </div>)}
        <details className="nutrition-copy-details"><summary>Check an existing key</summary>
          <label className="field-label" htmlFor="nutrition-test-key">Nutrition key</label>
          <div className="nutrition-actions"><input id="nutrition-test-key" className="input" type="password" value={testKey} autoComplete="off" onChange={(e) => { setTestKey(e.target.value); setTestResult(''); }} placeholder="ctp_…" /><button className="btn" onClick={() => test(testKey)} disabled={!testKey.trim() || Boolean(busy)}>{busy === 'test' ? 'Checking…' : 'Check connection'}</button></div>
          <p className="list-row-meta">Checks access without adding a meal.</p>
        </details>
        {testResult && <p className="body-text text-green" role="status">{testResult}</p>}
        {error && <p className="body-text text-red" role="alert">{error}</p>}
      </div>

      {newKey && <Modal title="Nutrition key created" onClose={() => { setNewKey(''); setError(''); }} footer={<button className="btn btn--accent" onClick={() => { setNewKey(''); setError(''); }}>Done</button>}>
        <p className="body-text">Copy this key into your private GPT’s API Key → Bearer authentication. Only its hash is stored, so the full key is shown once.</p>
        <label className="sr-only" htmlFor="nutrition-new-key">New nutrition key</label><input id="nutrition-new-key" className="input nutrition-code" readOnly value={newKey} onFocus={(e) => e.target.select()} />
        <div className="nutrition-actions"><button className="btn" onClick={() => copy(newKey, 'Key')}><i className="ti ti-copy" aria-hidden="true" /> Copy key</button><button className="btn" disabled={Boolean(busy)} onClick={() => test(newKey)}>{busy === 'test' ? 'Checking…' : 'Check connection'}</button></div>
        {testResult && <p className="body-text text-green" role="status">{testResult}</p>}
        {error && <p className="body-text text-red" role="alert">{error}</p>}
      </Modal>}
      {revoke && <Modal title="Revoke nutrition key?" onClose={() => !busy && setRevoke(null)} footer={<><button className="btn btn--ghost" onClick={() => setRevoke(null)} disabled={Boolean(busy)}>Cancel</button><button className="btn btn--danger" onClick={remove} disabled={Boolean(busy)}>{busy === 'revoke' ? 'Revoking…' : 'Revoke key'}</button></>}>
        <p className="body-text">“{revoke.name}” will stop working immediately. Your existing meals stay in the log. Generate a new key to reconnect a client.</p>
        {error && <p className="body-text text-red" role="alert">{error}</p>}
      </Modal>}
    </Card>
  );
}
