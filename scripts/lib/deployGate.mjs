// Pure helpers for scripts/deploy.mjs (kept import-free so node --test can load them).

// `git status --porcelain` output -> the paths that make the tree dirty (modified, staged, or untracked).
export function dirtyFiles(porcelain) {
  return String(porcelain || '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim());
}

export function formatDirty(files, limit = 15) {
  const shown = files.slice(0, limit).map((f) => `  ${f}`);
  if (files.length > limit) shown.push(`  …and ${files.length - limit} more`);
  return shown.join('\n');
}

// Written to dist/version.json so "what is live?" is answered by GET /version.json.
export function versionStamp({ commit, subject, dirty = false, now = new Date() }) {
  return { commit, subject, dirty, builtAt: now.toISOString() };
}
