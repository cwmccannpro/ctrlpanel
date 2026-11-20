import { resolveNote, wikiLinks } from '../lib/knowledge.js';

export default function NoteConnections({ note, notes, onOpen }) {
  const incoming = notes.filter(n => n.id !== note.id && wikiLinks(n.content).some(key => resolveNote(notes, key)?.id === note.id));
  const outgoing = [...new Set(wikiLinks(note.content))];
  return <footer className="kb-connections">
    <div><strong>Links · {outgoing.length}</strong>{outgoing.map(key => {
      const target = resolveNote(notes, key);
      return <button key={key} className="kb-wikilink" onClick={() => onOpen(key)}>{target?.title || key + ' + create'}</button>;
    })}</div>
    <div><strong>Backlinks · {incoming.length}</strong>{incoming.map(n => <button key={n.id} className="kb-wikilink" onClick={() => onOpen(n.id)}>{n.title}</button>)}</div>
  </footer>;
}

