import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirtyFiles, formatDirty, versionStamp } from '../scripts/lib/deployGate.mjs';

const repo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

test('dirtyFiles lists modified, staged, renamed and untracked paths, and nothing for a clean tree', () => {
  assert.deepEqual(dirtyFiles(''), []);
  assert.deepEqual(dirtyFiles('\n'), []);
  assert.deepEqual(
    dirtyFiles(' M src/a.js\nM  src/b.js\n?? notes.txt\nR  old.js -> new.js\r\n D gone.js\n'),
    ['src/a.js', 'src/b.js', 'notes.txt', 'old.js -> new.js', 'gone.js'],
  );
});

test('formatDirty caps a long list', () => {
  const files = Array.from({ length: 20 }, (_, i) => `f${i}.js`);
  const text = formatDirty(files, 3);
  assert.equal(text.split('\n').length, 4);
  assert.match(text, /…and 17 more/);
  assert.equal(formatDirty(['one.js']), '  one.js');
});

test('versionStamp records the commit and whether the tree was dirty', () => {
  const stamp = versionStamp({ commit: 'abc123', subject: 'Fix', now: new Date('2026-10-12T12:00:00Z') });
  assert.deepEqual(stamp, { commit: 'abc123', subject: 'Fix', dirty: false, builtAt: '2026-10-12T12:00:00.000Z' });
  assert.equal(versionStamp({ commit: 'x', subject: 'y', dirty: true }).dirty, true);
});

test('the test script and the deploy gate are wired in package.json', () => {
  const pkg = JSON.parse(readFileSync(repo('package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.mjs');
  assert.equal(pkg.scripts.deploy, 'node scripts/deploy.mjs');
  assert.equal(pkg.scripts['deploy:check'], 'node scripts/deploy.mjs --check');
});

test('deploy refuses a dirty tree before building or deploying anything', () => {
  // A throwaway git repo with just the deploy script, so this never touches the real checkout.
  const dir = mkdtempSync(join(tmpdir(), 'deploy-gate-'));
  try {
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
    copyFileSync(repo('scripts/deploy.mjs'), join(dir, 'scripts', 'deploy.mjs'));
    copyFileSync(repo('scripts/lib/deployGate.mjs'), join(dir, 'scripts', 'lib', 'deployGate.mjs'));
    writeFileSync(join(dir, '.env.example'), 'KEY=\n');
    for (const args of [['init', '-q'], ['config', 'user.email', 't@example.test'], ['config', 'user.name', 'T'], ['add', '-A'], ['commit', '-qm', 'base']]) {
      assert.equal(spawnSync('git', args, { cwd: dir }).status, 0, `git ${args[0]}`);
    }
    writeFileSync(join(dir, '.env.example'), 'KEY=changed\n'); // modified: status column is " M", the first line git prints
    writeFileSync(join(dir, 'stray.txt'), 'uncommitted');
    // Don't inherit an override from a deploy that is itself running the tests.
    const env = { ...process.env, ALLOW_DIRTY_DEPLOY: '' };
    const result = spawnSync(process.execPath, ['scripts/deploy.mjs', '--check'], { cwd: dir, encoding: 'utf8', env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /2 uncommitted or untracked files/);
    assert.match(result.stderr, /^ {2}\.env\.example$/m, 'the first path keeps its leading dot');
    assert.match(result.stderr, /^ {2}stray\.txt$/m);
    assert.match(result.stderr, /ALLOW_DIRTY_DEPLOY=1/);
    assert.doesNotMatch(result.stdout, /Build/, 'it stopped before building');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
