import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeError, isChunkLoadError, shouldAutoReload, shouldPrefetch } from '../src/lib/errors.js';
import { normalizeNote } from '../src/lib/noteShape.js';

test('chunk-load failures are recognised across browsers', () => {
  for (const msg of [
    'Failed to fetch dynamically imported module: https://x/assets/Habits-abc.js',
    'error loading dynamically imported module: https://x/assets/a.js',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'Unable to preload CSS for /assets/x.css',
  ]) assert.equal(isChunkLoadError(new TypeError(msg)), true, msg);
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'join')")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError('Failed to fetch dynamically imported module'), true);
});

test('chunk errors get reload advice; real bugs get "the rest still works"', () => {
  const chunk = describeError(new Error('Failed to fetch dynamically imported module'));
  assert.equal(chunk.chunk, true);
  assert.match(chunk.message, /offline|updated/i);
  const bug = describeError(new Error('boom'));
  assert.equal(bug.chunk, false);
  assert.match(bug.message, /rest of CTRLpanel/i);
});

test('an automatic reload happens at most once per 30 seconds', () => {
  assert.equal(shouldAutoReload(1_000_000, undefined), true);
  assert.equal(shouldAutoReload(1_000_000, null), true);
  assert.equal(shouldAutoReload(1_000_000, 'garbage'), true);
  assert.equal(shouldAutoReload(1_000_000, 999_000), false);
  assert.equal(shouldAutoReload(1_000_000, 975_000), false); // 25s ago
  assert.equal(shouldAutoReload(1_000_000, 970_000), false); // exactly 30s
  assert.equal(shouldAutoReload(1_000_000, 969_999), true); // 30.001s
  assert.equal(shouldAutoReload(1_000_000, 960_000), true); // 40s ago
});

test('page prefetch respects data-saver and slow connections', () => {
  assert.equal(shouldPrefetch(undefined), true);
  assert.equal(shouldPrefetch({ effectiveType: '4g' }), true);
  assert.equal(shouldPrefetch({ saveData: true, effectiveType: '4g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: '2g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: 'slow-2g' }), false);
  assert.equal(shouldPrefetch({ effectiveType: '3g' }), true);
});

test('a partial note row no longer crashes the Knowledge page', () => {
  const partial = normalizeNote({ id: 'n1', title: 'Budget' });
  assert.deepEqual(partial.tags, []);
  assert.deepEqual(partial.aliases, []);
  assert.equal(partial.content, '');
  assert.equal(partial.folder, '');
  assert.equal(partial.pinned, false);
  // The exact expression that crashed: `${n.title} ${n.content} ${n.tags.join(' ')}`
  assert.equal(`${partial.title} ${partial.content} ${partial.tags.join(' ')}`, 'Budget  ');
  const full = { id: 'n2', title: 'T', content: 'c', folder: 'f', tags: ['a', 'b'], aliases: ['x'], pinned: true, updated_at: '2026-01-01' };
  assert.deepEqual(normalizeNote(full), full);
  assert.deepEqual(normalizeNote({ tags: null }).tags, []);
  assert.equal(normalizeNote(undefined).title, '');
});
