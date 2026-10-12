// ============================================================
// Deploy gate:  npm run deploy         build + test + stamp + wrangler deploy
//               npm run deploy:check   everything except the final wrangler deploy
//
// 1. The git tree must be clean (modified, staged and untracked files all block),
//    so production always matches a commit you can roll back to or diff against.
// 2. `npm run build`, then `npm test` — the bundle-size test needs the built dist.
// 3. dist/version.json records the commit, so GET /version.json says what is live.
// 4. Only then `wrangler deploy`.
//
// Emergency override (prints a warning, stamps the build as dirty):
//   ALLOW_DIRTY_DEPLOY=1 npm run deploy
// ============================================================
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirtyFiles, formatDirty, versionStamp } from './lib/deployGate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);

const checkOnly = process.argv.includes('--check');
const allowDirty = process.env.ALLOW_DIRTY_DEPLOY === '1';

const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};
const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) fail(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.trimEnd(); // never trim the start: porcelain lines begin with a status column that may be a space
};
const step = (label, command) => {
  console.log(`\n▶ ${label}`);
  // shell: true resolves npm/npx on Windows; the commands are fixed strings.
  if (spawnSync(command, { stdio: 'inherit', shell: true }).status !== 0) fail(`${label} failed — nothing was deployed.`);
};

if (!existsSync('.git')) fail('Run the deploy from the CTRLpanel git checkout.');

const dirty = dirtyFiles(git('status', '--porcelain'));
if (dirty.length && !allowDirty) {
  fail(
    `The working tree has ${dirty.length} uncommitted or untracked file${dirty.length === 1 ? '' : 's'}:\n${formatDirty(dirty)}\n\n` +
      'Commit them (or add them to .gitignore) so production matches a commit, then deploy again.\n' +
      'In an emergency: ALLOW_DIRTY_DEPLOY=1 npm run deploy',
  );
}
if (dirty.length) console.warn(`\n⚠ ALLOW_DIRTY_DEPLOY=1: deploying ${dirty.length} uncommitted file(s). The build is stamped dirty.`);

const commit = git('rev-parse', 'HEAD');
const subject = git('log', '-1', '--format=%s');
console.log(`Deploying ${commit.slice(0, 7)} — ${subject}`);

step('Build', 'npm run build');
step('Tests', 'npm test');

writeFileSync('dist/version.json', JSON.stringify(versionStamp({ commit, subject, dirty: dirty.length > 0 }), null, 2) + '\n');
console.log('\n✔ Checks passed; dist/version.json written.');

if (checkOnly) {
  console.log('--check: skipping wrangler deploy.');
  process.exit(0);
}
step('Deploy to Cloudflare', 'npx wrangler deploy');
console.log(`\n✔ Deployed ${commit.slice(0, 7)}. Live version: <your domain>/version.json`);
