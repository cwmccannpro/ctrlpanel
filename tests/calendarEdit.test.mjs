import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canEditEvent, draftFromEvent, eventFromDraft, mergeCalendarSources, newDraft } from '../src/lib/calendarEdit.js';

test('a feed copy of an iCloud event is dropped; other feed events stay', () => {
  const base = [{ id: 'g1', title: 'Google', starts_at: '2026-11-17T10:00:00Z' }];
  const icloud = [{ id: 'i1', uid: 'A', title: 'Dentist', starts_at: '2026-11-17T15:00:00.000Z', source: 'icloud' }];
  const feeds = [
    { id: 'f1', uid: 'A', title: 'Dentist', starts_at: '2026-11-17T15:00:00.000Z' },
    { id: 'f2', uid: 'B', title: 'Holiday', starts_at: '2026-11-26' },
  ];
  assert.deepEqual(mergeCalendarSources({ base, icloud, feeds }).map((e) => e.id), ['g1', 'i1', 'f2']);
  assert.equal(mergeCalendarSources({ base }), base); // unchanged identity when nothing to merge
  assert.deepEqual(mergeCalendarSources({ base, feeds }).map((e) => e.id), ['g1', 'f1', 'f2']);
});

test('only writable, non-repeating iCloud events are editable', () => {
  assert.equal(canEditEvent({ source: 'icloud', editable: true, href: 'https://x' }), true);
  assert.equal(canEditEvent({ source: 'icloud', editable: false, href: 'https://x' }), false);
  assert.equal(canEditEvent({ id: 'feed', editable: true }), false);
  assert.equal(canEditEvent(null), false);
});

test('a new draft starts at the clicked slot and round-trips', () => {
  const d = newDraft(new Date(2026, 10, 17), { startMin: 14 * 60 + 30, mins: 90, calId: 'cal' });
  assert.deepEqual([d.date, d.start, d.end, d.calId], ['2026-11-17', '14:30', '16:00', 'cal']);
  const ev = eventFromDraft({ ...d, title: '  Gym ' });
  assert.equal(ev.title, 'Gym');
  assert.equal(ev.all_day, false);
  assert.equal(ev.starts_at, new Date(2026, 10, 17, 14, 30).toISOString());
  assert.equal(ev.ends_at, new Date(2026, 10, 17, 16, 0).toISOString());
});

test('an end time before the start runs past midnight', () => {
  const ev = eventFromDraft({ title: 'Late', date: '2026-11-17', endDate: '2026-11-17', start: '23:00', end: '01:00' });
  assert.equal(ev.ends_at, new Date(2026, 10, 18, 1, 0).toISOString());
});

test('all-day drafts show an inclusive end and send an exclusive one', () => {
  const d = draftFromEvent({ title: 'Trip', all_day: true, starts_at: '2026-11-20', ends_at: '2026-11-23', cal_id: 'c' });
  assert.deepEqual([d.allDay, d.date, d.endDate], [true, '2026-11-20', '2026-11-22']);
  const ev = eventFromDraft(d);
  assert.deepEqual([ev.all_day, ev.starts_at, ev.ends_at], [true, '2026-11-20', '2026-11-23']);
  assert.equal(eventFromDraft({ ...d, endDate: '2026-11-19' }).error, 'The end date is before the start date.');
});

test('timed events round-trip through the editor, notes and location included', () => {
  const src = { title: 'Call', starts_at: new Date(2026, 10, 17, 9, 0).toISOString(), ends_at: new Date(2026, 10, 17, 9, 45).toISOString(), location: 'Zoom', notes: 'Agenda' };
  const d = draftFromEvent(src);
  assert.deepEqual([d.start, d.end, d.location, d.notes], ['09:00', '09:45', 'Zoom', 'Agenda']);
  const ev = eventFromDraft(d);
  assert.deepEqual([ev.starts_at, ev.ends_at, ev.location, ev.notes], [src.starts_at, src.ends_at, 'Zoom', 'Agenda']);
  assert.equal(eventFromDraft({ ...d, title: ' ' }).error, 'Give the event a title.');
});
