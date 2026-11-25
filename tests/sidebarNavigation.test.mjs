import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSidebarOrder, orderedSidebarEntries, sidebarEntryId, sidebarNavigation, sidebarItemVisible, visibleSidebarNavigation } from '../src/lib/sidebarNavigation.js';
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
    assert.equal(paths(navigation).some((path) => path.startsWith('/finance/')), false);
  }
  assert.equal(PAGES.some((p) => p.to === '/finance/debt'), false);
});

test('Weekly Review and Agents are gone from navigation and search', () => {
  assert.equal(paths(all).some((path) => path === '/review' || path.startsWith('/agents')), false);
  assert.equal(all.folders.some((f) => f.id === 'folder:agents'), false);
  assert.equal(PAGES.some((p) => p.to === '/review' || p.to.startsWith('/agents')), false);
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
  const hidden = { '/health': false, '/projects/project-1': false, '/socials/youtube/youtube-1': false, '/crm/crm-1': false };
  const visible = visibleSidebarNavigation(all, hidden);
  for (const path of Object.keys(hidden)) assert.equal(paths(visible).includes(path), false);
  assert.ok(paths(visible).includes('/finance'));
  assert.ok(paths(visible).includes('/socials/instagram/instagram-1'));
  assert.equal(visible.folders.find((f) => f.id === 'folder:projects').indexTo, '/projects');
  assert.equal(visible.folders.find((f) => f.id === 'folder:projects').emptyLabel, 'All pages hidden');
  // Filtering never removes a page from the full customization catalog.
  assert.ok(paths(all).includes('/projects/project-1'));
});

test('hiding all static children removes an empty folder; sections with a Manage link stay', () => {
  const folder = { id: 'folder:static', label: 'Static', icon: 'ti-folder', items: [{ label: 'One', to: '/one' }, { label: 'Two', to: '/two' }] };
  const hidden = { '/one': false, '/two': false };
  assert.equal(visibleSidebarNavigation({ links: [], folders: [folder] }, hidden).folders.length, 0);
  const managed = { ...folder, id: 'folder:managed', indexTo: '/managed' };
  const managedHidden = visibleSidebarNavigation({ links: [], folders: [managed] }, hidden).folders.find((f) => f.id === 'folder:managed');
  assert.equal(managedHidden.indexTo, '/managed');
  assert.ok(visibleSidebarNavigation(sidebarNavigation()).folders.some((f) => f.id === 'folder:projects'));
});

test('renaming a dynamic page keeps its hidden choice and does not affect another page', () => {
  const renamed = sidebarNavigation({ ...workspace, projects: [{ id: 'project-1', name: 'Renamed' }, { id: 'project-2', name: 'New' }] });
  const visible = visibleSidebarNavigation(renamed, { '/projects/project-1': false });
  assert.equal(paths(visible).includes('/projects/project-1'), false);
  assert.ok(paths(visible).includes('/projects/project-2'));
});

test('showing a parent restores only its visible children; saved child choices survive', () => {
  const visibility = { 'folder:socials': false, '/socials/youtube/youtube-1': false };
  assert.equal(visibleSidebarNavigation(all, visibility).folders.some((f) => f.id === 'folder:socials'), false);
  const restored = visibleSidebarNavigation(all, { ...visibility, 'folder:socials': true });
  assert.equal(paths(restored).includes('/socials/youtube/youtube-1'), false);
  assert.ok(paths(restored).includes('/socials/instagram/instagram-1'));
  const showAll = Object.fromEntries(Object.keys(visibility).map((id) => [id, true]));
  assert.deepEqual(paths(visibleSidebarNavigation(all, showAll)), paths(all));
});

test('Health is one top-level link with no sub-pages; search jumps to its sections', () => {
  assert.deepEqual(all.links.find((link) => link.to === '/health'), { to: '/health', label: 'Health', icon: 'ti-heart' });
  assert.equal(all.folders.some((folder) => folder.id === 'folder:health'), false);
  assert.ok(PAGES.some((page) => page.to === '/health#nutrition'));
  assert.ok(PAGES.some((page) => page.to === '/health#supplements'));
  assert.ok(PAGES.some((page) => page.to === '/health#fitness'));
  assert.ok(PAGES.some((page) => page.to === '/health#weight'));
});

