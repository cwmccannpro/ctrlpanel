import { useEffect, useMemo, useState } from 'react';
import { buildKnowledgeTree, filterKnowledgeNotes, knowledgeFolderPaths } from '../lib/knowledgeTree.js';

export default function KnowledgeTree({ notes, selectedId, query, onQueryChange, onSelect, onCreate, onFolderChange, projectName, folders = [], moveDisabled, activeFolder, onNewFolder, onMove, storageKey = 'all', loading = false }) {
  const collapseKey = `ctrlpanel-knowledge-tree:${storageKey}`;
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(collapseKey) || '[]')); } catch { return new Set(); }
  });
  const [adding, setAdding] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [drop, setDrop] = useState(null);
  const [busy, setBusy] = useState(false);
  const dropZone = path => ({
    onDragOver(event) {
      if (!event.dataTransfer.types.includes('application/x-context-note')) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDrop(path);
    },
    onDragLeave() { setDrop(null); },
    onDrop(event) {
      event.preventDefault(); setDrop(null);
      const id = event.dataTransfer.getData('application/x-context-note');
      if (id) onMove(id, path);
    }
  });
  async function addFolder(event) {
    event.preventDefault();
    if (busy || !folderName.trim()) return;
    setBusy(true);
    if (await onNewFolder(folderName)) {
      setCollapsed(new Set()); setAdding(false); setFolderName('');
    }
    setBusy(false);
  }
  const filtered = useMemo(() => filterKnowledgeNotes(notes, query), [notes, query]);
  const tree = useMemo(() => buildKnowledgeTree(filtered, query ? [] : folders), [filtered, folders, query]);
  const allPaths = useMemo(() => knowledgeFolderPaths([...notes, ...folders.map(folder => ({ folder }))]), [notes, folders]);
  useEffect(() => {
    try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* Local preferences are optional. */ }
  }, [collapsed, collapseKey]);

  const toggle = path => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const renderNode = (node, depth = 0) => <div className="kb-tree-branch" key={node.path || 'root'}>
    {node.path && <div {...dropZone(node.path)} data-drop={drop === node.path} data-current={activeFolder === node.path} className={`kb-tree-folder ${collapsed.has(node.path) && !query ? 'is-collapsed' : ''}`} style={{ '--tree-depth': depth }}>
      <button className="kb-tree-folder-main" aria-expanded={!collapsed.has(node.path) || !!query} onClick={() => { onFolderChange?.(node.path); toggle(node.path); }} title={node.path}>
        <i className={`ti ${collapsed.has(node.path) && !query ? 'ti-chevron-right' : 'ti-chevron-down'}`} aria-hidden="true" />
        <i className={`ti ${collapsed.has(node.path) && !query ? 'ti-folder' : 'ti-folder-open'}`} aria-hidden="true" />
        <span>{node.name}</span><small>{node.count}</small>
      </button>
      <button className="kb-tree-add" aria-label={`New note in ${node.path}`} title={`New note in ${node.path}`} onClick={() => onCreate(node.path)}><i className="ti ti-plus" aria-hidden="true" /></button>
    </div>}
    {(!node.path || !collapsed.has(node.path) || query) && <div className="kb-tree-children">
      {node.folders.map(folder => renderNode(folder, depth + (node.path ? 1 : 0)))}
      {node.notes.map(note => <button key={note.id} draggable={!moveDisabled} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-context-note', note.id); }} className={`kb-tree-note ${selectedId === note.id ? 'is-active' : ''}`} style={{ '--tree-depth': depth + (node.path ? 1 : 0) }} onClick={() => { onFolderChange?.(note.folder || ''); onSelect(note); }} title={`${note.folder ? `${note.folder}/` : ''}${note.title}`}>
        <span className="kb-tree-note-icon"><i className={`ti ${note.pinned ? 'ti-pin-filled' : 'ti-file-text'}`} aria-hidden="true" /></span>
        <span className="kb-tree-note-copy"><strong>{note.title || 'Untitled'}</strong>{projectName?.(note) && <small>{projectName(note)}</small>}</span>
        {note.content.includes('[[') && <i className="ti ti-link kb-tree-link-mark" aria-label="Has links" />}
      </button>)}
    </div>}
  </div>;

  return <aside className="kb-library" aria-label="Context library">
    <div className="kb-library-head"><strong>Library</strong><div className="ctx-tree-actions"><button className="btn btn--icon btn--ghost" title="New folder" aria-label="New folder" onClick={() => { setFolderName(activeFolder ? activeFolder + '/' : ''); setAdding(true); }}><i className="ti ti-folder-plus" /></button><button className="btn btn--icon btn--ghost" onClick={() => onCreate('')} aria-label="Create note" title="Create note"><i className="ti ti-square-rounded-plus" aria-hidden="true" /></button></div></div>
    <label className="kb-tree-search"><i className="ti ti-search" aria-hidden="true" /><span className="sr-only">Search notes</span><input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Find a note…" />{query && <button type="button" aria-label="Clear search" onClick={() => onQueryChange('')}><i className="ti ti-x" aria-hidden="true" /></button>}</label>
    <div className="kb-tree-toolbar"><span>{filtered.length} {filtered.length === 1 ? 'note' : 'notes'}</span><div><button onClick={() => setCollapsed(new Set())}>Expand</button><span aria-hidden="true">·</span><button onClick={() => setCollapsed(new Set(allPaths))}>Collapse</button></div></div>
    {adding && <form className="ctx-folder-form" onSubmit={addFolder}>
      <input className="input" autoFocus aria-label="Folder path" placeholder="Folder or nested/path" value={folderName} onChange={e => setFolderName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setAdding(false); }} />
      <button className="btn btn--icon" disabled={busy || !folderName.trim()} aria-label="Save folder"><i className="ti ti-check" /></button>
      <button type="button" className="btn btn--icon" aria-label="Cancel folder" onClick={() => setAdding(false)}><i className="ti ti-x" /></button>
    </form>}
    <button className="ctx-root-folder" {...dropZone('')} data-drop={drop === ''} data-current={!activeFolder} onClick={() => onFolderChange('')}><i className="ti ti-folders" /> All notes</button>
    <nav className="kb-tree" aria-label="Folders and notes">
      {loading ? <div className="kb-tree-state"><i className="ti ti-loader-2" aria-hidden="true" /> Loading vault…</div> : (filtered.length || tree.folders.length) ? renderNode(tree) : <div className="kb-tree-state"><i className="ti ti-file-search" aria-hidden="true" /><strong>{query ? 'No matches' : 'No notes yet'}</strong><span>{query ? 'Try a title, folder, tag, or phrase.' : ''}</span></div>}
    </nav>

  </aside>;
}
