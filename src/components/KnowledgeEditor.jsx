import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadMarkdown, resolveNote, wikiLinks } from '../lib/knowledge.js';

export default function KnowledgeEditor({ note, notes, projects, onChange, onSave, onDelete, onOpen, saving, dirty }) {
  const [mode, setMode] = useState('split');
  const editor = useRef(null);
  const insert = (before, after = '') => {
    const el = editor.current;
    const start = el?.selectionStart ?? note.content.length;
    const end = el?.selectionEnd ?? start;
    onChange({ content: note.content.slice(0, start) + before + note.content.slice(start, end) + after + note.content.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + before.length, end + before.length); });
  };
  const backlinks = notes.filter(n => n.id !== note.id && wikiLinks(n.content).some(t => resolveNote(notes, t)?.id === note.id));
  const outgoing = [...new Set(wikiLinks(note.content))];
  const markdown = note.content.replace(/\[\[([^\]]+)\]\]/g, (_, value) => {
    const [target, alias] = value.split('|');
    return `[${(alias || target).replace(/[\[\]]/g, '')}](#wiki-${encodeURIComponent(target.split('#')[0])})`;
  });
  return <section className="kb-document" onKeyDown={e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && e.target === editor.current) { e.preventDefault(); insert('**', '**'); }
  }}>
    <div className="kb-document-bar"><span role="status">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'} · Markdown</span><div className="row"><button className="btn btn--sm" onClick={() => downloadMarkdown(note)}>Export .md</button><button className="btn btn--sm btn--accent" disabled={saving || !dirty} onClick={onSave}>Save <kbd>Ctrl S</kbd></button><button className="btn btn--ghost btn--icon" title="Delete note" disabled={saving} onClick={onDelete}><i className="ti ti-trash" /></button></div></div>
    <input className="kb-title" aria-label="Note title" value={note.title} onChange={e => onChange({ title: e.target.value })} placeholder="Untitled note" />
    <div className="kb-properties">
      <label>Folder<input className="input" placeholder="e.g. Research/Ideas" value={note.folder} onChange={e => onChange({ folder: e.target.value })} /></label>
      <label>Project<select className="input" value={note.project_id || ''} onChange={e => onChange({ project_id: e.target.value || null })}><option value="">Personal knowledge</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Tags<input className="input" placeholder="context, research" value={note.tags.join(',')} onChange={e => onChange({ tags: e.target.value.split(',') })} /></label>
      <button className={`btn btn--sm ${note.pinned ? 'btn--accent' : ''}`} aria-pressed={note.pinned} onClick={() => onChange({ pinned: !note.pinned })}><i className="ti ti-pin" /> Pin</button>
    </div>
    <div className="kb-format"><div className="row">{[['Heading', '## '], ['Bold', '**', '**'], ['Italic', '*', '*'], ['Task', '- [ ] '], ['Code', '\n```\n', '\n```\n'], ['Link', '[[', ']]'], ['Table', '\n| Column | Value |\n| --- | --- |\n|  |  |\n']].map(([label, before, after]) => <button key={label} className="btn btn--ghost btn--sm" disabled={mode === 'read'} onClick={() => insert(before, after)}>{label}</button>)}</div><div className="segmented">{['write', 'split', 'read'].map(m => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{m}</button>)}</div></div>
    <div className={`kb-editor kb-editor--${mode}`}>
      {mode !== 'read' && <textarea ref={editor} aria-label="Markdown editor" spellCheck={false} value={note.content} onChange={e => onChange({ content: e.target.value })} onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); insert('  '); } }} placeholder={'Capture context, decisions, and ideas here.\n\nConnect your thinking with [[Note title]].'} />}
      {mode !== 'write' && <article className="kb-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => href?.startsWith('#wiki-') ? <button className="kb-wikilink" onClick={() => onOpen(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{markdown}</ReactMarkdown>{!note.content && <p className="body-text">Your formatted note appears here.</p>}</article>}
    </div>
    <footer className="kb-connections"><span>{note.content.trim().split(/\s+/).filter(Boolean).length} words</span><div><strong>Links · {outgoing.length}</strong>{outgoing.map(t => <button className="kb-wikilink" key={t} onClick={() => onOpen(t)}>{t}{!resolveNote(notes, t) && ' + create'}</button>)}</div><div><strong>Backlinks · {backlinks.length}</strong>{backlinks.map(n => <button className="kb-wikilink" key={n.id} onClick={() => onOpen(n.id)}>{n.title}</button>)}</div></footer>
  </section>;
}
