import { cleanFolder } from './knowledgeTree.js';

// Virtual tree keys. Persisted note paths stay relative to their project.
export const PROJECTS_FOLDER = '\u0001projects';
export const contextFolderSection = (projectId) => `contextFolders-${projectId || 'all'}`;
export const projectFolderPath = (id) => `${PROJECTS_FOLDER}/${id}`;

export function contextTreePath(note) {
  const folder = cleanFolder(note.folder || '');
  return note.project_id ? [projectFolderPath(note.project_id), folder].filter(Boolean).join('/') : folder;
}

export function contextFolderTarget(path, projectId) {
  const [root, id, ...parts] = path.split('/');
  if (root === PROJECTS_FOLDER) return { project_id: id || projectId || null, folder: parts.join('/') };
  return { project_id: projectId || null, folder: cleanFolder(path) };
}

export function contextFolderCatalog(projects, preferences, projectId) {
  const paths = projectId ? [] : Object.keys(preferences?.[contextFolderSection()] || {});
  const names = { [PROJECTS_FOLDER]: 'Projects' };
  for (const project of projects) {
    if (projectId && project.id !== projectId) continue;
    const base = projectFolderPath(project.id);
    names[base] = project.name || 'Untitled project';
    paths.push(base);
    for (const path of Object.keys(preferences?.[contextFolderSection(project.id)] || {})) {
      paths.push(`${base}/${cleanFolder(path)}`);
    }
  }
  return { paths, names };
}

export function contextFolderLabel(path, names) {
  return path.split('/').map((part, index, segments) => names[segments.slice(0, index + 1).join('/')] || part).join('/');
}
