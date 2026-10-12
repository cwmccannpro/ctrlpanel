// Local-only bridge: filesystem discovery stays off the Worker and browser.
// One-way, config-driven sync of project context files into the CTRLpanel Knowledge Base.
//   node tools/ctrlpanel-file-sync.mjs                    sync every project in the config
//   node tools/ctrlpanel-file-sync.mjs --dry-run          preview (read-only API checks)
//   node tools/ctrlpanel-file-sync.mjs --project "Name"   limit to one project (repeatable)
//   node tools/ctrlpanel-file-sync.mjs --add --name "Name" --root "C:\path" --folder "Projects/Name" [--match "CTRLpanel project"] [--files "README.md,docs/*.md"] [--exclude "X.md"] [--key slug]
import dotenv from 'dotenv';
import { readFile, writeFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFUZED_GUY, collectProject, noteHash, syncDecision } from './contentContext.mjs';

const workspace = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(workspace, '.env.local'), quiet: true });
const statePath = path.join(workspace, '.context-sync-state.local');
const lockPath = path.join(workspace, '.context-sync-lock.local');
const logPath = path.join(workspace, '.context-sync-status.local');

function parseArgs(argv) {
  const flags = new Set(), values = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (inline !== undefined) (values[k] ??= []).push(inline);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) (values[k] ??= []).push(argv[++i]);
    else flags.add(k);
  }
  return { flags, values, one: k => values[k]?.at(-1) };
}
const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(workspace, args.one('config') || 'tools/context-projects.json');
const list = v => (v || []).flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function loadConfig() {
  try { return JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Could not read ${configPath}: ${e.message}`);
    // Legacy fallback: only the selected channel root from .env.local.
    if (!process.env.CTRLPANEL_CONTEXT_ROOT) throw new Error(`Create ${configPath} (see tools/context-projects.example.json).`);
    return { projects: [{ ...CONFUZED_GUY, root: process.env.CTRLPANEL_CONTEXT_ROOT, project: null }] };
  }
}

async function api(method, { params = {}, body } = {}) {
  const base = process.env.CTRLPANEL_URL, key = process.env.CTRLPANEL_CONTEXT_KEY;
  if (!base || !key) throw new Error('Set CTRLPANEL_URL and CTRLPANEL_CONTEXT_KEY in .env.local.');
  const url = new URL('/api/knowledge/notes', base);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote context sync requires HTTPS.');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const err = new Error(`Context API ${response.status}: ${data.error || 'Request failed'}`); err.status = response.status; throw err; }
  return data;
}

async function addProject() {
  const name = args.one('name'), root = args.one('root'), folder = args.one('folder');
  if (!name || !root || !folder) throw new Error('--add needs --name, --root and --folder.');
  let config;
  try { config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')); } catch (e) { if (e.code !== 'ENOENT') throw e; config = { projects: [] }; }
  const key = args.one('key') || slug(name);
  if (config.projects.some(p => p.name.toLowerCase() === name.toLowerCase() || p.key === key)) throw new Error(`A project named "${name}" or keyed "${key}" already exists in the config.`);
  const entry = { name, key, root: path.resolve(root), folder, project: args.one('match') || null, kind: args.one('kind') || 'Project' };
  if (list(args.values.files).length) entry.files = list(args.values.files);
  if (list(args.values.exclude).length) entry.exclude = list(args.values.exclude);
  await collectProject(entry); // validates the root before saving
  config.projects.push(entry);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Added "${name}" to ${configPath}. Preview it with --dry-run --project "${name}", then sync with --project "${name}".`);
}

const PROJECT_PENDING = 'saved without project link: the deployed database needs migrations/20261005-project-knowledge-vault-sync.sql for project-aware writes';
let projectWritesUnavailable = false;
async function syncNote(note, state, dryRun) {
  const { notes: found } = await api('GET', { params: { external_key: note.external_key } });
  const remote = found[0], decision = syncDecision(note, remote, state[note.external_key]);
  const base = { title: note.title, folder: note.folder, external_key: note.external_key };
  if (decision === 'conflict') return { ...base, status: 'conflict', message: 'Knowledge note was edited outside the sync. Source retained; reconcile both copies before continuing.' };
  // Attach to the matching project only when the note has no project yet; never override a manual assignment.
  const attach = Boolean(note.project_id) && (!remote || !remote.project_id) && !projectWritesUnavailable;
  const pending = Boolean(note.project_id) && (!remote || !remote.project_id) && projectWritesUnavailable ? PROJECT_PENDING : undefined;
  const kept = note.project_id && remote?.project_id && remote.project_id !== note.project_id ? 'kept existing project assignment' : undefined;
  const status = decision === 'unchanged' ? (attach ? 'attached' : 'unchanged') : decision;
  const message = kept || pending;
  if (dryRun) return { ...base, status: `would ${({ unchanged: 'skip (unchanged)', attached: 'attach to project' })[status] || status}`, ...(message ? { message } : {}) };
  if (status === 'unchanged') { state[note.external_key] = noteHash(note); return { ...base, status, ...(message ? { message } : {}) }; }
  const { project_id, ...fields } = note;
  const post = withProject => api('POST', { body: { ...fields, ...(withProject ? { project_id } : {}), ...(remote ? { expected_updated_at: remote.updated_at } : {}) } });
  try {
    try { await post(attach); }
    catch (e) {
      // The deployed database may not have the project-aware migration yet:
      // save the note unassigned and stop sending project_id for this run.
      if (!(attach && e.status === 503 && /migration/i.test(e.message))) throw e;
      projectWritesUnavailable = true;
      if (status === 'attached') return { ...base, status: 'unchanged', message: PROJECT_PENDING };
      await post(false);
      state[note.external_key] = noteHash(note);
      return { ...base, status, message: PROJECT_PENDING };
    }
  } catch (e) {
    if (e.status === 409) return { ...base, status: 'conflict', message: 'Note changed during sync (409). Source retained; it will be retried next run.' };
    throw e;
  }
  state[note.external_key] = noteHash(note);
  return { ...base, status, ...(message ? { message } : {}) };
}

