import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const META_KEYS = ['title', 'ctrlpanel_key', 'ctrlpanel_project_id', 'ctrlpanel_project', 'ctrlpanel_updated_at'];
const normalizeText = value => String(value || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const scalar = value => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try { return trimmed.startsWith('"') ? JSON.parse(trimmed) : trimmed.slice(1, -1).replace(/''/g, "'"); }
    catch { return trimmed.slice(1, -1); }
  }
  return trimmed === 'null' ? '' : trimmed;
};

export function parseVaultFile(text, relativePath) {
  const source = normalizeText(text);
  let frontmatter = [], content = source;
  if (source.startsWith('---\n')) {
    const end = source.indexOf('\n---\n', 4);
    if (end >= 0) {
      frontmatter = source.slice(4, end).split('\n');
      content = source.slice(end + 5);
    }
  }
  const metadata = {};
  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (match) metadata[match[1]] = scalar(match[2]);
  }
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const fallbackTitle = path.posix.basename(normalizedPath).replace(/\.(?:md|markdown)$/i, '');
  const directory = path.posix.dirname(normalizedPath);
  return {
    relativePath: normalizedPath,
    title: String(metadata.title || fallbackTitle).trim() || 'Untitled',
    folder: directory === '.' ? '' : directory,
    content,
    external_key: metadata.ctrlpanel_key || '',
    project_id: metadata.ctrlpanel_project_id || null,
    project_name: metadata.ctrlpanel_project || '',
    remote_updated_at: metadata.ctrlpanel_updated_at || null,
    frontmatter,
  };
}

const yamlValue = value => JSON.stringify(String(value));
export function serializeVaultFile(note, original = null) {
  const values = {
    title: note.title,
    ctrlpanel_key: note.external_key,
    ctrlpanel_project_id: note.project_id || null,
    ctrlpanel_project: note.project_name || null,
    ctrlpanel_updated_at: note.remote_updated_at || null,
  };
  const lines = [...(original?.frontmatter || [])];
  for (const key of META_KEYS) {
    const index = lines.findIndex(line => new RegExp(`^${key}\\s*:`).test(line));
    if (values[key]) {
      const next = `${key}: ${yamlValue(values[key])}`;
      if (index >= 0) lines[index] = next; else lines.push(next);
    } else if (index >= 0) lines.splice(index, 1);
  }
  return `---\n${lines.join('\n')}\n---\n${normalizeText(note.content)}`;
}

export function resolveProject(note, projects, projectsDirectory = 'Projects') {
  const byId = new Map(projects.map(project => [project.id, project]));
  const byName = new Map(projects.map(project => [project.name.trim().toLowerCase(), project]));
  if (note.project_id && byId.has(note.project_id)) return byId.get(note.project_id);
  if (note.project_name && byName.has(note.project_name.trim().toLowerCase())) return byName.get(note.project_name.trim().toLowerCase());
  const parts = note.relativePath.split('/');
  if (parts[0]?.toLowerCase() === projectsDirectory.toLowerCase() && parts[1]) return byName.get(parts[1].trim().toLowerCase()) || null;
  return null;
}

export const noteHash = note => createHash('sha256').update(JSON.stringify([
  note.title,
  note.folder,
  normalizeText(note.content),
  note.project_id || null,
])).digest('hex');

export function vaultDecision(local, remote, previous) {
  if (!remote) return 'create';
  const localHash = noteHash(local), remoteHash = noteHash(remote);
  if (localHash === remoteHash) return 'unchanged';
  const baselineHash = previous?.local_hash;
  const baselineRemote = previous?.remote_updated_at || local.remote_updated_at;
  if (!baselineHash && !baselineRemote) return 'conflict';
  const localChanged = baselineHash ? localHash !== baselineHash : true;
  const remoteChanged = baselineRemote ? remote.updated_at !== baselineRemote : true;
  if (localChanged && remoteChanged) return 'conflict';
  if (localChanged) return 'push';
  if (remoteChanged) return 'pull';
  return 'conflict';
}

export function ensureVaultIdentity(note) {
  return note.external_key ? note : { ...note, external_key: `vault/${randomUUID()}` };
}

const safeSegment = value => String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim() || 'Untitled';
export function remoteRelativePath(note, projects, projectsDirectory = 'Projects') {
  const project = projects.find(item => item.id === note.project_id);
  let folder = String(note.folder || '').replace(/\\/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').map(safeSegment).join('/');
  if (project) {
    const base = `${safeSegment(projectsDirectory)}/${safeSegment(project.name)}`;
    if (!folder.toLowerCase().startsWith(base.toLowerCase())) folder = folder ? `${base}/${folder}` : base;
  }
  return `${folder ? `${folder}/` : ''}${safeSegment(note.title)}.md`;
}

export function remoteAsLocal(remote, projects) {
  const project = projects.find(item => item.id === remote.project_id);
  return {
    title: remote.title,
    folder: remote.folder || '',
    content: remote.content || '',
    external_key: remote.external_key,
    project_id: remote.project_id || null,
    project_name: project?.name || '',
    remote_updated_at: remote.updated_at,
  };
}
