// Two-way Markdown vault bridge. It runs locally because Cloudflare and the
// browser cannot monitor an arbitrary directory on the owner's computer.
import 'dotenv/config';
import dotenv from 'dotenv';
import { mkdir, readFile, readdir, rename, stat, writeFile, watch } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureVaultIdentity,
  noteHash,
  parseVaultFile,
  remoteAsLocal,
  remoteRelativePath,
  resolveProject,
  serializeVaultFile,
  vaultDecision,
} from './vaultSyncCore.mjs';

const workspace = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(workspace, '.env.local') });
const vaultRoot = process.env.CTRLPANEL_VAULT_ROOT;
const statePath = process.env.CTRLPANEL_VAULT_STATE || path.join(workspace, '.vault-sync-state.local');
const statusPath = path.join(workspace, '.vault-sync-status.local');
const projectsDirectory = process.env.CTRLPANEL_VAULT_PROJECTS_DIR || 'Projects';
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const ignoredDirectories = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

if (!vaultRoot) throw new Error('Set CTRLPANEL_VAULT_ROOT to your Markdown vault folder.');

function apiUrl(params = {}) {
  const base = process.env.CTRLPANEL_URL;
  if (!base) throw new Error('Set CTRLPANEL_URL.');
  const url = new URL('/api/knowledge/notes', base);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote vault sync requires HTTPS.');
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, value);
  return url;
}

async function apiRequest(method, params, body) {
  const key = process.env.CTRLPANEL_VAULT_KEY || process.env.CTRLPANEL_CONTEXT_KEY;
  if (!/^ctpk_[a-f0-9]{48}$/.test(key || '')) throw new Error('Set a valid CTRLPANEL_VAULT_KEY created in Knowledge Base → Context sync.');
  const response = await fetch(apiUrl(params), {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw Object.assign(new Error(data.error || `Context API ${response.status}`), { status: response.status });
  return data;
}

async function remoteSnapshot() {
  let after, first = true, projects = [], notes = [];
  do {
    const data = await apiRequest('GET', { after, include_projects: first ? '1' : undefined });
    notes.push(...(data.notes || []));
    if (first) projects = data.projects || [];
    after = data.next_cursor;
    first = false;
  } while (after);
  return { notes, projects };
}

async function markdownFiles(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await markdownFiles(absolute, relative));
    else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name) && !/\.ctrlpanel-conflict-/.test(entry.name)) found.push({ relative, absolute });
  }
  return found;
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { notes: {} }; throw error; }
}
async function saveState(state) {
  if (!dryRun) await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}
