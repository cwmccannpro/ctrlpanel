function cleanFolder(value = '') {
  return value.replace(/\\/g, '/').split('/').map(part => part.trim()).filter(Boolean).join('/');
}

export function filterKnowledgeNotes(notes, query = '') {
  const needle = query.trim().toLowerCase();
  if (!needle) return notes;
  return notes.filter(note => `${note.title} ${note.folder} ${note.content} ${(note.tags || []).join(' ')}`.toLowerCase().includes(needle));
}

export function buildKnowledgeTree(notes) {
  const root = { name: 'Vault', path: '', folders: [], notes: [], count: 0 };
  const folders = new Map([['', root]]);
  const folderFor = path => {
    if (folders.has(path)) return folders.get(path);
    const parts = path.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const node = { name: parts.at(-1), path, folders: [], notes: [], count: 0 };
    folderFor(parentPath).folders.push(node);
    folders.set(path, node);
    return node;
  };

  for (const note of notes) folderFor(cleanFolder(note.folder)).notes.push(note);
  const sort = node => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    node.notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    node.count = node.notes.length + node.folders.reduce((total, child) => total + sort(child), 0);
    return node.count;
  };
  sort(root);
  return root;
}

export function knowledgeFolderPaths(notes) {
  const paths = new Set();
  for (const note of notes) {
    const parts = cleanFolder(note.folder).split('/').filter(Boolean);
    parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join('/')));
  }
  return [...paths].sort();
}
