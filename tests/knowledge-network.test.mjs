import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectContext, containsSecret, syncDecision, noteHash } from '../tools/contentContext.mjs';
import { fitGraph, layoutGraph } from '../src/lib/knowledgeGraph.js';
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
test('force graph is deterministic, deduplicates undirected links, and excludes outside nodes', () => {
  const notes = ['a', 'b', 'c'].map(id => ({ id }));
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'a', target: 'outside' }];
  const graph = layoutGraph(notes, edges);
  assert.deepEqual(graph.points, layoutGraph([...notes].reverse(), edges).points);
  assert.equal(graph.degree.a, 1); assert.equal(graph.degree.c, 0);
  assert.equal(graph.edges.length, 1);
  assert.ok(Math.hypot(graph.points.a.x - graph.points.b.x, graph.points.a.y - graph.points.b.y) > 20);
  for (const p of Object.values(graph.points)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const camera = fitGraph(graph.points);
  for (const p of Object.values(graph.points)) {
    assert.ok(p.x * camera.zoom + camera.x > 50 && p.x * camera.zoom + camera.x < 750);
    assert.ok(p.y * camera.zoom + camera.y > 50 && p.y * camera.zoom + camera.y < 530);
  }
  assert.deepEqual(fitGraph({}), { zoom: 1, x: 0, y: 0 });
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
