import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const hash = content => createHash('sha256').update(content).digest('hex');
export const noteHash = note => hash(JSON.stringify([note.title, note.folder, note.content]));
export const MAX_BYTES = 750 * 1024;

// Friendly labels for well-known context files. Unknown files get a label
// derived from their file name (FEEDBACK_LOOP.md -> "Feedback Loop").
export const CONTEXT_FILES = {
  'CLAUDE.MD': 'Workflow', 'CHANNEL.MD': 'Channel', 'EDITORIAL.MD': 'Editorial',
  'STYLE.MD': 'Style', 'LEARNINGS.MD': 'Learnings', 'AUTOMATION.MD': 'Automation', 'LONGFORM.MD': 'Longform',
};
export const LABELS = {
  ...CONTEXT_FILES, 'AGENTS.MD': 'Agents', 'AGENT.MD': 'Agent', 'GEMINI.MD': 'Gemini', 'README.MD': 'README',
  'MASTER_CONTROLLER_PROMPT.MD': 'Master Controller Prompt', 'SETUP_INSTRUCTIONS.MD': 'Setup Instructions',
  'INSTAGRAM.MD': 'Instagram', 'TIKTOK.MD': 'TikTok',
};
// Used when a project entry does not list its own files.
export const DEFAULT_FILES = [
  'CLAUDE.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md', 'README.md', 'CHANNEL.md', 'EDITORIAL.md', 'STYLE.md',
  'LEARNINGS.md', 'AUTOMATION.md', 'LONGFORM.md', '*CONTEXT*.md', 'MASTER_CONTROLLER_PROMPT.md', 'SETUP_INSTRUCTIONS.md',
];
const BLOCKED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ssr', '.wrangler', '.obsidian', '.trash', '__pycache__', '.venv', 'venv']);
const MARKDOWN = /\.(md|markdown)$/i;
const MAX_DEPTH = 3;

export const CONFUZED_GUY = {
  name: 'The Confuzed Guy', key: 'confuzed-guy', folder: 'Projects/Content Engine/The Confuzed Guy', kind: 'Channel',
  files: ['CLAUDE.md', 'CHANNEL.md', 'EDITORIAL.md', 'STYLE.md', 'LEARNINGS.md', 'AUTOMATION.md', 'LONGFORM.md'],
  scope: 'Only operational context is included; scripts, uploads, media, templates, reports, credentials, other channels, and Viridian are excluded.',
};

