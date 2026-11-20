import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectContext, containsSecret, syncDecision, noteHash } from '../tools/contentContext.mjs';
import { fitCamera, projectStar, starPosition } from '../src/lib/knowledgeGraph.js';
import { buildKnowledgeTree, filterKnowledgeNotes, knowledgeFolderPaths } from '../src/lib/knowledgeTree.js';

test('context discovery excludes fluff and empty files; references build stable cross-links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ctrl-context-'));
  try {
    await writeFile(path.join(root, 'STYLE.md'), '# Visual identity\nRead EDITORIAL.md before writing.');
    await writeFile(path.join(root, 'EDITORIAL.md'), '# Voice\nSpecific editorial rules.');
    await writeFile(path.join(root, 'LEARNINGS.md'), '');
    await writeFile(path.join(root, 'README.md'), 'fluff');
    await writeFile(path.join(root, '.env'), 'password');
    await mkdir(path.join(root, 'projects')); await writeFile(path.join(root, 'projects/script.md'), 'script');
    const notes = await collectContext(root);
    assert.equal(notes.length, 3);
    assert.deepEqual(notes.map(n => n.external_key).sort(), ['files/confuzed-guy/editorial.md', 'files/confuzed-guy/index', 'files/confuzed-guy/style.md']);
    assert.match(notes.find(n => n.title.endsWith('Style')).content, /\[\[Projects\/Content Engine\/The Confuzed Guy\/The Confuzed Guy - Editorial\]\]/);
    assert.equal(new Set(notes.map(n => n.external_key)).size, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('file sync protects remote content and metadata, with idempotent retries', () => {
  const remote = { title: 'Style', folder: 'Channel', content: 'old' }, note = { ...remote, content: 'new' };
  assert.equal(syncDecision(note, undefined), 'create');
  assert.equal(syncDecision(remote, remote), 'unchanged');
  assert.equal(syncDecision(note, remote, noteHash(remote)), 'update');
  assert.equal(syncDecision(note, { ...remote, content: 'browser edit' }, noteHash(remote)), 'conflict');
  assert.equal(syncDecision(note, { ...remote, title: 'Renamed' }, noteHash(remote)), 'conflict');
  assert.equal(syncDecision(note, remote), 'conflict');
});
test('credential guard rejects keys while allowing references to environment variables', () => {
  assert.equal(containsSecret('Use FAL_KEY from `.env`.'), false);
  assert.equal(containsSecret('ctpk_' + 'a'.repeat(48)), true);
  assert.equal(containsSecret('-----BEGIN PRIVATE KEY-----'), true);
  assert.equal(containsSecret('API_KEY=abcdefghijklmnopqrstuvwxyz1234'), true);
});
test('knowledge tree preserves nested folders, counts descendants, and ranks pinned notes first', () => {
  const notes = [
    { id: 'a', title: 'Alpha', folder: 'Work/Research', content: 'market notes', tags: [], pinned: false },
    { id: 'b', title: 'Brief', folder: 'Work', content: '', tags: ['strategy'], pinned: true },
    { id: 'c', title: 'Home', folder: '', content: 'personal', tags: [], pinned: false },
  ];
  const tree = buildKnowledgeTree(notes);
  assert.equal(tree.count, 3);
  assert.equal(tree.notes[0].id, 'c');
  assert.equal(tree.folders[0].path, 'Work');
  assert.equal(tree.folders[0].count, 2);
  assert.equal(tree.folders[0].notes[0].id, 'b');
  assert.equal(tree.folders[0].folders[0].path, 'Work/Research');
  assert.deepEqual(knowledgeFolderPaths(notes), ['Work', 'Work/Research']);
  assert.deepEqual(filterKnowledgeNotes(notes, 'strategy').map(note => note.id), ['b']);
  assert.deepEqual(filterKnowledgeNotes(notes, 'research').map(note => note.id), ['a']);
});

test('stars survive renames, move with their folder, and orbit in perspective', () => {
  const note = { id: 'stable', title: 'First', folder: 'Research' };
  const point = starPosition(note);
  assert.deepEqual(starPosition({ ...note, title: 'Renamed' }), point);
  const moved = starPosition({ ...note, folder: 'Ideas' });
  assert.notDeepEqual(moved, point);
  const camera = fitCamera([point, moved]);
  for (const [width, height] of [[375, 660], [960, 540]]) {
    for (const yaw of [0, 1, 3]) {
      const result = projectStar(point, { ...camera, yaw }, width, height);
      assert.ok(result.x > 0 && result.x < width && result.y > 0 && result.y < height);
    }
  }
  assert.notDeepEqual(projectStar(point, camera, 400, 600), projectStar(point, { ...camera, yaw: 1 }, 400, 600));
  assert.equal(projectStar([0,0,200], { ...camera, target:[0,0,0], distance:100 }, 800, 600), null);
});
test('explicit empty nested folders survive an empty note list', () => {
  const tree = buildKnowledgeTree([], ['Ideas/Research']);
  assert.equal(tree.folders[0].folders[0].path, 'Ideas/Research');
  assert.equal(tree.count, 0);
});
