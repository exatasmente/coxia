import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// A board card has no host behind it: a squad reaches it by its own label, which is how the docs flow already names a card with no host. The
// cut is the one the day's report makes, read here over the cards of a board a workspace with no integration opened.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-squads-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { squadsOfCard, cardsOfSquad } = await import('../src/shared/squadCards');
const { squadLabel, boardSquadChoices } = await import('../src/shared/board');
const { boardStore } = await import('../src/main/boardSource');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const config = structuredClone(getConfig());
config.vcs = [];
config.projects.issues.vcsId = null;
config.projects.issues.project = null;
config.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: null, projectPath: null }];
config.devCycle.stages = [{ id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 }];
config.language = 'en';
config.squads = [
  { id: 'core', name: 'Core', mission: '', label: 'core', liaison: null, autonomy: true, scope: { labels: [], repos: [], paths: [], unclaimed: false } },
  { id: 'left', name: 'Left over', mission: '', label: null, liaison: null, autonomy: true, scope: { labels: [], repos: [], paths: [], unclaimed: true } },
];
saveConfig(config);

let n = 0;
const open = (labels: string[] = []) =>
  boardStore().create({ id: `squad${String(++n).padStart(3, '0')}`, title: 'A card', body: '', column: 'backlog', squad: null, priority: null, labels, repo: 'app' });

const squads = config.squads ?? [];
const ctx = { runs: [], repos: config.projects.repos.map((r) => ({ id: r.id, projectPath: r.projectPath })) };

describe('the squad cut of a board card', () => {
  it('is the squad that names the label the card carries, once the board gave it to one', () => {
    const card = open(['core']);
    expect(squadsOfCard({ ref: `app#${card.id}`, labels: card.labels, project: 'app' }, squads, ctx)).toEqual(['core']);
  });

  it('goes to the squad that takes what is left when nobody claims the card', () => {
    const card = open([]);
    expect(squadsOfCard({ ref: `app#${card.id}`, labels: card.labels, project: 'app' }, squads, ctx)).toEqual(['left']);
  });

  it('is read back by the cut the ceremonies make, so the squad sees the card the board gave it', () => {
    const card = open(['core']);
    const asDay = [{ ref: `app#${card.id}`, labels: card.labels, project: 'app' }];
    expect(cardsOfSquad(asDay, squads, 'core', ctx).map((c) => c.ref)).toEqual([`app#${card.id}`]);
    expect(cardsOfSquad(asDay, squads, 'left', ctx)).toEqual([]);
  });

  it('is not offered as a destination when the squad names no label, and the board says why', () => {
    expect(boardSquadChoices(squads, 'en').map((s) => s.id)).toEqual(['core']);
    expect(squadLabel(squads.find((s) => s.id === 'left')!)).toBeNull();
  });
});
