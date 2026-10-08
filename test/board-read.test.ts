import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BoardHostLink } from '../src/shared/board';
import { fakeBoardHost } from './helpers/boardHost';

// The read of the issues the board tracks (the cards it opened and linked to an issue), over a fake GitLab that records what was asked.
// Nothing reaches a network or a model, and the data folder is a throwaway one.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-read-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { ATAS } = await import('../src/main/env');
const { boardStore } = await import('../src/main/boardSource');
const { TRACKED_MAX, forgetTracked, mirrorTracked, readTracked, trackedCards } = await import('../src/main/vcs/boardRead');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const PROJECT = 'acme/app';
const config = structuredClone(getConfig());
config.language = 'en';
config.vcs = [{ id: 'host', kind: 'gitlab', host: 'git.acme.test', apiUrl: '', user: '', secretRef: null, cliPreference: 'cli', cliCommand: null }];
config.projects.issues.vcsId = 'host';
config.projects.issues.project = PROJECT;
config.projects.issues.refPrefix = 'app#';
config.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: 'host', projectPath: PROJECT }];
config.devCycle.stages = [
  { id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 },
  { id: 'doing', label: 'Doing', match: [], kind: 'development', rank: 1 },
  { id: 'done', label: 'Done', match: [], kind: 'done', rank: 2 },
];
config.devCycle.stageMapping = [];
config.devCycle.priority.labels = ['^priority:high$', '^priority:low$'];
config.squads = [{ id: 'core', name: 'Core', mission: '', label: 'core', liaison: null, autonomy: true, scope: { labels: [], repos: [], paths: [], unclaimed: false } }];
saveConfig(config);