async function run() {
  if (args.flags.has('add')) return addProject();
  const offline = args.flags.has('offline'), dryRun = args.flags.has('dry-run') || offline;
  const config = await loadConfig();
  const only = list(args.values.project).map(s => s.toLowerCase());
  const projects = config.projects.filter(p => p.enabled !== false && (!only.length || only.includes(p.name.toLowerCase()) || only.includes(p.key)));
  if (only.length && !projects.length) throw new Error(`No enabled project matches ${only.join(', ')}.`);
  const keys = new Set(config.projects.map(p => p.key));
  if (keys.size !== config.projects.length) throw new Error('Project keys must be unique.');

  let lock;
  if (!dryRun) {
    // A lock expires after 15 minutes so a killed process does not permanently stop updates.
    try { lock = await open(lockPath, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const timestamp = Number(await readFile(lockPath, 'utf8').catch(() => '0'));
      if (Date.now() - timestamp < 15 * 60000) { console.log('Another context sync is running; skipped.'); return; }
      await unlink(lockPath); lock = await open(lockPath, 'wx');
    }
    await lock.writeFile(String(Date.now()));
  }
  try {
    let state = {};
    try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let index = [];
    if (!offline) {
      const data = await api('GET', { params: { external_key: '__ctrlpanel_project_index__', include_projects: '1' } });
      index = data.projects || [];
    }
    const report = [];
    for (const project of projects) {
      const entry = { name: project.name, folder: project.folder, root: project.root, ctrlpanel_project: null, notes: [], skipped: [] };
      report.push(entry);
      if (project.project) {
        const match = index.find(p => p.name.trim().toLowerCase() === String(project.project).trim().toLowerCase());
        entry.ctrlpanel_project = match ? { name: match.name, id: match.id } : { name: project.project, id: null, message: offline ? 'not resolved (offline)' : 'no owned project with this name; notes left unassigned' };
      }
      let collected;
      try { collected = await collectProject(project, { globalExclude: config.globalExclude || [], projectId: entry.ctrlpanel_project?.id || undefined }); }
      catch (e) { entry.error = e.message; continue; }
      entry.skipped = collected.skipped;
      if (!collected.notes.length) entry.message = 'No context files found; nothing to sync.';
      for (const note of collected.notes) {
        if (offline) { entry.notes.push({ title: note.title, folder: note.folder, external_key: note.external_key, bytes: Buffer.byteLength(note.content), status: 'preview' }); continue; }
        try { entry.notes.push(await syncNote(note, state, dryRun)); }
        catch (e) { entry.notes.push({ title: note.title, folder: note.folder, external_key: note.external_key, status: 'error', message: e.message }); }
        if (!dryRun) await writeFile(statePath, JSON.stringify(state, null, 2));
      }
    }
    const summary = {};
    for (const n of report.flatMap(r => r.notes)) summary[n.status] = (summary[n.status] || 0) + 1;
    summary.skipped_files = report.reduce((s, r) => s + r.skipped.length, 0);
    summary.project_errors = report.filter(r => r.error).length;
    const status = { checked_at: new Date().toISOString(), mode: dryRun ? (offline ? 'preview-offline' : 'dry-run') : 'sync', config: configPath, summary, projects: report };
    if (!dryRun && !only.length) await writeFile(logPath, JSON.stringify(status, null, 2));
    else if (!dryRun) {
      // Partial runs update only their own projects in the status file.
      let previous = {}; try { previous = JSON.parse(await readFile(logPath, 'utf8')); } catch {}
      const merged = [...(previous.projects || []).filter(p => !report.some(r => r.name === p.name)), ...report];
      await writeFile(logPath, JSON.stringify({ ...status, projects: merged }, null, 2));
    }
    console.log(JSON.stringify(status, null, 2));
    if (summary.error || summary.conflict || summary.project_errors) process.exitCode = 1;
  } finally { if (lock) { await lock.close(); await unlink(lockPath); } }
}
await run();
