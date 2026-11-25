import { useState } from 'react';

export default function ProjectCharter({ value, onSave }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const charter = draft || value || {};
  const metrics = charter.metrics || [];

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      setDraft(null);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return <>
    {charter.objective && <p className="project-objective">{charter.objective}</p>}
    {charter.summary && <p className="body-text project-charter-summary">{charter.summary}</p>}
    {metrics.length > 0 && <dl className="project-widget-list">{metrics.map((metric, index) => (
      <div key={index}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
    ))}</dl>}
    {!charter.objective && !charter.summary && !metrics.length && <p className="project-widget-empty">No charter yet.</p>}
    <button className="btn btn--ghost btn--sm" onClick={() => setDraft(charter)}><i className="ti ti-pencil" /> Edit charter</button>
  </>;

  return <form className="project-charter-form" onSubmit={save}>
    <label className="field"><span className="field-label">Current objective</span><input className="input" value={draft.objective || ''} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} /></label>
    <label className="field"><span className="field-label">Summary</span><textarea className="textarea" value={draft.summary || ''} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
    {metrics.map((metric, index) => <div className="project-charter-metric" key={index}>
      {['label', 'value'].map((field) => <input key={field} className="input" aria-label={`Metric ${index + 1} ${field}`} placeholder={field === 'label' ? 'Metric' : 'Value'} value={metric[field] || ''}
        onChange={(event) => setDraft({ ...draft, metrics: metrics.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item) })} />)}
      <button className="btn btn--ghost btn--icon" type="button" aria-label={`Remove metric ${index + 1}`} onClick={() => setDraft({ ...draft, metrics: metrics.filter((_, i) => i !== index) })}><i className="ti ti-x" /></button>
    </div>)}
    {error && <p className="project-error" role="alert">{error}</p>}
    <div className="project-charter-actions">
      <button className="btn btn--ghost btn--sm" type="button" onClick={() => setDraft({ ...draft, metrics: [...metrics, { label: '', value: '' }] })}><i className="ti ti-plus" /> Add metric</button>
      <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => { setError(''); setDraft(null); }}>Cancel</button>
      <button className="btn btn--accent btn--sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </form>;
}
