import { describe, expect, it } from 'vitest';
import { isOldNote, OLD_AFTER_MS, type MemoryFolder, type NoteItem } from '../src/shared/memoryView';
import { BADGE_LABEL, ERROR_KEY, KIND_LABEL, NO_FILTERS, badgesOf, distinct, filterNotes, groupNotes, isFiltering, needsReview, sortNotes } from '../src/renderer/src/screens/memory/memoryModel';
import { CATALOGS } from '../src/shared/i18n';

// The Memory view without React: filter, group, sort and the badges of a note, and that every word it uses is in both catalogs.

const note = (over: Partial<NoteItem> = {}): NoteItem => ({
  id: 'm-00000001',
  conversation: 'general',
  agent: 'developer',
  kind: 'decision',
  title: 'Use the queue for retries',
  by: 'developer',
  person: false,
  revision: 1,
  reviewed: true,
  foreign: false,
  unsafe: false,
  at: '2026-10-09T10:00:00.000Z',
  size: 40,
  old: false,
  left: false,
  ...over,
});

const folders: MemoryFolder[] = [
  { conversation: 'general', agent: 'qa', title: 'General conversation', left: false },
  { conversation: 'general', agent: 'developer', title: 'General conversation', left: false },
  { conversation: 'direct-ghost', agent: 'ghost', title: 'Chat with Ghost', left: true },
  { conversation: 'squad-a', agent: 'developer', title: 'Squad A', left: false },
];

describe('the filters', () => {
  const items = [
    note({ id: 'm-00000001' }),
    note({ id: 'm-00000002', agent: 'qa', by: 'qa', kind: 'finding', title: 'Flaky login test' }),
    note({ id: 'm-00000003', conversation: 'direct-ghost', agent: 'ghost', by: 'ghost', kind: 'note', title: 'Old idea', left: true, old: true }),
    note({ id: 'm-00000004', reviewed: false, title: 'Waits' }),
    note({ id: 'm-00000005', foreign: true, reviewed: false, title: 'By hand' }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>): string[] => filterNotes(items, { ...NO_FILTERS, ...f }).map((n) => n.id);

  it('keeps everything with no filter', () => {
    expect(ids({})).toHaveLength(5);
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, search: 'x' })).toBe(true);
  });

  it('filters by conversation, agent and kind', () => {
    expect(ids({ conversation: 'direct-ghost' })).toEqual(['m-00000003']);
    expect(ids({ agent: 'qa' })).toEqual(['m-00000002']);
    expect(ids({ kind: 'finding' })).toEqual(['m-00000002']);
  });

  it('searches the title, the kind, the agent and the conversation, every word, and never the text', () => {
    expect(ids({ search: 'flaky' })).toEqual(['m-00000002']);
    expect(ids({ search: 'FINDING qa' })).toEqual(['m-00000002']);
    expect(ids({ search: 'queue retries' })).toEqual(['m-00000001', 'm-00000004'].filter((id) => id === 'm-00000001'));
    expect(ids({ search: 'nothing here' })).toEqual([]);
    expect(filterNotes(items, { ...NO_FILTERS, search: 'chat with ghost' }, (c) => (c === 'direct-ghost' ? 'Chat with Ghost' : c)).map((n) => n.id)).toEqual(['m-00000003']);
  });

  it('keeps only what waits for the person, or what is of an agent that left', () => {
    expect(ids({ waiting: true })).toEqual(['m-00000004', 'm-00000005']);
    expect(ids({ left: true })).toEqual(['m-00000003']);
    expect(needsReview(note({ reviewed: false }))).toBe(true);
    expect(needsReview(note({ foreign: true }))).toBe(true);
    expect(needsReview(note())).toBe(false);
  });

  it('lists the distinct values of a field, sorted', () => {
    expect(distinct(folders, (f) => f.conversation)).toEqual(['direct-ghost', 'general', 'squad-a']);
  });
});

describe('the groups', () => {
  it('group the notes by conversation, then agent, folders in order, and include a folder with no note', () => {
    const items = [note({ id: 'm-00000001' }), note({ id: 'm-00000002', at: '2026-10-09T11:00:00.000Z', title: 'Newer' })];
    const groups = groupNotes({ folders }, items, false);
    expect(groups.map((g) => g.conversation)).toEqual(['direct-ghost', 'general', 'squad-a']);
    expect(groups[1].title).toBe('General conversation');
    expect(groups[1].agents.map((a) => a.agent)).toEqual(['developer', 'qa']);
    expect(groups[1].agents[0].notes.map((n) => n.id)).toEqual(['m-00000002', 'm-00000001']);
    expect(groups[1].agents[1].notes).toEqual([]);
    expect(groups[0].agents[0]).toMatchObject({ agent: 'ghost', left: true, notes: [] });
  });

  it('leave out the folders with no note that passed a filter, and keep the ones that did', () => {
    const items = [note({ id: 'm-00000001' })];
    const groups = groupNotes({ folders }, items, true);
    expect(groups.map((g) => g.conversation)).toEqual(['general']);
    expect(groups[0].agents.map((a) => a.agent)).toEqual(['developer']);
  });

  it('sort the notes newest first, with the id to break a tie', () => {
    const a = note({ id: 'm-0000000a', at: '2026-10-01T00:00:00.000Z' });
    const b = note({ id: 'm-0000000c', at: '2026-10-05T00:00:00.000Z' });
    const c = note({ id: 'm-0000000b', at: '2026-10-05T00:00:00.000Z' });
    expect(sortNotes([a, b, c]).map((n) => n.id)).toEqual(['m-0000000b', 'm-0000000c', 'm-0000000a']);
  });
});

describe('the badges', () => {
  it('say what the person should know before opening a note, in a fixed order', () => {
    expect(badgesOf(note())).toEqual([]);
    expect(badgesOf(note({ person: true }))).toEqual(['edited']);
    expect(badgesOf(note({ reviewed: false }))).toEqual(['awaits']);
    expect(badgesOf(note({ foreign: true, reviewed: false }))).toEqual(['foreign']);
    expect(badgesOf(note({ unsafe: true, person: true, old: true, left: true }))).toEqual(['unsafe', 'edited', 'old', 'left']);
    expect(badgesOf(note({ foreign: true, unsafe: true, reviewed: false, old: true }))).toEqual(['foreign', 'unsafe', 'old']);
  });

  it('call a note old after 90 days, from the clock the caller gives', () => {
    const now = Date.parse('2026-10-09T10:00:00Z');
    expect(isOldNote('2026-10-09T10:00:00Z', now)).toBe(false);
    expect(isOldNote(new Date(now - OLD_AFTER_MS + 1000).toISOString(), now)).toBe(false);
    expect(isOldNote(new Date(now - OLD_AFTER_MS - 1000).toISOString(), now)).toBe(true);
    expect(isOldNote('not a date', now)).toBe(false);
  });
});

describe('the words', () => {
  it('are in both catalogs, every one the view names', () => {
    const keys = [...Object.values(KIND_LABEL), ...Object.values(BADGE_LABEL), ...Object.values(ERROR_KEY), 'ui.memory.nav', 'ui.memory.title', 'ui.memory.person', 'ui.audit.kind.memory'];
    for (const key of keys) {
      expect(CATALOGS['pt-BR'][key], `pt-BR ${key}`).toBeTruthy();
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
    }
  });
});