export function globToRegex(pattern) {
  const body = pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${body}$`, 'i');
}
const titleWord = w => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase());
export function labelFor(rel, overrides = {}) {
  const override = Object.entries(overrides).find(([k]) => k.toLowerCase() === rel.toLowerCase());
  if (override) return override[1];
  const base = path.posix.basename(rel);
  return LABELS[base.toUpperCase()] || base.replace(MARKDOWN, '').split(/[\s_-]+/).filter(Boolean).map(titleWord).join(' ');
}

// Expand one relative pattern ("README.md", "docs/*.md"). Wildcard segments
// never enter dot-folders or dependency/build folders.
async function expand(root, segs, prefix = []) {
  if (!segs.length) return [];
  const [seg, ...rest] = segs, wild = seg.includes('*'), re = globToRegex(seg);
  let entries;
  try { entries = await readdir(path.join(root, ...prefix), { withFileTypes: true }); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return []; throw e; }
  const out = [];
  for (const e of entries) {
    if (!re.test(e.name) || (wild && e.name.startsWith('.')) || BLOCKED_DIRS.has(e.name.toLowerCase())) continue;
    if (rest.length) { if (e.isDirectory() || e.isSymbolicLink()) out.push(...await expand(root, rest, [...prefix, e.name])); }
    else if (e.isFile() || e.isSymbolicLink()) out.push([...prefix, e.name].join('/'));
  }
  return out;
}

// Read only explicitly selected, shallow Markdown context from one project root,
// following canonical symlinks. Returns notes plus a list of skipped files.
export async function collectProject(project, { globalExclude = [], projectId } = {}) {
  const { root, folder, name } = project;
  if (!root || !folder || !name || !project.key) throw new Error('Each project needs name, key, root and folder.');
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Project root not found: ${root}`);
  const explicit = Array.isArray(project.files) && project.files.length > 0;
  const patterns = explicit ? project.files : DEFAULT_FILES;
  const excludes = [...globalExclude, ...(project.exclude || [])].map(p => globToRegex(p.replace(/\\/g, '/')));
  const seen = new Set(), selected = [], skipped = [];
  for (const raw of patterns) {
    const pattern = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const segs = pattern.split('/');
    if (path.isAbsolute(raw) || segs.includes('..') || segs.length > MAX_DEPTH) { skipped.push({ file: raw, reason: `invalid pattern (relative, at most ${MAX_DEPTH} levels)` }); continue; }
    const matches = await expand(root, segs);
    if (!matches.length && explicit && !pattern.includes('*')) skipped.push({ file: pattern, reason: 'not found' });
    for (const rel of matches) {
      if (seen.has(rel.toLowerCase())) continue;
      seen.add(rel.toLowerCase());
      const base = path.posix.basename(rel), skip = reason => skipped.push({ file: rel, reason });
      if (excludes.some(re => re.test(rel) || re.test(base))) { skip('excluded by config'); continue; }
      if (/^\.env/i.test(base) || !MARKDOWN.test(base)) { skip('not a Markdown context file'); continue; }
      const source = path.join(root, ...rel.split('/'));
      let canonical, size;
      try { canonical = await realpath(source); const s = await stat(canonical); if (!s.isFile()) { skip('not a file'); continue; } size = s.size; }
      catch (e) { skip(`unreadable (${e.code || e.message})`); continue; }
      if (size > (project.maxBytes || MAX_BYTES)) { skip(`too large (${Math.round(size / 1024)} KB > ${Math.round((project.maxBytes || MAX_BYTES) / 1024)} KB)`); continue; }
      const content = (await readFile(canonical, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
      if (!content) { skip('empty'); continue; }
      if (containsSecret(content)) { skip('appears to contain credentials; remove them before syncing'); continue; }
      selected.push({ rel, base, source, canonical, content });
    }
  }
  selected.sort((a, b) => a.rel.localeCompare(b.rel));
  const used = new Set();
  for (const f of selected) {
    let label = labelFor(f.rel, project.labels);
    if (used.has(label.toLowerCase())) label = f.rel.replace(MARKDOWN, '');
    used.add(label.toLowerCase()); f.label = label;
  }
  const kind = project.kind || 'Project', indexTitle = project.indexTitle || name;
  const noteTitle = label => `${name} - ${label}`, notePath = label => `${folder}/${noteTitle(label)}`;
  const rank = f => { const i = Object.keys(CONTEXT_FILES).indexOf(f.base.toUpperCase()); return i < 0 ? 100 : i; };
  const ordered = [...selected].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  const extra = projectId ? { project_id: projectId } : {};
  const notes = selected.map(f => {
    // A real file reference establishes a connection; shared vocabulary alone does not.
    const upper = f.content.toUpperCase();
    const references = ordered.filter(o => o !== f && upper.includes(o.base.toUpperCase())).map(o => notePath(o.label));
    const related = [indexTitle, ...references];
    return { external_key: `files/${project.key}/${f.rel.toLowerCase().replace(/\s+/g, '-')}`, title: noteTitle(f.label), folder, ...extra,
      content: `${f.content}\n\n---\n\n## Connected context\n\n${related.map(t => `- [[${t}]]`).join('\n')}\n\n## Linked source\n\nSource: \`${f.source}\`\n\n${f.canonical !== f.source ? `Canonical file: \`${f.canonical}\`\n\n` : ''}This note follows the local file. Edit the source for lasting changes. Changes made here pause synchronization for this note until reconciled.\n` };
  });
  if (notes.length && project.index !== false) {
    const scope = project.scope || 'Only curated context documents are included; scripts, credentials, media, exports, dependencies, and other projects are excluded.';
    notes.unshift({ external_key: `files/${project.key}/index`, title: indexTitle, folder, ...extra,
      content: `# ${indexTitle}\n\n${kind} context linked from \`${root}\`. ${scope}\n\n## ${kind} context\n\n${ordered.map(f => `- [[${notePath(f.label)}|${f.label}]]`).join('\n')}\n\nSource files remain authoritative. Changes are synchronized one way by the daily CTRLpanel context sync task on this computer.\n` });
  }
  return { notes, skipped };
}

// Backward-compatible single-channel entry point.
export async function collectContext(root) {
  return (await collectProject({ ...CONFUZED_GUY, root })).notes;
}

export function containsSecret(content) {
  return /\b(?:sk-ant-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{32,}|AIza[a-zA-Z0-9_-]{30,}|ctpk_[a-f0-9]{48}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(content)
    || /^\s*(?:[A-Z_]*(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SECRET|SERVICE_ROLE_KEY)|PASSWORD)\s*[:=]\s*["']?(?!\$|<|your[-_ ]|os\.|process\.|None|false|true)[a-zA-Z0-9_+/.=-]{20,}/mi.test(content);
}

// Refuse to clobber browser edits or adopt an unrelated existing note.
export function syncDecision(note, remote, lastHash) {
  if (!remote) return 'create';
  if (remote.content === note.content && remote.title === note.title && remote.folder === note.folder) return 'unchanged';
  if (!lastHash || noteHash(remote) !== lastHash) return 'conflict';
  return 'update';
}
