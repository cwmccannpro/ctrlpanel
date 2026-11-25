import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectCrmPath } from '../src/lib/projectRoutes.js';
import { sidebarNavigation } from '../src/lib/sidebarNavigation.js';
import { contextFolderCatalog, contextFolderTarget, contextTreePath, projectFolderPath } from '../src/lib/contextFolders.js';
import { buildKnowledgeTree } from '../src/lib/knowledgeTree.js';
import { DEFAULT_PROJECT_LAYOUT, moveProjectWidget, projectLayout, projectWidgetHeights } from '../src/lib/projectDashboard.js';
import { sheetCrmPriorities } from '../src/lib/projectCrmPriority.js';

test('legacy CRM links lead to the project or the unassigned CRM view', () => {
  const projects = [{ id: 'one', crm_board_id: 'linked' }];
  assert.equal(projectCrmPath(projects, 'linked'), '/projects/one/crm');
  assert.equal(projectCrmPath(projects, 'loose'), '/projects?view=crm&board=loose');
  assert.equal(sidebarNavigation({ projects }).folders.some((item) => item.id === 'folder:crm'), false);
});

test('Context keeps one folder per project, including empty projects and duplicate names', () => {
  const projects = [{ id: 'first', name: 'Launch' }, { id: 'second', name: 'Launch' }];
  const note = { id: 'note', title: 'Draft', folder: 'Marketing', project_id: 'first' };
  const preferences = { 'contextFolders-second': { Plans: true } };
  const catalog = contextFolderCatalog(projects, preferences);
  const tree = buildKnowledgeTree([{ ...note, folder: contextTreePath(note) }], catalog.paths, catalog.names);
  const [first, second] = tree.folders[0].folders;
  assert.deepEqual([first.name, first.count, second.name, second.count], ['Launch', 1, 'Launch', 0]);
  assert.equal(second.folders[0].name, 'Plans');
  assert.deepEqual(contextFolderTarget(second.folders[0].path), { project_id: 'second', folder: 'Plans' });
  assert.deepEqual(contextFolderTarget('', 'first'), { project_id: 'first', folder: '' });
  assert.deepEqual(contextFolderCatalog(projects, preferences, 'first').paths, [projectFolderPath('first')]);
  assert.equal(note.folder, 'Marketing');
});

test('project widgets can be added, dragged between columns, reordered, and removed', () => {
  assert.deepEqual(projectLayout(undefined), DEFAULT_PROJECT_LAYOUT);
  assert.deepEqual(projectLayout([['crm', 'unknown'], ['crm', 'services']]), [['crm'], ['services']]);
  let layout = moveProjectWidget(DEFAULT_PROJECT_LAYOUT, 'charter', 0);
  layout = moveProjectWidget(layout, 'charter', 0, 'crm');
  layout = moveProjectWidget(layout, 'services', 0, 'upcoming');
  layout = moveProjectWidget(layout, 'upcoming');
  assert.deepEqual(layout, [['charter', 'crm', 'services'], []]);
  assert.deepEqual(DEFAULT_PROJECT_LAYOUT, [['crm', 'upcoming'], ['services']]);
});

test('widget heights save independently and older layouts use automatic height', () => {
  assert.deepEqual(projectWidgetHeights(), {});
  assert.deepEqual(projectWidgetHeights({ crm: 280.6, upcoming: 30, services: 1200, canvas: null, obsolete: 300 }),
    { crm: 281, upcoming: 124, services: 900 });
});

test('project CRM priorities use dates, urgency, lead temperature, and open status', () => {
  const headers = ['Company Name', 'Next Follow-up Date', 'Priority', 'Stage', 'Lead Temperature', 'Last Contacted'];
  const rows = [
    ['Today', '11/25/2026', 'High', 'Open', '', ''],
    ['Late', '2026-11-23', 'Urgent', 'Open', '', ''],
    ['Future', '11/26/2026', 'Urgent', 'Open', '', ''],
    ['Closed', '11/24/2026', 'Urgent', 'Closed Won', '', ''],
    ['Cadence', '', '', 'Open', 'Hot', 'Nov 20, 2026'],
    ['Recent', '', '', 'Open', 'Hot', 'Nov 24, 2026'],
    ['Undated', '', 'High', 'Open', '', ''],
    ['Invalid date', '2026-11-31', 'High', 'Open', '', ''],
  ].map((cells, index) => ({ row: index + 2, cells }));
  const now = new Date(2026, 10, 25);
  const result = sheetCrmPriorities({ headers, rows }, now);
  assert.deepEqual(result.rows.map(({ name, label }) => [name, label]), [
    ['Late', 'Overdue'], ['Today', 'Due today'], ['Undated', 'High priority'], ['Cadence', '5d since contact'],
  ]);
  assert.equal(result.total, 4);
  assert.equal(sheetCrmPriorities({ headers: ['Contact Name'], rows }, now).hasSignals, false);
});
