import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => server.close());
const { wikiLinks, resolveNote, graphEdges } = await server.ssrLoadModule('/src/lib/knowledge.js');
const notes = [
  { id: 'a', title: 'Brief', folder: 'Work', content: '[[Decision]] [[Decision|why]] [[Missing]] [[Brief]]', tags: [], aliases: [] },
  { id: 'b', title: 'Decision', folder: '', content: '', tags: [], aliases: ['Old decision'] },
];
test('wiki links handle aliases and headings but exclude code examples', () => {
  assert.deepEqual(wikiLinks('[[Brief#Context|Read]] `[[ignore]]`\n```md\n[[ignore too]]\n```'), ['Brief']);
});
test('resolve IDs, paths, case-insensitive titles and aliases after renaming', () => {
  for (const target of ['a', 'work/brief', 'BRIEF']) assert.equal(resolveNote(notes, target).id, 'a');
  assert.equal(resolveNote(notes, 'Old decision').id, 'b');
  assert.equal(resolveNote(notes, 'Missing'), undefined);
});
test('graph deduplicates links and excludes missing notes and self links', () => {
  assert.deepEqual(graphEdges(notes), [{ source: 'a', target: 'b' }]);
});
test('Markdown renders GFM tables, tasks, code, and wiki links without executing HTML', async () => {
  const { default: Editor } = await server.ssrLoadModule('/src/components/KnowledgeEditor.jsx');
  const note = { ...notes[0], content: '# Context\n\n- [x] Reviewed\n\n| Key | Value |\n| --- | --- |\n| Status | Ready |\n\n[[Decision]]\n\n<script>alert(1)</script>\n\n```js\nconst x = 1;\n```' };
  const html = renderToStaticMarkup(React.createElement(Editor, { note, notes, projects: [], onChange() {}, onSave() {}, onDelete() {}, onOpen() {} }));
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /class="kb-wikilink"/);
  assert.match(html, /language-js/);
  assert.doesNotMatch(html, /<script>/);
});
test('project graph only displays edges between visible notes', async () => {
  const { default: Graph } = await server.ssrLoadModule('/src/components/KnowledgeGraph.jsx');
  const html = renderToStaticMarkup(React.createElement(Graph, { notes: [notes[0]], allNotes: notes, onSelect() {} }));
  assert.match(html, /1 notes · 0 links/);
  assert.doesNotMatch(html, /<line /);
});
