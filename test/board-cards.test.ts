import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// From the board file to the cards of the day, in a workspace with no code host: nothing here reaches a network or a model. Each test writes its
// own board through the same store the module writes through, and reads the day back through `loadCards`.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-cards-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { loadCards } = await import('../src/main/cards');
const { boardStore } = await import('../src/main/boardSource');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

// A workspace with no integration and a cycle with stages of its own, so the columns are the ones the test names.
const config = structuredClone(getConfig());
config.vcs = [];
config.projects.issues.vcsId = null;
config.projects.issues.project = null;
config.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: null, projectPath: null }];
config.language = 'en';
// The label of a column is the word the board shows, and the stage's own name matches it: that is how the day knows a card is blocked.
config.devCycle.stages = [
  { id: 'backlog', label: 'Backlog', match: ['Backlog'], kind: 'backlog', rank: 0 },
  { id: 'doing', label: 'Doing', match: ['Doing'], kind: 'development', rank: 1 },
  { id: 'blocked', label: 'Blocked', match: ['Blocked'], kind: 'blocked', rank: 2 },
];
config.devCycle.priority.labels = ['^priority:high$', '^priority:low$'];
config.devCycle.meanings.blocker.stageKinds = ['blocked'];
saveConfig(config);

let n = 0;
const open = (over: Partial<Parameters<ReturnType<typeof boardStore>['create']>[0]> = {}) =>
  boardStore().create({ id: `card${String(++n).padStart(4, '0')}`, title: 'A board card', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app', ...over });

describe('the day of a workspace with no code host', () => {
  it('is empty, and not an error, before the first card is opened', async () => {
    const before = await loadCards(100, true);
    expect(before.total).toBe(0);
    expect(before.cards).toEqual([]);
  });

  it('carries the board cards, with their own reference, their column and their repository id', async () => {
    const card = open({ title: 'First' });
    const day = await loadCards(100, true);
    expect(day.total).toBe(1);
    const found = day.cards.find((c) => c.iid === card.id);
    expect(found).toBeDefined();
    expect(found?.ref).toBe(`app#${card.id}`);
    expect(found?.title).toBe('First');
    // The stage of a board card is the column's own name, shown in the workspace's words.
    expect(found?.stage).toBe('Backlog');
    // Every card of the board carries a column the workspace configured, which is what keeps its name a word and never a raw key.
    expect(config.devCycle.stages.some((s) => s.id === card.column)).toBe(true);
    expect(found?.blockers).toEqual([]);
    // The project of a board card is the repository id, which is what the squads' scope matches against.
    expect(found?.project).toBe('app');
    // The card's own address is its reference: nothing that looks like a code-host address.
    expect(found?.url).toBe('');
    expect(found?.spec).toBeNull();
    expect(found?.mrs).toEqual([]);
  });

  it('grows the total when a card is opened and keeps the count of what did not fit', async () => {
    open({ title: 'Second' });
    const day = await loadCards(1, true);
    expect(day.cards).toHaveLength(1);
    expect(day.total).toBe(2);
    expect(day.rest).toHaveLength(1);
  });

  it('ranks a card by a level of the workspace priority labels', async () => {
    open({ title: 'Urgent', priority: 'priority:high' });
    const day = await loadCards(100, true);
    const urgent = day.cards.find((c) => c.title === 'Urgent');
    expect(urgent?.priority).toEqual({ rank: 0, label: 'priority:high' });
    // Blocked first, then priority: a card with none comes after one with a level.
    expect(day.cards.findIndex((c) => c.title === 'Urgent')).toBeLessThan(day.cards.findIndex((c) => c.title === 'First'));
  });

  it('shows the blocked line of a card in a stage the cycle counts as blocked', async () => {
    open({ title: 'Stuck', column: 'blocked' });
    const day = await loadCards(100, true);
    const stuck = day.cards.find((c) => c.title === 'Stuck');
    expect(stuck?.blockers).toHaveLength(1);
    expect(day.cards[0].title).toBe('Stuck');
  });



  it('shows the last comment of a card as its note', async () => {
    const card = open({ title: 'Talked about' });
    boardStore().comment(card.id, 'waiting on the other change');
    const day = await loadCards(100, true);
    expect(day.cards.find((c) => c.iid === card.id)?.note).toBe('waiting on the other change');
  });

  it('does not list a closed card in the day', async () => {
    const card = open({ title: 'Closed one' });
    boardStore().close(card.id);
    const day = await loadCards(100, true);
    expect(day.cards.some((c) => c.iid === card.id)).toBe(false);
  });
});