test('Finance is one top-level link with no sub-pages; search jumps to its sections', () => {
  assert.deepEqual(all.links.find((link) => link.to === '/finance'), { to: '/finance', label: 'Finance', icon: 'ti-coin' });
  assert.equal(all.folders.some((folder) => folder.id === 'folder:finance'), false);
  for (const section of ['assets', 'cashflow', 'investing', 'goals']) assert.ok(PAGES.some((page) => page.to === `/finance#${section}`), section);
  assert.equal(PAGES.some((page) => /^\/finance\/\w/.test(page.to)), false);
  assert.equal(visibleSidebarNavigation(all, { '/finance': false }).links.some((link) => link.to === '/finance'), false);
});

test('sidebar visibility leaves widget settings and other preferences intact', () => {
  const settings = { dashboard_widgets: { v: 7, columns: [[{ id: 'board' }, { id: 'nutrition' }]] }, ui_preferences: { sidebar: { width: 280, folders: { Health: true } }, sidebarVisibility: { '/todo': false, '/health': false }, finance: { includeDebt: false } } };
  const before = structuredClone(settings);
  const navigation = sidebarNavigation({ ...workspace, settings });
  const visible = visibleSidebarNavigation(navigation, settings.ui_preferences.sidebarVisibility);
  assert.equal(paths(visible).includes('/todo'), false);
  assert.equal(paths(visible).includes('/finance/debt'), false);
  assert.ok(paths(visible).includes('/finance'));
  assert.deepEqual(settings, before);
});

test('saved sidebar order can move folders, devices and Settings across the pinned divider', () => {
  const defaults = orderedSidebarEntries(all).map(sidebarEntryId);
  assert.deepEqual(defaults.slice(-4), ['sidebar:pinned', '/room', '/drive', '/settings']);
  const order = { root: ['folder:projects', '/drive', '/settings', '/todo', 'sidebar:pinned', '/calendar', '/room'] };
  const visible = visibleSidebarNavigation(all, { '/todo': false, '/settings': false });
  const entries = orderedSidebarEntries(visible, order).map(sidebarEntryId);
  assert.deepEqual(entries.slice(0, 3), ['folder:projects', '/drive', '/settings']);
  assert.deepEqual(entries.slice(-3), ['sidebar:pinned', '/calendar', '/room']);
  assert.ok(entries.indexOf('/context') < entries.indexOf('sidebar:pinned'));
  assert.equal(entries.includes('/todo'), false);
  assert.equal(orderedSidebarEntries(all, order).map(sidebarEntryId)[3], '/todo');
});

test('folder order survives project renames and hidden pages, and new projects stay visible', () => {
  const navigation = sidebarNavigation({ projects: [
    { id: 'project-1', name: 'Renamed' }, { id: 'project-2', name: 'Second' }, { id: 'project-3', name: 'New' },
  ] });
  const order = { 'folder:projects': ['/projects/project-2', '/projects/project-1', '/projects/project-2', '/projects/deleted'] };
  const items = (nav) => orderedSidebarEntries(nav, order).find(({ id }) => id === 'folder:projects').items;
  assert.deepEqual(items(navigation).map(({ label }) => label), ['Second', 'Renamed', 'New']);
  assert.deepEqual(items(visibleSidebarNavigation(navigation, { '/projects/project-2': false })).map(({ label }) => label), ['Renamed', 'New']);
});

test('reordering available items keeps a slot for pages temporarily missing from a folder', () => {
  assert.deepEqual(mergeSidebarOrder(['/socials/a', '/socials/offline', '/socials/b'], ['/socials/b', '/socials/a', '/socials/new']),
    ['/socials/b', '/socials/offline', '/socials/a', '/socials/new']);
});
