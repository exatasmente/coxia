import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { boardId, cardRef, columnLabel } from '../src/shared/board';
import { createBoardStore } from '../src/main/board-core';

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
