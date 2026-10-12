import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLATFORMS, PLATFORM_LIST, accountLabel, instagramAccountKind, socialSections } from '../src/lib/socialPlatforms.js';

test('a section uses the owner’s own name first, then the platform default', () => {
  assert.equal(accountLabel('youtube', { label: ' Main ', title: 'Real Title' }), 'Main');
  assert.equal(accountLabel('youtube', { title: 'Real Title' }), 'Real Title');
  assert.equal(accountLabel('youtube', {}), 'Channel');
  assert.equal(accountLabel('instagram', { label: 'Studio', username: 'cam' }), 'Studio');
  assert.equal(accountLabel('instagram', { username: 'cam' }), '@cam');
  assert.equal(accountLabel('instagram', { name: 'Cameron' }), 'Cameron');
  assert.equal(accountLabel('instagram', {}), 'Instagram');
  assert.equal(accountLabel('instagram', { label: '   ', username: 'cam' }), '@cam', 'a blank label is no label');
});

test('sections list YouTube first, then Instagram, each routed to its own page', () => {
  const sections = socialSections({
    channels: [{ id: 'c1', title: 'Chan' }],
    instagram: { accounts: [{ id: 'a1', username: 'cam' }, { id: 'a2', username: 'studio', label: 'Studio' }] },
  });
  assert.deepEqual(sections.map((s) => [s.platform, s.label, s.to]), [
    ['youtube', 'Chan', '/socials/youtube/c1'],
    ['instagram', '@cam', '/socials/instagram/a1'],
    ['instagram', 'Studio', '/socials/instagram/a2'],
  ]);
  assert.equal(new Set(sections.map((s) => s.key)).size, 3, 'keys are unique even if ids collide across platforms');
  assert.equal(new Set(socialSections({ channels: [{ id: 'x' }], instagram: { accounts: [{ id: 'x' }] } }).map((s) => s.key)).size, 2);
});

test('sections tolerate Instagram not being loaded yet', () => {
  assert.deepEqual(socialSections({ channels: [] }), []);
  assert.deepEqual(socialSections(undefined), []);
  assert.equal(socialSections({ channels: [{ id: 'c1', title: 'T' }] }).length, 1);
});

test('every platform has the fields the overview needs', () => {
  assert.deepEqual(PLATFORM_LIST.map((p) => p.id), ['youtube', 'instagram', 'x']);
  for (const p of PLATFORM_LIST) {
    assert.ok(p.name && p.icon.startsWith('ti-') && p.noun && p.setup && p.requirement);
    assert.equal(p.path('abc'), `/socials/${p.id}/abc`);
  }
  assert.match(PLATFORMS.instagram.requirement, /Business or Creator/);
});

test('X accounts have distinct sidebar sections and handle-based names', () => {
  assert.equal(accountLabel('x', { username: 'creator' }), '@creator');
  assert.equal(accountLabel('x', { label: ' Work ', username: 'creator' }), 'Work');
  const sections = socialSections({ channels: [{ id: 'same', title: 'Videos' }], x: { accounts: [{ id: 'same', username: 'creator' }, { id: 'other', label: 'Work' }] } });
  assert.equal(sections[1].to, '/socials/x/same');
  assert.equal(sections[2].label, 'Work');
  assert.equal(new Set(sections.map(s => s.key)).size, 3);
});

test('Instagram account types read as Business / Creator', () => {
  assert.equal(instagramAccountKind('BUSINESS'), 'Business');
  assert.equal(instagramAccountKind('MEDIA_CREATOR'), 'Creator');
  assert.equal(instagramAccountKind('CREATOR'), 'Creator');
  assert.equal(instagramAccountKind(undefined), '');
});
