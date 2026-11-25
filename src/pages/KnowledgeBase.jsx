import { useEffect, useMemo, useState, useRef, lazy, Suspense } from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../components/WorkspaceProvider.jsx';
import KnowledgeGraph from '../components/KnowledgeGraph.jsx';
import ContextMarkdown from '../components/ContextMarkdown.jsx';
import NoteConnections from '../components/ContextConnections.jsx';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { cleanFolder } from '../lib/knowledgeTree.js';
import { contextFolderCatalog, contextFolderSection, contextFolderTarget, contextTreePath, PROJECTS_FOLDER, projectFolderPath } from '../lib/contextFolders.js';
import KnowledgeTree from '../components/KnowledgeTree.jsx';
import { deleteNote, loadNotes, resolveNote, saveNote, subscribeKnowledge } from '../lib/knowledge.js';
import '../styles/knowledge.css';
import { useAuth } from '../components/AuthProvider.jsx';
import KnowledgeSync from '../components/KnowledgeSync.jsx';

const KnowledgeEditor = lazy(() => import('../components/KnowledgeEditor.jsx'));

export default function KnowledgeBase({ projectId = null }) {
  const { projects } = useWorkspace();
  const { user, settings, updateUiPreferences } = useAuth();
  const [syncOpen, setSyncOpen] = useState(false);
  const [tabKey] = useState(() => {
    try { const key=sessionStorage.getItem('ctrlpanel-draft-tab') || crypto.randomUUID(); sessionStorage.setItem('ctrlpanel-draft-tab',key); return key; }
    catch { return 'default'; }
  });
  const latest = useRef({});
  const [editing, setEditing] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const savingRef = useRef(false);
  const mutationVersion = useRef(0);
  const draftKey = `ctrlpanel-context-draft:${user?.id}:${projectId || "all"}:${tabKey}`;
  const [params, setParams] = useSearchParams();
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [original, setOriginal] = useState(null);
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState(() => projectId ? projectFolderPath(projectId) : '');
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [treeOpen, setTreeOpen] = useState(!mobile);
  useEffect(() => { setTreeOpen(!mobile); }, [mobile]);
  const scope = projectId || 'all';
  const preferences = settings?.ui_preferences;
  const catalog = useMemo(() => contextFolderCatalog(projects.rows, preferences, projectId), [projects.rows, preferences, projectId]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original);
  latest.current = { draft, original, dirty, saving };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || saving) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (!saving && window.confirm('Discard unsaved changes and leave this note?')) blocker.proceed();
    else blocker.reset();
  }, [blocker, saving]);
  useEffect(() => {
    let active = true, running = false;
    try { const pending = JSON.parse(localStorage.getItem(draftKey)); if (pending?.draft) { setEditing(true); setDraft(pending.draft); setOriginal(pending.original); latest.current = { ...latest.current, dirty: true }; } } catch {}
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
          const selected = rows.find(n => n.id === current.draft?.id);
          if (selected) { setDraft(selected); setOriginal(selected); }
          else if(current.draft?.id) { setDraft(null); setOriginal(null); setEditing(false); }
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
  const scoped = useMemo(() => notes.filter(n => !projectId || n.project_id === projectId), [notes, projectId]);
  const treeNotes = useMemo(() => scoped.map(note => ({
    ...note, folder: contextTreePath(note),
    tags: [...(note.tags || []), catalog.names[projectFolderPath(note.project_id)] || ''],
  })), [scoped, catalog.names]);
  const canLeave = () => !saving && (!dirty || window.confirm('Discard unsaved changes to this note?'));
  const updateUrl = noteId => {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (noteId) next.set('note', noteId); else next.delete('note');
      next.delete('view');
      return next;
    }, { replace: true });
  };
  const open = n => {
    if (!canLeave()) return;
    setDraft(n); setOriginal(n); setActiveFolder(!projectId || n.project_id === projectId ? contextTreePath(n) : projectFolderPath(projectId)); setEditing(false);
    if (mobile) setTreeOpen(false);
    updateUrl(!projectId || n.project_id === projectId ? n.id : null);
  };
  // Follow ?note=<id> changes (e.g. picked from the command palette) while the page is open.
  const noteParam = params.get('note');
  useEffect(() => {
    if (!noteParam || loading) return;
    const { draft: current, dirty: isDirty, saving: isSaving } = latest.current;
    if (isDirty || isSaving || current?.id === noteParam) return;
    const target = scoped.find(n => n.id === noteParam);
    if (target) open(target);
  }, [noteParam, loading, scoped]);
  const create = (title = '', content = '', targetFolder = activeFolder) => {
    if (!canLeave()) return;
    setEditing(true); setEditorKey(k => k + 1); updateUrl(null);
    setOriginal(null); setDraft({ title, content, ...contextFolderTarget(targetFolder, projectId), tags: [], pinned: false }); if (mobile) setTreeOpen(false);
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
      setActiveFolder(!projectId || saved.project_id === projectId ? contextTreePath(saved) : projectFolderPath(projectId));
      updateUrl(saved.id);
      return saved;
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
    try { if (original) await deleteNote(original.id); setNotes(rows => rows.filter(n => n.id !== original?.id)); setDraft(null); setOriginal(null); setEditing(false); updateUrl(null); }
    catch (e) { setError(e.message); } finally { mutationVersion.current++; setSaving(false); }
  };
  const importFiles = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!canLeave()) return;
    mutationVersion.current++; setSaving(true); setError('');
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MB note limit.`);
        const saved = await saveNote({ title: file.name.replace(/\.(md|markdown)$/i, ''), content: await file.text(), ...contextFolderTarget(activeFolder, projectId), tags: [] });
        setNotes(rows => [...rows, saved]);
      }
    } catch (err) { setError(`Import stopped: ${err.message} Previously imported files were retained.`); } finally { mutationVersion.current++; setSaving(false); }
  };
  async function leaveEditor() {
    if (saving) return;
    if (dirty && draft.title.trim()) {
      if (!await save()) return;
    } else if (dirty) {
      if (draft.content && !canLeave()) return;
      setDraft(original);
    }
    setEditing(false);
  }
  const follow = key => {
    const target = resolveNote(notes, key);
    if (target) open(target); else create(key);
  };
  async function newFolder(value, parent) {
    const folder = cleanFolder(value);
    const path = cleanFolder([parent === PROJECTS_FOLDER ? '' : parent, folder].filter(Boolean).join('/'));
    const target = contextFolderTarget(path, projectId);
    if (!folder || folder.includes(PROJECTS_FOLDER) || target.folder.length > 500) { setError('Enter a folder path of 1–500 characters.'); return false; }
    try {
      await updateUiPreferences(contextFolderSection(target.project_id), { [target.folder]: true });
      setActiveFolder(contextTreePath(target)); setError(''); return true;
    } catch (e) { setError(e.message); return false; }
  }
  async function moveNote(id, path) {
    const note = scoped.find(n => n.id === id);
    const target = contextFolderTarget(path, projectId);
    if (!note || (note.folder === target.folder && note.project_id === target.project_id)) return;
    if (savingRef.current || saving || (editing && dirty)) {
      setError('Finish saving your edits before moving a note.'); return;
    }
    savingRef.current = true; mutationVersion.current++; setSaving(true);
    try {
      const previousSection = contextFolderSection(note.project_id);
      if (note.folder && !Object.hasOwn(preferences?.[previousSection] || {}, note.folder)) {
        await updateUiPreferences(previousSection, { [note.folder]: true });
      }
      const saved = await saveNote({ ...note, ...target }, note);
      setNotes(rows => rows.map(n => n.id === id ? saved : n));
      if (draft?.id === id) { setDraft(saved); setOriginal(saved); }
      setActiveFolder(contextTreePath(saved)); setError('');
    } catch (e) { setError(e.message); }
    finally { mutationVersion.current++; savingRef.current = false; setSaving(false); }
  }
  return <div className="kb-page ctx-page">
    {syncOpen && <KnowledgeSync linkedFiles={notes.filter(n => n.external_key?.startsWith('files/') && !n.external_key.endsWith('/index')).length} onClose={() => setSyncOpen(false)} onSaved={() => loadNotes().then(setNotes).catch(e => setError(e.message))} />}
    <header className="ctx-header"><div className="ctx-brand"><button className="btn btn--ghost btn--icon" title="Toggle library" aria-label="Toggle library" aria-expanded={treeOpen} onClick={() => setTreeOpen(!treeOpen)}><i className="ti ti-layout-sidebar" /></button>{projectId ? <h2>Context</h2> : <h1>Context</h1>}</div>
      <div className="ctx-header-actions"><button className="btn btn--ghost" aria-label="Context sync" title="Context sync" onClick={() => setSyncOpen(true)}><i className="ti ti-refresh" /><span>Sync</span></button>
        <label className="btn btn--ghost ctx-import" title="Import Markdown"><i className="ti ti-upload" /><span>Import</span><input aria-label="Import Markdown" type="file" accept=".md,.markdown" multiple disabled={saving || loading} onChange={importFiles} /></label>
        <button className="btn btn--accent" disabled={saving || loading} onClick={() => create()}><i className="ti ti-plus" /> New note</button></div></header>
    {error && <div className="kb-error" role="alert">{error}<button className="btn btn--sm" onClick={() => setError('')}>Dismiss</button></div>}
    <div className={'ctx-workspace' + (treeOpen ? ' with-tree' : '')}>
      {treeOpen && <><KnowledgeTree notes={treeNotes} selectedId={draft?.id} query={query} onQueryChange={setQuery} onSelect={id => { const note = scoped.find(n => n.id === id); if (note) open(note); }} onCreate={targetFolder => create('', '', targetFolder)}
        folders={catalog.paths} folderNames={catalog.names} moveDisabled={saving || dirty} activeFolder={activeFolder} onNewFolder={newFolder} onMove={moveNote} onFolderChange={setActiveFolder} storageKey={user?.id + ':' + scope} loading={loading} />
        <button className="ctx-tree-scrim" aria-label="Close library" onClick={() => setTreeOpen(false)} /></>}
      <div className="ctx-stage">
        <div className="ctx-scene" hidden={editing}><KnowledgeGraph notes={scoped} allNotes={notes} selected={draft?.id} onSelect={open} onCreate={() => create()} loading={loading} error={error} /></div>
        {editing && draft && <Suspense fallback={<p className="body-text">Opening editor…</p>}><KnowledgeEditor key={editorKey} note={draft} notes={notes} projects={projects.rows} dirty={dirty} saving={saving}
          onChange={patch => { setError(''); setDraft(n => ({ ...n, ...patch })); }} onSave={save} onDelete={remove} onOpen={follow} onBack={leaveEditor} /></Suspense>}
        {!editing && draft && <aside className="ctx-preview" aria-label="Note preview">
          <div className="ctx-preview-bar"><span><i className="ti ti-file-text" /> Note preview</span><button className="btn btn--icon btn--ghost" aria-label="Close preview" onClick={() => { setDraft(null); setOriginal(null); updateUrl(null); }}><i className="ti ti-x" /></button></div>
          <div className="ctx-preview-scroll"><small>{draft.folder || 'Library'}</small><h2>{draft.title}</h2>
            <article className="ctx-prose"><ContextMarkdown content={draft.content} onOpen={follow} /></article>
            <NoteConnections note={draft} notes={notes} onOpen={follow} /></div>
          <button className="btn btn--accent ctx-edit" onClick={() => setEditing(true)}><i className="ti ti-pencil" /> Edit note</button>
        </aside>}
      </div>
    </div>
  </div>;
}
