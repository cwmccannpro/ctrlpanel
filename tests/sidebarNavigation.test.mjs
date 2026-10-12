import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sidebarNavigation, sidebarItemVisible, visibleSidebarNavigation } from '../src/lib/sidebarNavigation.js';
import { PAGES } from '../src/lib/commandPalette.js';

const workspace = {
  projects: [{ id: 'project-1', name: 'Launch' }],
  crmBoards: [{ id: 'crm-1', name: 'Buyers' }],
  socials: { channels: [{ id: 'youtube-1', title: 'Videos' }], instagram: { accounts: [{ id: 'instagram-1', username: 'creator' }] } },
};
const all = sidebarNavigation(workspace);
const paths = (nav) => [...nav.links.map((l) => l.to), ...nav.folders.flatMap((f) => f.items.map((i) => i.to))];

test('debt is absent from navigation and search even with old opt-ins and Show all', () => {
  for (const includeDebt of [undefined, false, true]) {
    const settings = { ui_preferences: { finance: { includeDebt } } };
    const navigation = sidebarNavigation({ ...workspace, settings });
    assert.equal(paths(visibleSidebarNavigation(navigation, { '/finance/debt': true })).includes('/finance/debt'), false);
    assert.equal(navigation.folders.find((f) => f.id === 'folder:finance').items.find((i) => i.to === '/finance/networth').label, 'Assets');
  }
  assert.equal(PAGES.some((p) => p.to === '/finance/debt'), false);
});

test('all existing sections and newly added pages are visible by default', () => {
  assert.deepEqual(visibleSidebarNavigation(all).links, all.links);
  assert.deepEqual(paths(visibleSidebarNavigation(all, {})), paths(all));
  assert.ok(paths(all).includes('/socials/instagram/instagram-1'));
  assert.equal(sidebarItemVisible({ '/todo': null }, '/todo'), true);
});

test('every top-level link and folder can be hidden independently', () => {
  for (const link of all.links) {
    const visible = visibleSidebarNavigation(all, { [link.to]: false });
    assert.equal(visible.links.some((l) => l.to === link.to), false);
    assert.equal(visible.folders.length, all.folders.length);
  }
  for (const folder of all.folders) {
    const visible = visibleSidebarNavigation(all, { [folder.id]: false });
    assert.equal(visible.folders.some((f) => f.id === folder.id), false);
    assert.deepEqual(visible.links, all.links);
  }
});

test('individual pages disappear in expanded navigation and rail flyouts using the same items', () => {
  const hidden = { '/health': false, '/projects/project-1': false, '/socials/youtube/youtube-1': false, '/agents/opportunities': false };
  const visible = visibleSidebarNavigation(all, hidden);
  for (const path of Object.keys(hidden)) assert.equal(paths(visible).includes(path), false);
  assert.ok(paths(visible).includes('/finance/investing'));
  assert.ok(paths(visible).includes('/socials/instagram/instagram-1'));
  assert.equal(visible.folders.find((f) => f.id === 'folder:projects').indexTo, '/projects');
  assert.equal(visible.folders.find((f) => f.id === 'folder:projects').emptyLabel, 'All pages hidden');
  // Filtering never removes a page from the full customization catalog.
  assert.ok(paths(all).includes('/projects/project-1'));
});

test('hiding all static children removes an empty folder; empty dynamic sections keep Manage', () => {
  const hidden = Object.fromEntries(all.folders.find((f) => f.id === 'folder:health').items.map((i) => [i.to, false]));
  assert.equal(visibleSidebarNavigation(all, hidden).folders.some((f) => f.id === 'folder:health'), false);
  assert.ok(visibleSidebarNavigation(sidebarNavigation()).folders.some((f) => f.id === 'folder:projects'));
});

test('renaming a dynamic page keeps its hidden choice and does not affect another page', () => {
  const renamed = sidebarNavigation({ ...workspace, projects: [{ id: 'project-1', name: 'Renamed' }, { id: 'project-2', name: 'New' }] });
  const visible = visibleSidebarNavigation(renamed, { '/projects/project-1': false });
  assert.equal(paths(visible).includes('/projects/project-1'), false);
  assert.ok(paths(visible).includes('/projects/project-2'));
});

test('showing a parent restores only its visible children; saved child choices survive', () => {
  const visibility = { 'folder:finance': false, '/finance/budget': false };
  assert.equal(visibleSidebarNavigation(all, visibility).folders.some((f) => f.id === 'folder:finance'), false);
  const restored = visibleSidebarNavigation(all, { ...visibility, 'folder:finance': true });
  assert.equal(paths(restored).includes('/finance/budget'), false);
  assert.ok(paths(restored).includes('/finance/investing'));
  const showAll = Object.fromEntries(Object.keys(visibility).map((id) => [id, true]));
  assert.deepEqual(paths(visibleSidebarNavigation(all, showAll)), paths(all));
});

test('Health has one combined overview; search jumps to its sections', () => {
  assert.deepEqual(all.folders.find((folder) => folder.id === 'folder:health').items, [{ label: 'Overview', to: '/health' }]);
  assert.ok(PAGES.some((page) => page.to === '/health#nutrition'));
  assert.ok(PAGES.some((page) => page.to === '/health#supplements'));
  assert.ok(PAGES.some((page) => page.to === '/health#fitness'));
});

test('sidebar visibility leaves widget settings and other preferences intact', () => {
  const settings = { dashboard_widgets: { v: 7, columns: [[{ id: 'board' }, { id: 'nutrition' }]] }, ui_preferences: { sidebar: { width: 280, folders: { Health: true } }, sidebarVisibility: { '/todo': false, 'folder:health': false }, finance: { includeDebt: false } } };
  const before = structuredClone(settings);
  const navigation = sidebarNavigation({ ...workspace, settings });
  const visible = visibleSidebarNavigation(navigation, settings.ui_preferences.sidebarVisibility);
  assert.equal(paths(visible).includes('/todo'), false);
  assert.equal(paths(visible).includes('/finance/debt'), false);
  assert.equal(navigation.folders.find((f) => f.id === 'folder:finance').items.find((i) => i.to === '/finance/networth').label, 'Assets');
  assert.deepEqual(settings, before);
});
