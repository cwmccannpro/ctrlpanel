import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectProject, labelFor, MAX_BYTES } from '../tools/contentContext.mjs';

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
