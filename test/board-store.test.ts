import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type BoardCard, type BoardHostLink, type HostSeen, type MirrorContext, boardId, cardRef, columnLabel, derivedFields, mirrorOf } from '../src/shared/board';
import { createBoardStore } from '../src/main/board-core';
import type { SquadDef, StageDef } from '../src/shared/config/types';

// The board of a workspace that has no code host: where a card lives, what it carries, and how each change reads back. Pure over its file: no
// app, no network, no host. The file is written once and read again, so the test sees what a later stage of the app would.

const DIR = mkdtempSync(join(tmpdir(), 'cerimonias-board-store-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const FILE = join(DIR, 'board.json');
let counter = 0;
let clock = Date.parse('2026-10-07T10:00:00.000Z');

const store = () => createBoardStore({ file: FILE, now: () => new Date((clock += 60_000)) });

const make = (id: string, title = 'A card', column = 'backlog') => {
  const s = store();
  return s.create({ id, title, body: 'why it matters', column, squad: null, priority: null, labels: [], repo: 'app' });
};

describe('a card of the board', () => {
  it('is created whole and reads back from the file', () => {
    const card = make('k3m9x2p7');
    expect(card).toMatchObject({ id: 'k3m9x2p7', title: 'A card', column: 'backlog', state: 'open', repo: 'app' });
    expect(card.history).toEqual([{ at: card.createdAt, kind: 'created' }]);
    expect(cardRef(card)).toBe('app#k3m9x2p7');
    // A second store over the same file reads what the first wrote.
    expect(store().get('k3m9x2p7')).toEqual(card);
  });

  it('moves between columns, takes a priority and a squad, is commented and closed, each leaving a line', () => {
    const s = store();
    expect(s.update('k3m9x2p7', { column: 'doing' }).history.at(-1)).toMatchObject({ kind: 'moved', from: 'backlog', to: 'doing' });
    expect(s.update('k3m9x2p7', { priority: 'priority:high' }).history.at(-1)).toMatchObject({ kind: 'priority', to: 'priority:high' });
    expect(s.update('k3m9x2p7', { squad: 'core' }).history.at(-1)).toMatchObject({ kind: 'squad', to: 'core' });
    expect(s.comment('k3m9x2p7', 'waiting on the other change').history.at(-1)).toMatchObject({ kind: 'commented', text: 'waiting on the other change' });
    const closed = s.close('k3m9x2p7');
    expect(closed.state).toBe('closed');
    expect(closed.history.at(-1)).toMatchObject({ kind: 'closed' });
    expect(s.reopen('k3m9x2p7').history.at(-1)).toMatchObject({ kind: 'reopened' });
  });

  it('bumps updatedAt only when something changed, so the order of the day does not move on a no-op', () => {
    const s = store();
    make('aaa11111');
    const before = s.get('aaa11111') as NonNullable<ReturnType<typeof s.get>>;
    expect(s.update('aaa11111', { column: 'backlog' })).toEqual(before);
    const after = s.update('aaa11111', { title: 'Another title' });
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(after.history.at(-1)).toMatchObject({ kind: 'edited', text: 'title' });
  });

  it('refuses a change to a card it does not have', () => {
    expect(() => store().update('nope0000', { column: 'doing' })).toThrow(/board card not found/);
    expect(() => store().close('nope0000')).toThrow(/board card not found/);
  });

  it('reads an unreadable file as an empty board instead of throwing', () => {
    const broken = join(DIR, 'broken.json');
    const s = createBoardStore({ file: broken, now: () => new Date() });
    expect(s.list()).toEqual([]);
  });
});

describe('the name of a column', () => {
  it('is the label itself when the label is the name, and the text of the key when the label is a shipped template key', () => {
    expect(columnLabel('Backlog', 'backlog', 'en')).toBe('Backlog');
    expect(columnLabel('Backlog', 'backlog', 'pt-BR')).toBe('Backlog');
    // The shipped cycle templates store their stage names as catalog keys ("Refine" in English, "Refinar" in Portuguese).
    expect(columnLabel('cycle.agentFlow.stage.refine', 'backlog', 'en')).toBe('Refine');
  });

  it('falls back to the name of the kind when the label is a key nobody has, so no screen ever shows a raw key', () => {
    expect(columnLabel('cycle.gone.stage.blocked', 'blocked', 'en')).toBe('Blocked');
    expect(columnLabel('cycle.gone.stage.blocked', 'blocked', 'pt-BR')).toBe('Bloqueada');
  });
});

describe('a board id', () => {
  it('is eight characters and never only digits, so it cannot be read as an issue number', () => {
    for (let i = 0; i < 200; i++) {
      const id = boardId(Uint8Array.from({ length: 16 }, (_, k) => (i * 31 + k * 7) % 256));
      expect(id).toMatch(/^[a-z0-9]{8}$/);
      expect(/^[0-9]+$/.test(id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- a card that became an issue, and what the host says of it

const STAGES: StageDef[] = [
  { id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 1 },
  { id: 'doing', label: 'Doing', match: [], kind: 'development', rank: 2 },
  { id: 'done', label: 'Done', match: [], kind: 'done', rank: 8 },
];
const SQUADS = [
  { id: 'core', name: 'Core', label: 'core', scope: { labels: [] } },
  { id: 'web', name: 'Web', label: null, scope: { labels: ['frontend'] } },
] as unknown as SquadDef[];
const CTX: MirrorContext = { stages: STAGES, levels: ['^priority:high$', 'priority:low'], squads: SQUADS, labelsOnHost: true, ownLabels: ['board:backlog', 'board:doing', 'board:done', 'in progress'] };
const LINK: BoardHostLink = { vcs: 'github', project: 'group/project', iid: 12, url: 'https://github.example.test/group/project/issues/12', linkedAt: '2026-10-07T11:00:00.000Z' };
const seen = (over: Partial<HostSeen> = {}): HostSeen => ({ state: 'open', title: 'A card', labels: [], stageId: 'backlog', updatedAt: null, url: LINK.url, ...over });
const raw = () => readFileSync(FILE, 'utf8');
const linked = (id: string, over: Partial<Parameters<ReturnType<typeof store>['create']>[0]> = {}) => {
  const s = store();
  s.create({ id, title: 'A card', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app', ...over });
  return s.link(id, LINK);
};

describe('a card linked to its issue', () => {
  it('records the link with a sent line, clears the note and bumps the card once', () => {
    const s = store();
    make('lnk00001');
    const noted = s.note('lnk00001', { kind: 'failed', text: 'the host was down' });
    expect(noted.hostNote).toMatchObject({ kind: 'failed', text: 'the host was down' });
    const card = s.link('lnk00001', LINK);
    expect(card.host).toEqual(LINK);
    expect(card.hostNote).toBeUndefined();
    expect(card.history.at(-1)).toMatchObject({ kind: 'sent', text: 'group/project#12' });
    expect(card.updatedAt > noted.updatedAt).toBe(true);
    expect(store().get('lnk00001')).toEqual(card);
  });

  it('writes nothing when the same link comes again', () => {
    linked('lnk00002');
    const before = raw();
    const again = store().link('lnk00002', LINK);
    expect(again.history.filter((h) => h.kind === 'sent')).toHaveLength(1);
    expect(raw()).toBe(before);
  });

  it('writes a note only when it differs, and clears it with null', () => {
    const s = store();
    make('note0001');
    s.note('note0001', { kind: 'unsupported', text: 'no issue project' });
    const before = raw();
    s.note('note0001', { kind: 'unsupported', text: 'no issue project' });
    expect(raw()).toBe(before);
    expect(s.note('note0001', { kind: 'declined', text: 'skipped in Actions' }).hostNote).toMatchObject({ kind: 'declined' });
    expect(s.note('note0001', null).hostNote).toBeUndefined();
    const cleared = raw();
    s.note('note0001', null);
    expect(raw()).toBe(cleared);
  });

  it('reads an old file with none of the new fields, and keeps it whole on the next write', () => {
    const old = join(DIR, 'old.json');
    const card = { id: 'old00001', title: 'Old', body: '', column: 'doing', squad: null, priority: null, labels: ['x'], repo: null, state: 'open', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', history: [{ at: '2026-10-01T10:00:00.000Z', kind: 'created' }] };
    writeFileSync(old, JSON.stringify({ version: 1, cards: [card] }));
    const s = createBoardStore({ file: old, now: () => new Date('2026-10-08T10:00:00.000Z') });
    expect(s.get('old00001')).toEqual(card);
    expect(s.get('old00001')?.host).toBeUndefined();
    s.comment('old00001', 'hello');
    const written = JSON.parse(readFileSync(old, 'utf8')).cards[0];
    expect({ ...written, history: written.history.slice(0, 1) }).toEqual({ ...card, updatedAt: '2026-10-08T10:00:00.000Z' });
    expect(written.history.at(-1)).toMatchObject({ kind: 'commented', text: 'hello' });
  });

  it('drops a damaged link when reading, so the card reads as one that is only on the board', () => {
    const bad = join(DIR, 'bad-link.json');
    const card = { id: 'bad00001', title: 'Bad', body: '', column: 'doing', squad: null, priority: null, labels: [], repo: null, state: 'open', createdAt: 'a', updatedAt: 'a', history: [], host: { project: 7 } };
    writeFileSync(bad, JSON.stringify({ version: 1, cards: [card] }));
    expect(createBoardStore({ file: bad, now: () => new Date() }).get('bad00001')?.host).toBeUndefined();
  });
});

describe('what the host says of a card (mirrorOf)', () => {
  const card = (over: Partial<BoardCard> = {}): BoardCard => ({ id: 'm1', title: 'A card', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: null, state: 'open', createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', history: [], host: LINK, ...over });

  it('changes nothing for an issue that is missing or could not be read', () => {
    for (const state of ['missing', 'unread'] as const) expect(mirrorOf(card(), seen({ state, title: 'other', labels: ['bug'], stageId: 'done' }), CTX)).toEqual({});
  });

  it('changes nothing when the host agrees', () => {
    expect(mirrorOf(card({ labels: ['bug'] }), seen({ labels: ['bug', 'board:backlog'] }), CTX)).toEqual({});
  });

  it('takes the title, the state, the column and the labels, leaving out the app\'s own stage labels', () => {
    const r = mirrorOf(card(), seen({ title: 'Renamed', state: 'closed', stageId: 'done', labels: ['bug', 'board:done', 'in progress'] }), CTX);
    expect(r).toEqual({ title: 'Renamed', state: 'closed', column: 'done', labels: ['bug'] });
  });

  it('reads the priority and the squad from the labels, and clears them when the labels are gone', () => {
    expect(mirrorOf(card(), seen({ labels: ['Priority:High', 'frontend'] }), CTX)).toMatchObject({ priority: 'priority:high', squad: 'web' });
    expect(mirrorOf(card({ priority: 'priority:low', squad: 'core', labels: ['core', 'priority:low'] }), seen({ labels: ['core', 'priority:low'] }), CTX)).toEqual({});
    expect(mirrorOf(card({ priority: 'priority:low', squad: 'core' }), seen({ labels: [] }), CTX)).toEqual({ priority: null, squad: null });
  });

  it('keeps a column the workspace does not have out of the card', () => {
    expect(mirrorOf(card(), seen({ stageId: 'gone' }), CTX)).toEqual({});
    expect(mirrorOf(card(), seen({ stageId: null }), CTX)).toEqual({});
  });

  it('leaves the column, priority and squad alone for a host with no labels', () => {
    const c = card({ column: 'doing', priority: 'priority:low', squad: 'core' });
    const r = mirrorOf(c, seen({ title: 'Renamed', state: 'closed', stageId: 'done', labels: [] }), { ...CTX, labelsOnHost: false });
    expect(r).toEqual({ title: 'Renamed', state: 'closed' });
  });

  it('keeps the card\'s own labels when the host has none to say', () => {
    const c = card({ labels: ['core', 'bug'], squad: 'core' });
    expect(mirrorOf(c, seen({ labels: [] }), { ...CTX, labelsOnHost: false })).toEqual({});
  });

  it('takes the host\'s update time only when it is later', () => {
    expect(mirrorOf(card(), seen({ updatedAt: '2026-10-07T12:00:00Z' }), CTX)).toEqual({ updatedAt: '2026-10-07T12:00:00.000Z' });
    expect(mirrorOf(card(), seen({ updatedAt: '2026-10-07T09:00:00Z' }), CTX)).toEqual({});
    expect(mirrorOf(card(), seen({ updatedAt: 'not a date' }), CTX)).toEqual({});
  });

  it('derives priority and squad as the first configured level and squad whose label the issue carries', () => {
    expect(derivedFields(['priority:low', 'priority:high', 'core', 'frontend'], CTX)).toEqual({ priority: 'priority:high', squad: 'core' });
    expect(derivedFields(['bug'], CTX)).toEqual({ priority: null, squad: null });
  });
});

describe('mirroring into the file', () => {
  it('overwrites the copy with the host\'s and leaves a host line for each change', () => {
    const before = linked('mir00001', { column: 'backlog', labels: ['bug'] });
    const card = store().mirror('mir00001', seen({ title: 'Renamed', state: 'closed', stageId: 'doing', labels: ['bug', 'board:doing', 'urgent'], updatedAt: '2026-10-08T00:00:00Z' }), CTX);
    expect(card).toMatchObject({ title: 'Renamed', state: 'closed', column: 'doing', labels: ['bug', 'urgent'], updatedAt: '2026-10-08T00:00:00.000Z' });
    const lines = card.history.slice(before.history.length);
    expect(lines).toEqual([
      { at: expect.any(String), kind: 'host', text: 'title' },
      { at: expect.any(String), kind: 'host', text: 'state', from: 'open', to: 'closed' },
      { at: expect.any(String), kind: 'host', text: 'column', from: 'backlog', to: 'doing' },
      { at: expect.any(String), kind: 'host', text: 'labels' },
    ]);
    expect(store().get('mir00001')).toEqual(card);
  });

  it('writes the file only when something changed', () => {
    linked('mir00002', { labels: ['bug'] });
    const s = store();
    s.mirror('mir00002', seen({ labels: ['bug'] }), CTX);
    const before = raw();
    s.mirror('mir00002', seen({ labels: ['bug', 'board:backlog'] }), CTX);
    s.mirror('mir00002', seen({ state: 'unread', title: 'x', labels: [] }), CTX);
    s.mirror('mir00002', seen({ state: 'missing', title: 'x', labels: [] }), CTX);
    expect(raw()).toBe(before);
  });

  it('never deletes a card the host no longer returns', () => {
    linked('mir00003');
    const card = store().mirror('mir00003', seen({ state: 'missing' }), CTX);
    expect(card.host).toEqual(LINK);
    expect(store().list().some((c) => c.id === 'mir00003')).toBe(true);
  });
});
