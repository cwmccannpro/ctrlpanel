import { useState } from 'react';

const EMPTY = { title: '', url: '', type: 'link' };

function resourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* The form reports invalid URLs. */ }
  return '';
}

export default function ProjectResources({ project, patch }) {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entries = project.files || [];

  async function save(next) {
    setBusy(true);
    setError('');
    try {
      await patch({ files: next });
      return true;
    } catch (reason) {
      setError(reason.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event) {
    event.preventDefault();
    const url = resourceUrl(draft.url.trim());
    if (!url) {
      setError('Enter a URL starting with http:// or https://.');
      return;
    }
    if (!draft.title.trim()) return;
    if (await save([...entries, { ...draft, title: draft.title.trim(), url, added_at: new Date().toISOString() }])) setDraft(EMPTY);
  }

  return <details className="project-resources">
    <summary><i className="ti ti-paperclip" /> References{entries.length > 0 && <span>{entries.length}</span>}</summary>
    <form className="project-resources-form" onSubmit={add}>
      <input className="input" aria-label="Reference name" placeholder="Name" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <input className="input" type="url" aria-label="Reference URL" placeholder="https://…" required value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
      <select className="select" aria-label="Reference type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="link">Link</option><option value="file">File</option></select>
      <button className="btn" disabled={busy}><i className="ti ti-plus" /> Add reference</button>
    </form>
    {error && <p className="project-error" role="alert">{error}</p>}
    {entries.map((entry, index) => {
      const url = resourceUrl(entry.url);
      return <div className="list-row" key={`${entry.added_at || entry.url}:${index}`}>
        <i className={`ti ${entry.type === 'file' ? 'ti-file' : 'ti-link'}`} />
        {url ? <a className="list-row-title" href={url} target="_blank" rel="noreferrer">{entry.title}</a>
          : <span className="list-row-title">{entry.title}</span>}
        <button className="btn btn--ghost btn--icon" type="button" aria-label={`Remove ${entry.title}`} disabled={busy} onClick={() => save(entries.filter((_, i) => i !== index))}><i className="ti ti-x" /></button>
      </div>;
    })}
  </details>;
}