let host = fakeBoardHost();
let n = 0;
const link = (iid: number): BoardHostLink => ({ vcs: 'gitlab', project: PROJECT, iid, url: `https://git.acme.test/${PROJECT}/-/issues/${iid}`, linkedAt: '2026-10-07T09:00:00.000Z' });
/** A card of the board linked to issue `iid`. */
const linked = (iid: number, over: Partial<Parameters<ReturnType<typeof boardStore>['create']>[0]> = {}) => {
  const id = `card${String(++n).padStart(4, '0')}`;
  boardStore().create({ id, title: `Card ${iid}`, body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app', ...over });
  return boardStore().link(id, link(iid));
};

beforeEach(() => {
  rmSync(join(ATAS, 'board.json'), { force: true });
  forgetTracked();
  host = fakeBoardHost();
  setVcsRuntimeForTests(host.runtime);
});

describe('the read of the issues the board tracks', () => {
  it('reads nothing and says so when the workspace has no usable host', async () => {
    setVcsRuntimeForTests(null);
    const saved = structuredClone(getConfig());
    const bare = structuredClone(saved);
    bare.vcs = [];
    bare.projects.issues.vcsId = null;
    bare.projects.repos = bare.projects.repos.map((r) => ({ ...r, vcsId: null }));
    saveConfig(bare);
    linked(11);
    expect(await readTracked(true)).toBeNull();
    expect(host.reads).toEqual([]);
    saveConfig(saved);
  });

  it('reads a linked card by number and brings it as an item of the day, placed by its board label', async () => {
    host.add(PROJECT, 11, { title: 'Moved on the host', labels: ['board:doing', 'core', 'priority:high'] });
    const card = linked(11);
    const read = await readTracked(true);
    expect(host.reads).toEqual([`projects/${encodeURIComponent(PROJECT)}/issues/11`]);
    expect(read?.items).toHaveLength(1);
    expect(read?.items[0]).toMatchObject({ kind: 'issue', ref: 'app#11', iid: 11, project: PROJECT, title: 'Moved on the host', stage: 'Doing' });
    expect(read?.seen[card.id]).toMatchObject({ state: 'open', title: 'Moved on the host', stageId: 'doing', labels: ['board:doing', 'core', 'priority:high'] });
  });

  it('says closed for a closed issue and brings no item for it', async () => {
    host.add(PROJECT, 12, { state: 'closed' });
    const card = linked(12);
    const read = await readTracked(true);
    expect(read?.items).toEqual([]);
    expect(read?.seen[card.id].state).toBe('closed');
  });

  it('says missing when the host does not return the issue, and unread for any other failure', async () => {
    host.add(PROJECT, 14, {});
    const gone = linked(13);
    const fine = linked(14);
    const read = await readTracked(true);
    expect(read?.seen[gone.id].state).toBe('missing');
    expect(read?.seen[fine.id].state).toBe('open');

    // A host that cannot be read now: the stored copy is what stays, and the answer says it was not read.
    forgetTracked();
    const other = linked(15);
    const broken = fakeBoardHost();
    broken.add(PROJECT, 15, {});
    const original = broken.runtime.provider.getIssue;
    broken.runtime.provider.getIssue = async (project, iid) => {
      if (iid === 15) throw new Error('timeout');
      return original(project, iid);
    };
    setVcsRuntimeForTests(broken.runtime);
    const again = await readTracked(true);
    expect(again?.seen[other.id].state).toBe('unread');
    expect(again?.items.map((i) => i.iid)).not.toContain(15);
  });

  it('tracks the open cards and the closed ones of the last seven days, newest update first, at most fifty', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    for (let i = 0; i < TRACKED_MAX + 5; i++) linked(1000 + i);
    expect(trackedCards(now)).toHaveLength(TRACKED_MAX);
    const all = boardStore().list();
    const newest = [...all].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    expect(trackedCards()[0].updatedAt).toBe(newest.updatedAt);

    const old = linked(2000);
    boardStore().close(old.id);
    const closedNow = Date.parse(boardStore().get(old.id)!.updatedAt);
    expect(trackedCards(closedNow + 6 * 86_400_000).some((c) => c.id === old.id)).toBe(true);
    expect(trackedCards(closedNow + 8 * 86_400_000).some((c) => c.id === old.id)).toBe(false);
  });

  it('does not read a card that has no link', async () => {
    boardStore().create({ id: 'local001', title: 'Only here', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });
    const read = await readTracked(true);
    expect(read?.items).toEqual([]);
    expect(read?.seen).toEqual({});
    expect(host.reads).toEqual([]);
  });

  it('reuses a read for five minutes unless asked again, and again after a write cleared it', async () => {
    host.add(PROJECT, 21, {});
    linked(21);
    await readTracked(false);
    await readTracked(false);
    expect(host.reads).toHaveLength(1);
    await readTracked(true);
    expect(host.reads).toHaveLength(2);
    forgetTracked();
    await readTracked(false);
    expect(host.reads).toHaveLength(3);
  });

  it('does not read by number an issue a listing already holds', async () => {
    const issue = host.add(PROJECT, 31, { title: 'Listed' });
    linked(31);
    const provider = host.runtime.provider;
    const listed = await provider.listIssues({ project: PROJECT, scope: 'all', limit: 100 });
    host.reads.length = 0;
    const read = await readTracked(true, listed);
    expect(host.reads).toEqual([]);
    expect(read?.items[0].title).toBe(issue.title);
  });
});

describe('the board\'s copy follows the host', () => {
  it('takes the host\'s title, column, labels, priority and squad into the card, with a line of history, and deletes nothing', async () => {
    host.add(PROJECT, 41, { title: 'Renamed on the host', labels: ['board:doing', 'priority:low', 'core', 'bug'] });
    const card = linked(41, { title: 'Original', column: 'backlog' });
    const read = (await readTracked(true))!;
    mirrorTracked(read);
    const after = boardStore().get(card.id)!;
    expect(after).toMatchObject({ title: 'Renamed on the host', column: 'doing', priority: 'priority:low', squad: 'core', state: 'open' });
    // The app's own stage label is not part of the card's labels; the person's own are.
    expect(after.labels.sort()).toEqual(['bug', 'core', 'priority:low']);
    expect(after.history.filter((h) => h.kind === 'host').map((h) => h.text)).toEqual(['title', 'column', 'labels']);
    expect(boardStore().list()).toHaveLength(1);
  });

  it('writes the file only when something changed', async () => {
    host.add(PROJECT, 42, { title: 'Card 42', labels: ['board:backlog'] });
    const card = linked(42);
    mirrorTracked((await readTracked(true))!);
    const before = JSON.stringify(boardStore().get(card.id));
    mirrorTracked((await readTracked(true))!);
    expect(JSON.stringify(boardStore().get(card.id))).toBe(before);
  });

  it('closes the copy when the host closed the issue, and leaves a card the host did not return as it was', async () => {
    host.add(PROJECT, 43, { state: 'closed' });
    const closed = linked(43);
    const lost = linked(44, { title: 'Lost' });
    mirrorTracked((await readTracked(true))!);
    expect(boardStore().get(closed.id)?.state).toBe('closed');
    expect(boardStore().get(lost.id)).toMatchObject({ title: 'Lost', state: 'open' });
    expect(boardStore().get(lost.id)?.history.some((h) => h.kind === 'host')).toBe(false);
  });
});
