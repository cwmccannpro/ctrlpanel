import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectProject, hash, labelFor, MAX_BYTES, noteHash } from '../tools/contentContext.mjs';
import { projectFileDecision, writeProjectFile } from '../tools/projectContextSync.mjs';

test('config-driven projects select shallow Markdown, honour excludes and skip unsafe files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ctrl-projects-'));
  try {
    await writeFile(path.join(root, 'README.md'), '# Readme\nSee AGENTS.md.');
    await writeFile(path.join(root, 'AGENTS.md'), '# Agents');
    await writeFile(path.join(root, 'ONYX_CONTEXT.md'), '# Live two-way note');
    await writeFile(path.join(root, 'EMPTY.md'), '   ');
    await writeFile(path.join(root, 'LEAK.md'), 'API_KEY=abcdefghijklmnopqrstuvwxyz1234');
    await writeFile(path.join(root, 'HUGE.md'), 'x'.repeat(MAX_BYTES + 10));
    await writeFile(path.join(root, '.env'), 'PASSWORD=abcdefghijklmnopqrstuvwxyz');
    await mkdir(path.join(root, 'docs')); await writeFile(path.join(root, 'docs', 'setup-guide.md'), '# Setup');
    await mkdir(path.join(root, 'node_modules')); await writeFile(path.join(root, 'node_modules', 'x.md'), '# dep');
    const project = { name: 'Demo', key: 'demo', root, folder: 'Projects/Demo', files: ['README.md', 'AGENTS.md', '*CONTEXT*.md', 'EMPTY.md', 'LEAK.md', 'HUGE.md', '.env', 'docs/*.md', '*/x.md', 'MISSING.md'] };
    const { notes, skipped } = await collectProject(project, { globalExclude: ['ONYX_CONTEXT.md'], projectId: '11111111-1111-4111-8111-111111111111' });
    assert.deepEqual(notes.map(n => n.external_key), ['files/demo/index', 'files/demo/agents.md', 'files/demo/docs/setup-guide.md', 'files/demo/readme.md']);
    assert.ok(notes.every(n => n.folder === 'Projects/Demo' && n.project_id));
    assert.equal(notes.find(n => n.title === 'Demo - Setup Guide').title, 'Demo - Setup Guide');
    assert.match(notes.find(n => n.title === 'Demo - README').content, /\[\[Projects\/Demo\/Demo - Agents\]\]/);
    const reasons = Object.fromEntries(skipped.map(s => [s.file, s.reason]));
    assert.equal(reasons['ONYX_CONTEXT.md'], 'excluded by config');
    assert.equal(reasons['EMPTY.md'], 'empty');
    assert.match(reasons['LEAK.md'], /credentials/);
    assert.match(reasons['HUGE.md'], /too large/);
    assert.equal(reasons['MISSING.md'], 'not found');
    assert.ok(!notes.some(n => /node_modules|\.env/.test(n.external_key)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('labels derive from file names unless overridden', () => {
  assert.equal(labelFor('CLAUDE.md'), 'Workflow');
  assert.equal(labelFor('FEEDBACK_LOOP.md'), 'Feedback Loop');
  assert.equal(labelFor('CRM Layout.md'), 'CRM Layout');
  assert.equal(labelFor('.agents/skills/x.md', { '.agents/skills/x.md': 'Skill' }), 'Skill');
});

test('two-way project context reuses the legacy key and preserves both edits on divergence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ctrl-projects-'));
  try {
    const source = path.join(root, 'CHANNEL.md');
    await writeFile(source, '\uFEFF# Channel\r\n\r\nOriginal\r\n');
    const project = { name: 'Demo', key: 'demo', root, folder: 'Projects/Demo', files: ['README.md'] };
    const readProjectFile = async () => (await collectProject({ ...project, twoWayFiles: ['CHANNEL.md'] })).notes[1];
    const legacy = (await collectProject({ ...project, files: ['CHANNEL.md'] })).notes[1];
    const note = await readProjectFile();
    assert.equal(note.external_key, legacy.external_key);
    assert.equal(projectFileDecision(note, null), 'create');
    assert.equal(projectFileDecision(note, legacy, noteHash(legacy)), 'update');
    assert.equal(projectFileDecision(note, { ...legacy, content: `${legacy.content}Browser edits` }, noteHash(legacy)), 'conflict');

    const baseline = { bodyHash: hash(note.twoWay.body) };
    const remote = { ...legacy, content: '# Channel\n\nBrowser update\n' };
    assert.equal(projectFileDecision(note, remote, baseline), 'pull');
    await writeProjectFile(note.twoWay, remote.content);
    assert.equal(await readFile(source, 'utf8'), '\uFEFF# Channel\r\n\r\nBrowser update\r\n');
    const pulled = await readProjectFile();
    assert.equal(projectFileDecision(pulled, remote, baseline), 'unchanged');
    assert.equal(projectFileDecision(pulled, { ...remote, content: note.twoWay.body }, baseline), 'update');
    assert.equal(projectFileDecision(pulled, { ...remote, content: 'Another browser edit' }, baseline), 'conflict');
    await assert.rejects(writeProjectFile(note.twoWay, 'another edit'), /Local file changed/);
    assert.equal(await readFile(source, 'utf8'), '\uFEFF# Channel\r\n\r\nBrowser update\r\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
