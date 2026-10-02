import { useEffect, useMemo, useState, useRef } from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import KnowledgeGraph from '../components/KnowledgeGraph.jsx';
import KnowledgeEditor from '../components/KnowledgeEditor.jsx';
import { deleteNote, loadNotes, resolveNote, saveNote, subscribeKnowledge } from '../lib/knowledge.js';
import '../styles/knowledge.css';
import { useAuth } from '../components/AuthProvider.jsx';
import KnowledgeSync from '../components/KnowledgeSync.jsx';

export default function KnowledgeBase({ projectId = null, onDirtyChange }) {
  const { projects } = useWorkspace();
  const { user } = useAuth();
  const [syncOpen, setSyncOpen] = useState(false);
  const [tabKey] = useState(() => {
    try { const key=sessionStorage.getItem('ctrlpanel-draft-tab') || crypto.randomUUID(); sessionStorage.setItem('ctrlpanel-draft-tab',key); return key; }
    catch { return 'default'; }
  });
  const latest = useRef({});
  const savingRef = useRef(false);
  const mutationVersion = useRef(0);
  const draftKey = `ctrlpanel-context-draft:${user?.id}:${projectId || "all"}:${tabKey}`;
  const [params, setParams] = useSearchParams();
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [original, setOriginal] = useState(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState(projectId ? 'graph' : 'notes');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original);
  latest.current = { draft, original, dirty, saving };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || saving) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => { onDirtyChange?.(dirty || saving); return () => onDirtyChange?.(false); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (!saving && window.confirm('Discard unsaved changes and leave this note?')) blocker.proceed();
    else blocker.reset();
  }, [blocker, saving]);
  useEffect(() => {
    let active = true, running = false;
    try { const pending = JSON.parse(localStorage.getItem(draftKey)); if (pending?.draft) { setDraft(pending.draft); setOriginal(pending.original); latest.current = { ...latest.current, dirty: true }; } } catch {}
    const refresh = async () => {
      if (running) return;
      running = true;
      const version = mutationVersion.current;
      try {
        const rows = await loadNotes();
        if (!active || version !== mutationVersion.current) return;
        setNotes(rows);
        const current = latest.current;
        if (!current.dirty && !current.saving && !savingRef.current) {
          const selected = rows.find(n => n.id === (current.draft?.id || params.get('note')));
          if (selected) { setDraft(selected); setOriginal(selected); }
          else if(current.draft?.id) { setDraft(null); setOriginal(null); }
        }
      } catch(e) { if(active) setError(e.message); }
      finally { running = false; if(active) setLoading(false); }
    };
    refresh();
    const unsubscribe = subscribeKnowledge(user?.id, refresh);
    const timer = setInterval(refresh, 20000);
    const reconnect = () => { setError(value => /fetch|network|offline/i.test(value) ? '' : value); refresh(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', reconnect);
    return () => { active=false; clearInterval(timer); unsubscribe(); window.removeEventListener('focus', refresh); window.removeEventListener('online', reconnect); };
  }, [user?.id, projectId]);
  useEffect(() => {
    if (loading) return;
    try { if(dirty) localStorage.setItem(draftKey, JSON.stringify({draft,original})); else localStorage.removeItem(draftKey); } catch { /* Quota errors do not prevent server saves. */ }
  }, [draft, original, dirty, draftKey, loading]);
  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [dirty]);
  const projectName = (n) => projects.rows.find((p) => p.id === n.project_id)?.name;
  const scoped = useMemo(() => notes.filter(n => !projectId || n.project_id === projectId), [notes, projectId]);
  const visible = scoped.filter(n => (!folder || n.folder === folder) && `${n.title} ${n.content} ${n.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
  const canLeave = () => !saving && (!dirty || window.confirm('Discard unsaved changes to this note?'));
  const open = n => {
    if (!canLeave()) return;
    setDraft(n); setOriginal(n); setView('notes');
    if (!projectId) setParams({ note: n.id }, { replace: true });
  };
  // Follow ?note=<id> changes (e.g. picked from the command palette) while the page is open.
  const noteParam = params.get('note');
  useEffect(() => {
    if (!noteParam || loading || projectId) return;
    const { draft: current, dirty: isDirty, saving: isSaving } = latest.current;
    if (isDirty || isSaving || current?.id === noteParam) return;
    const target = notes.find(n => n.id === noteParam);
    if (target) open(target);
  }, [noteParam, loading, notes]);
  const create = (title = '', content = '') => {
    if (!canLeave()) return;
    setOriginal(null); setDraft({ title, content, folder, tags: [], project_id: projectId, pinned: false }); setView('notes');
  };
  const save = async () => {
    if (!draft || saving || savingRef.current) return;
    savingRef.current = true;
    mutationVersion.current++;
    const snapshot = draft;
    setSaving(true); setError('');
    try {
      const saved = await saveNote({ ...draft, tags: draft.tags.map(t => t.trim()).filter(Boolean) }, original);
      mutationVersion.current++;
      setNotes(rows => [...rows.filter(n => n.id !== saved.id), saved]);
      setDraft(current => current === snapshot ? saved : { ...current, id: saved.id, updated_at: saved.updated_at }); setOriginal(saved);
      if (!projectId) setParams({ note: saved.id }, { replace: true });
    } catch (e) { setError(e.message); } finally { savingRef.current = false; setSaving(false); }
  };
  useEffect(() => {
    if (!dirty || !draft?.title?.trim() || saving || loading || error) return;
    const timer = setTimeout(save, 1000);
    return () => clearTimeout(timer);
  }, [draft, dirty, saving, loading, error]);
  const remove = async () => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    mutationVersion.current++;
    setSaving(true);
    try { if (original) await deleteNote(original.id); setNotes(rows => rows.filter(n => n.id !== original?.id)); setDraft(null); setOriginal(null); }
    catch (e) { setError(e.message); } finally { mutationVersion.current++; setSaving(false); }
  };
  const importFiles = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!canLeave()) return;
    setSaving(true); setError('');
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MB note limit.`);
        const saved = await saveNote({ title: file.name.replace(/\.(md|markdown)$/i, ''), content: await file.text(), folder, tags: [], project_id: projectId });
        setNotes(rows => [...rows, saved]);
      }
    } catch (err) { setError(`Import stopped: ${err.message} Previously imported files were retained.`); } finally { setSaving(false); }
  };
  return <div className="kb-page">
    {syncOpen && <KnowledgeSync onClose={() => setSyncOpen(false)} onSaved={() => loadNotes().then(setNotes).catch(e => setError(e.message))} />}
    <header className="kb-header"><h1 className="sr-only">Knowledge Base</h1><div className="row"><button className="btn" onClick={() => setSyncOpen(true)}>Context sync</button><label className="btn"><i className="ti ti-upload" /> Import .md<input type="file" accept=".md,.markdown" multiple hidden disabled={saving || loading} onChange={importFiles} /></label><button className="btn btn--accent" disabled={saving || loading} onClick={() => create()}><i className="ti ti-plus" /> New note</button></div></header>
    {error && <div className="kb-error" role="alert">{error}<button className="btn btn--sm" onClick={() => setError('')}>Dismiss</button></div>}
    <div className="kb-workspace"><aside className="kb-library"><div className="kb-library-top"><span className="kb-eyebrow">Library / {scoped.length}</span><div className="segmented"><button className={view === 'notes' ? 'active' : ''} onClick={() => setView('notes')}>Notes</button><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>Network</button></div><input className="input" aria-label="Search knowledge" placeholder="Search notes, context, tags…" value={query} onChange={e => setQuery(e.target.value)} /><select className="input" aria-label="Filter folder" value={folder} onChange={e => setFolder(e.target.value)}><option value="">All folders</option>{[...new Set(scoped.map(n => n.folder).filter(Boolean))].sort().map(f => <option key={f}>{f}</option>)}</select></div><div className="kb-note-list">{loading ? <p>Loading your knowledge…</p> : visible.length === 0 ? <p>{query || folder ? 'No matching notes.' : 'No notes yet. Import Markdown or start a new note.'}</p> : visible.map(n => <button className={`kb-note ${draft?.id === n.id ? 'active' : ''}`} key={n.id} onClick={() => open(n)}><span>{n.pinned && <i className="ti ti-pin" />} {n.title}</span><small>{n.folder || 'Personal'}{!projectId && projectName(n) ? ` · ${projectName(n)}` : ''} · {new Date(n.updated_at).toLocaleDateString()}</small><p>{n.content.replace(/[#*`\[\]]/g, '').slice(0, 90) || 'Empty note'}</p></button>)}</div></aside>
      <div className="kb-main">{view === 'graph' ? <KnowledgeGraph notes={visible} allNotes={notes} selected={draft?.id} onSelect={open} /> : draft ? <KnowledgeEditor key={draft.id || 'new'} note={draft} notes={notes} projects={projects.rows} dirty={dirty} saving={saving} onChange={patch => { setError(''); setDraft(n => ({ ...n, ...patch })); }} onSave={save} onDelete={remove} onOpen={target => { const n = resolveNote(notes, target); if (n) open(n); else create(target); }} /> : <div className="kb-empty"><i className="ti ti-notebook" /><h2>No note selected</h2><p>Save research, project decisions, and reusable context.<br />Link notes with [[Note title]] to build your network.</p><button className="btn btn--accent" disabled={loading} onClick={() => create()}>Write your first note</button></div>}</div>
    </div>
  </div>;
}

