import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadNotes } from '../lib/knowledge.js';

export default function KnowledgePanel() {
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState('Loading context…');
  useEffect(() => {
    let active = true;
    loadNotes().then(rows => { if (active) { setNotes(rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)).slice(0, 5)); setStatus('No notes yet. Capture your first piece of context.'); } })
      .catch(() => { if (active) setStatus('Couldn’t load Context notes.'); });
    return () => { active = false; };
  }, []);
  return <><Link to="/context" className="dash2-panel-title dash2-link">Context <i className="ti ti-arrow-up-right" /></Link>{notes.length ? notes.map(n => <Link key={n.id} className="list-row" to={`/context?note=${n.id}`}><i className={`ti ${n.pinned ? 'ti-pin' : 'ti-file-text'}`} /><span className="list-row-title">{n.title}</span><span className="list-row-meta">{n.folder || 'Note'}</span></Link>) : <p className="body-text">{status}</p>}<Link to="/context" className="btn btn--sm" style={{ marginTop: 12 }}>Open library</Link></>;
}
