import { useRef, useState } from 'react';
import { downloadMarkdown } from '../lib/knowledge.js';
import ContextWriter from './ContextWriter.jsx';

import NoteConnections from './ContextConnections.jsx';

const tools = [
  ['Heading', 'ti-heading', '## '], ['Bold', 'ti-bold', '**', '**'], ['Italic', 'ti-italic', '*', '*'],
  ['Task', 'ti-checkbox', '- [ ] '], ['Code block', 'ti-code', '\n```\n','\n```\n'],
  ['Note link', 'ti-link', '[[', ']]'], ['Table', 'ti-table', '\n| Column | Value |\n| --- | --- |\n|  |  |\n']
];
export default function KnowledgeEditor({ note, notes, projects, onChange, onSave, onDelete, onOpen, onBack, saving, dirty }) {
  const [raw, setRaw] = useState(false);
  const editor = useRef(null);
  return <section className="kb-document ctx-document" onKeyDown={e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); }
      if (e.key.toLowerCase() === 'b' && e.target.closest('.cm-editor')) { e.preventDefault(); editor.current?.wrap('**', '**'); }
    }
  }}>
    <div className="ctx-doc-bar"><button className="btn btn--ghost btn--sm" onClick={onBack} disabled={saving}><i className="ti ti-arrow-left" /> Network</button>
      <span role="status">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
      <button className="btn btn--sm" onClick={onSave} disabled={saving || !dirty}>Save</button></div>
    <input className="kb-title" aria-label="Note title" value={note.title} onChange={e => onChange({ title: e.target.value })} placeholder="Untitled note" />
    <details className="ctx-properties"><summary>Note details</summary><div className="kb-properties">
      <label>Folder<input className="input" placeholder="Research/Ideas" value={note.folder} onChange={e => onChange({ folder: e.target.value })} /></label>
      <label>Project<select className="input" value={note.project_id || ''} onChange={e => onChange({ project_id: e.target.value || null })}><option value="">Personal</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Tags<input className="input" value={note.tags.join(',')} onChange={e => onChange({ tags: e.target.value.split(',') })} /></label>
      <button className="btn btn--sm" aria-pressed={note.pinned} onClick={() => onChange({ pinned: !note.pinned })}><i className="ti ti-pin" />{note.pinned ? 'Pinned' : 'Pin'}</button>
      <button className="btn btn--sm" onClick={() => downloadMarkdown(note)}>Export .md</button>
      <button className="btn btn--sm" disabled={saving} onClick={onDelete}>Delete note</button>
    </div></details>
    <div className="ctx-format"><div>{tools.map(([label, icon, before, after]) => <button key={label} title={label} aria-label={label} onMouseDown={e => e.preventDefault()} onClick={() => editor.current?.wrap(before, after)}><i className={'ti ' + icon} /></button>)}</div>
      <button className="ctx-source" aria-pressed={raw} onClick={() => setRaw(!raw)}><i className="ti ti-source-code" /> Source</button></div>
    <ContextWriter editorRef={editor} content={note.content} notes={notes} raw={raw} onChange={content => onChange({ content })} onOpen={onOpen} />
    <NoteConnections note={note} notes={notes} onOpen={onOpen} />
  </section>;
}
