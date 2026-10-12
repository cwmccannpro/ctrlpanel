import { useEffect, useMemo, useState, useRef } from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import KnowledgeGraph from '../components/KnowledgeGraph.jsx';
import KnowledgeEditor from '../components/KnowledgeEditor.jsx';
import KnowledgeTree from '../components/KnowledgeTree.jsx';
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
  const resizeGraph = useRef(null);
  const savingRef = useRef(false);
  const mutationVersion = useRef(0);
  const draftKey = `ctrlpanel-context-draft:${user?.id}:${projectId || "all"}:${tabKey}`;
  const [params, setParams] = useSearchParams();
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [original, setOriginal] = useState(null);
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState('');
  const [treeOpen, setTreeOpen] = useState(false);
  const graphPreferenceKey = `ctrlpanel-knowledge-network:${projectId || 'all'}`;
  const [graphOpen, setGraphOpen] = useState(() => {
    try { return params.get('view') === 'network' || localStorage.getItem(graphPreferenceKey) === 'true'; } catch { return params.get('view') === 'network'; }
  });
  const [graphWidth, setGraphWidth] = useState(() => {
    try { return Math.max(300, Math.min(620, Number(localStorage.getItem('ctrlpanel-knowledge-network-width')) || 380)); } catch { return 380; }
  });
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
  useEffect(() => {
    try { localStorage.setItem(graphPreferenceKey, String(graphOpen)); } catch { /* Local layout preferences are optional. */ }
  }, [graphOpen, graphPreferenceKey]);
  useEffect(() => {
    try { localStorage.setItem('ctrlpanel-knowledge-network-width', String(graphWidth)); } catch { /* Local layout preferences are optional. */ }
  }, [graphWidth]);
  const projectName = (n) => projects.rows.find((p) => p.id === n.project_id)?.name;
  const scoped = useMemo(() => notes.filter(n => !projectId || n.project_id === projectId), [notes, projectId]);
  const canLeave = () => !saving && (!dirty || window.confirm('Discard unsaved changes to this note?'));
  const updateUrl = (noteId, showGraph = graphOpen) => {
    if (projectId) return;
    setParams(current => {
      const next = new URLSearchParams(current);
      if (noteId) next.set('note', noteId); else next.delete('note');
      if (showGraph) next.set('view', 'network'); else next.delete('view');
      return next;
    }, { replace: true });
  };
  const toggleGraph = value => {
    const next = typeof value === 'boolean' ? value : !graphOpen;
    setGraphOpen(next); setTreeOpen(false); updateUrl(draft?.id, next);
  };
  const open = n => {
    if (!canLeave()) return;
    setDraft(n); setOriginal(n); setActiveFolder(n.folder || ''); setTreeOpen(false);
    updateUrl(n.id);
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
  const create = (title = '', content = '', targetFolder = activeFolder) => {
    if (!canLeave()) return;
    setOriginal(null); setDraft({ title, content, folder: targetFolder, tags: [], project_id: projectId, pinned: false }); setTreeOpen(false);
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
      updateUrl(saved.id);
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
    try { if (original) await deleteNote(original.id); setNotes(rows => rows.filter(n => n.id !== original?.id)); setDraft(null); setOriginal(null); updateUrl(null); }
    catch (e) { setError(e.message); } finally { mutationVersion.current++; setSaving(false); }
  };
  const importFiles = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!canLeave()) return;
    setSaving(true); setError('');
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MB note limit.`);
        const saved = await saveNote({ title: file.name.replace(/\.(md|markdown)$/i, ''), content: await file.text(), folder: activeFolder, tags: [], project_id: projectId });
        setNotes(rows => [...rows, saved]);
      }
    } catch (err) { setError(`Import stopped: ${err.message} Previously imported files were retained.`); } finally { setSaving(false); }
  };
  return <div className="kb-page">
    {syncOpen && <KnowledgeSync linkedFiles={notes.filter(n => n.external_key?.startsWith('files/') && !n.external_key.endsWith('/index')).length} onClose={() => setSyncOpen(false)} onSaved={() => loadNotes().then(setNotes).catch(e => setError(e.message))} />}
    <header className="kb-header"><div className="kb-header-brand"><button className="btn btn--icon btn--ghost kb-tree-trigger" aria-label="Open vault tree" aria-expanded={treeOpen} onClick={() => { setTreeOpen(value => !value); setGraphOpen(false); }}><i className="ti ti-folders" aria-hidden="true" /></button><div><span className="kb-eyebrow">Knowledge system</span><h1>{projectId ? projects.rows.find(project => project.id === projectId)?.name || 'Project knowledge' : 'Knowledge Base'}</h1></div><span className="kb-vault-health"><i className="ti ti-point-filled" aria-hidden="true" /> {scoped.length} notes</span></div><div className="kb-header-actions"><button className="btn btn--ghost" onClick={() => setSyncOpen(true)}><i className="ti ti-refresh" aria-hidden="true" /><span>Context sync</span></button><label className="btn btn--ghost"><i className="ti ti-upload" aria-hidden="true" /><span>Import</span><input type="file" accept=".md,.markdown" multiple hidden disabled={saving || loading} onChange={importFiles} /></label><button className={`btn kb-network-trigger ${graphOpen ? 'is-active' : ''}`} aria-pressed={graphOpen} onClick={() => toggleGraph()}><i className="ti ti-topology-star-3" aria-hidden="true" /><span>Network</span></button><button className="btn btn--accent" disabled={saving || loading} onClick={() => create()}><i className="ti ti-plus" aria-hidden="true" /><span>New note</span></button></div></header>
    {error && <div className="kb-error" role="alert">{error}<button className="btn btn--sm" onClick={() => setError('')}>Dismiss</button></div>}
    <div className={`kb-workspace ${graphOpen ? 'kb-workspace--graph' : ''} ${treeOpen ? 'kb-workspace--tree-open' : ''}`} style={{ '--kb-graph-width': `${graphWidth}px` }}>
      <KnowledgeTree notes={scoped} selectedId={draft?.id} query={query} onQueryChange={setQuery} onSelect={open} onCreate={targetFolder => create('', '', targetFolder)} onFolderChange={setActiveFolder} projectName={!projectId ? projectName : null} storageKey={projectId || 'all'} loading={loading} />
      {treeOpen && <button className="kb-pane-scrim kb-pane-scrim--tree" aria-label="Close vault tree" onClick={() => setTreeOpen(false)} />}
      <main className="kb-main">{draft ? <KnowledgeEditor key={draft.id || 'new'} note={draft} notes={notes} projects={projects.rows} dirty={dirty} saving={saving} onChange={patch => { setError(''); setDraft(n => ({ ...n, ...patch })); }} onSave={save} onDelete={remove} onOpen={target => { const n = resolveNote(notes, target); if (n) open(n); else create(target); }} /> : <div className="kb-empty"><div className="kb-empty-orbit"><i className="ti ti-notebook" aria-hidden="true" /></div><span className="kb-eyebrow">Your thinking starts here</span><h2>Select a note from your vault</h2><p>Capture research, decisions, and durable project context. Connect ideas with <code>[[Note title]]</code> and watch the network emerge.</p><div className="row"><button className="btn btn--accent" disabled={loading} onClick={() => create()}>Create a note</button>{scoped.length > 0 && <button className="btn" onClick={() => toggleGraph(true)}>Explore network</button>}</div></div>}</main>
      {graphOpen && <aside className="kb-network-pane" aria-label="Knowledge network"><div className="kb-network-resize" role="separator" aria-label="Resize network panel" aria-orientation="vertical" tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft') setGraphWidth(width => Math.min(620, width + 24)); if (event.key === 'ArrowRight') setGraphWidth(width => Math.max(300, width - 24)); }} onPointerDown={event => { resizeGraph.current = { x: event.clientX, width: graphWidth, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const start = resizeGraph.current; if (start?.pointerId === event.pointerId) setGraphWidth(Math.max(300, Math.min(620, start.width + start.x - event.clientX))); }} onPointerUp={event => { resizeGraph.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} /><KnowledgeGraph notes={scoped} allNotes={notes} selected={draft?.id} onSelect={open} onClose={() => toggleGraph(false)} compact /></aside>}
      {graphOpen && <button className="kb-pane-scrim kb-pane-scrim--network" aria-label="Close knowledge network" onClick={() => toggleGraph(false)} />}
    </div>
  </div>;
}