async function writeVaultFile(absolute, note, original) {
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, serializeVaultFile(note, original), 'utf8');
}
const payload = note => ({
  external_key: note.external_key,
  title: note.title,
  folder: note.folder,
  content: note.content,
  project_id: note.project_id || null,
});
const stateEntry = note => ({ local_hash: noteHash(note), remote_updated_at: note.remote_updated_at, path: note.relativePath });
const conflictName = relative => relative.replace(/\.(md|markdown)$/i, `.ctrlpanel-conflict-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);

async function syncOnce() {
  const root = path.resolve(vaultRoot);
  if (!(await stat(root)).isDirectory()) throw new Error('CTRLPANEL_VAULT_ROOT is not a directory.');
  const state = await readState();
  state.notes ||= {};
  const snapshot = await remoteSnapshot();
  const results = [];
  // Notes created in the browser do not have an external key yet. Claim them
  // with a deterministic key so a lost response cannot create duplicates.
  for (let index = 0; index < snapshot.notes.length; index++) {
    const note = snapshot.notes[index];
    if (note.external_key) continue;
    const externalKey = `vault/note/${note.id}`;
    if (dryRun) {
      snapshot.notes[index] = { ...note, external_key: externalKey };
      results.push({ title: note.title, status: 'would-claim' });
      continue;
    }
    try {
      const response = await apiRequest('POST', {}, {
        note_id: note.id,
        external_key: externalKey,
        title: note.title,
        folder: note.folder || '',
        content: note.content || '',
        project_id: note.project_id || null,
        expected_updated_at: note.updated_at,
      });
      snapshot.notes[index] = response.note;
      results.push({ title: note.title, status: 'claimed' });
    } catch (error) {
      results.push({ title: note.title, status: 'error', message: error.message });
    }
  }
  const remoteByKey = new Map(snapshot.notes.filter(note => note.external_key?.startsWith('vault/') || note.external_key?.startsWith('legacy-project-note/')).map(note => [note.external_key, note]));
  const localByKey = new Map();

  for (const file of await markdownFiles(root)) {
    if ((await stat(file.absolute)).size > 750000) { results.push({ path: file.relative, status: 'skipped', message: 'File exceeds 750 KB.' }); continue; }
    const original = parseVaultFile(await readFile(file.absolute, 'utf8'), file.relative);
    const hadIdentity = !!original.external_key;
    const matchingRemote = !hadIdentity ? [...remoteByKey.values()].find(note =>
      !localByKey.has(note.external_key) && remoteRelativePath(note, snapshot.projects, projectsDirectory).toLowerCase() === file.relative.toLowerCase()
    ) : null;
    let local = matchingRemote ? { ...original, external_key: matchingRemote.external_key } : ensureVaultIdentity(original);
    const project = resolveProject(local, snapshot.projects, projectsDirectory);
    local = { ...local, project_id: project?.id || null, project_name: project?.name || '' };
    if (localByKey.has(local.external_key)) { results.push({ path: file.relative, status: 'conflict', message: `Duplicate ctrlpanel_key also used by ${localByKey.get(local.external_key).relativePath}.` }); continue; }
    localByKey.set(local.external_key, local);
    if (!hadIdentity && !dryRun) await writeVaultFile(file.absolute, local, original);
    const remote = remoteByKey.get(local.external_key);
    const decision = vaultDecision(local, remote, state.notes[local.external_key]);

    if (dryRun) { results.push({ path: file.relative, project: project?.name || null, status: decision }); continue; }
    try {
      if (decision === 'conflict') {
        const signature = `${remote?.updated_at || 'missing'}:${noteHash(local)}`;
        let copy;
        if (remote && state.notes[local.external_key]?.conflict !== signature) {
          const relative = conflictName(file.relative), absolute = path.join(root, ...relative.split('/'));
          await writeVaultFile(absolute, remoteAsLocal(remote, snapshot.projects), null);
          copy = relative;
        }
        state.notes[local.external_key] = { ...(state.notes[local.external_key] || {}), conflict: signature, path: file.relative };
        results.push({ path: file.relative, status: 'conflict', ...(copy ? { copy } : {}), message: 'Both copies changed; neither was overwritten.' });
        continue;
      }
      if (decision === 'pull') {
        const pulled = { ...remoteAsLocal(remote, snapshot.projects), relativePath: file.relative };
        const targetRelative = remoteRelativePath(remote, snapshot.projects, projectsDirectory);
        const targetAbsolute = path.join(root, ...targetRelative.split('/'));
        if (targetRelative !== file.relative) {
          try { await stat(targetAbsolute); throw new Error(`Cannot move note because ${targetRelative} already exists.`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          await mkdir(path.dirname(targetAbsolute), { recursive: true });
          await rename(file.absolute, targetAbsolute);
        }
        pulled.relativePath = targetRelative;
        pulled.folder = remote.folder || '';
        await writeVaultFile(targetAbsolute, pulled, original);
        state.notes[local.external_key] = stateEntry(pulled);
        results.push({ path: targetRelative, status: 'pulled' });
        continue;
      }
      let saved = remote;
      if (decision === 'create' || decision === 'push') {
        const response = await apiRequest('POST', {}, { ...payload(local), ...(remote ? { expected_updated_at: remote.updated_at } : {}) });
        saved = response.note;
      }
      const synced = { ...local, remote_updated_at: saved.updated_at };
      const serialized = serializeVaultFile(synced, original);
      const current = await readFile(file.absolute, 'utf8');
      if (serialized !== current) await writeFile(file.absolute, serialized, 'utf8');
      state.notes[local.external_key] = stateEntry(synced);
      results.push({ path: file.relative, status: decision === 'unchanged' ? 'unchanged' : decision === 'create' ? 'created' : 'pushed', project: project?.name || null });
    } catch (error) {
      results.push({ path: file.relative, status: 'error', message: error.message });
    }
  }

  for (const remote of remoteByKey.values()) {
    if (localByKey.has(remote.external_key)) continue;
    const relative = remoteRelativePath(remote, snapshot.projects, projectsDirectory);
    const absolute = path.join(root, ...relative.split('/'));
    try {
      await stat(absolute);
      results.push({ path: relative, status: 'conflict', message: 'A different local file already uses the remote destination.' });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!dryRun) {
        const pulled = { ...remoteAsLocal(remote, snapshot.projects), relativePath: relative };
        await writeVaultFile(absolute, pulled, null);
        state.notes[remote.external_key] = stateEntry(pulled);
      }
      results.push({ path: relative, status: dryRun ? 'would-pull' : 'pulled' });
    }
  }

  const status = { checked_at: new Date().toISOString(), vault: root, results };
  await saveState(state);
  if (!dryRun) await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  console.log(JSON.stringify(status, null, 2));
  if (results.some(result => result.status === 'error' || result.status === 'conflict')) process.exitCode = 1;
  return status;
}

let running = false, queued = false, timer;
async function scheduledSync() {
  if (running) { queued = true; return; }
  running = true;
  try { await syncOnce(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally {
    running = false;
    if (queued) { queued = false; clearTimeout(timer); timer = setTimeout(scheduledSync, 250); }
  }
}

await scheduledSync();
if (flags.has('--watch') && !dryRun) {
  console.log(`Watching ${path.resolve(vaultRoot)}. Press Ctrl+C to stop.`);
  try {
    const watcher = watch(path.resolve(vaultRoot), { recursive: true });
    setInterval(scheduledSync, 60000).unref();
    for await (const event of watcher) {
      if (!/\.md$/i.test(event.filename || '') || /\.ctrlpanel-conflict-/.test(event.filename || '')) continue;
      clearTimeout(timer); timer = setTimeout(scheduledSync, 750);
    }
  } catch (error) {
    throw new Error(`Vault watcher stopped: ${error.message}`);
  }
}
