import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeBoardHost } from './helpers/boardHost';

// What the board screen is handed: the cards with where each stands in relation to the host, the host's own issues, and the lines about the read. A fake
// GitLab holds the issues; the data folder is a throwaway one.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-view-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { ATAS } = await import('../src/main/env');
const { boardStore } = await import('../src/main/boardSource');
const { boardView, setBoardHost } = await import('../src/main/board');
const { realBoardHost } = await import('../src/main/boardHost');
const { forgetHost } = await import('../src/main/vcs/boardRead');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const PROJECT = 'acme/app';
const bare = structuredClone(getConfig());
bare.language = 'en';
bare.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: null, projectPath: null }];
bare.devCycle.stages = [
  { id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 },
  { id: 'doing', label: 'Doing', match: [], kind: 'development', rank: 1 },
];
const hosted = structuredClone(bare);
hosted.vcs = [{ id: 'gitlab', kind: 'gitlab', host: 'git.acme.test', apiUrl: '', user: '', secretRef: null, cliPreference: 'cli', cliCommand: null }];
hosted.projects.issues.vcsId = 'gitlab';
hosted.projects.issues.project = PROJECT;
hosted.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: 'gitlab', projectPath: PROJECT }];

let host = fakeBoardHost();
const open = (id: string) => boardStore().create({ id, title: `Card ${id}`, body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });

beforeEach(() => {
  rmSync(join(ATAS, 'board.json'), { force: true });
  forgetHost();
  host = fakeBoardHost();
  setVcsRuntimeForTests(host.runtime);
  setBoardHost(realBoardHost);
  saveConfig(hosted);
});

describe('the board view', () => {
  it('is the board of phase 1 where the workspace has no usable host: no host, no items, nothing marked, nothing read', async () => {
    setVcsRuntimeForTests(null);
    saveConfig(bare);
    open('plain001');
    const view = await boardView();
    expect(view.host).toBeNull();
    expect(view.items).toEqual([]);
    expect(view.projects).toEqual([]);
    expect(view.cards.map((c) => c.hostState)).toEqual(['none']);
    expect(host.reads).toEqual([]);
  });

  it('names the host, the time of the read and the host\'s own issues beside the cards of the board', async () => {
    host.add(PROJECT, 5, { title: 'Held by the host', labels: ['board:doing'] });
    open('local001');
    const view = await boardView(true);
    expect(view.host).toMatchObject({ name: 'GitLab', labels: true, error: null });
    expect(view.host?.readAt).toBeTruthy();
    expect(view.projects).toEqual([{ project: PROJECT, count: 1, truncated: false, error: null }]);
    expect(view.items).toMatchObject([{ key: `${PROJECT}#5`, title: 'Held by the host', column: 'doing' }]);
    expect(view.cards.map((c) => [c.id, c.hostState])).toEqual([['local001', 'notSent']]);
  });

  it('says where a card stands: linked, outside the host, or not read', async () => {
    host.add(PROJECT, 7, {});
    open('linked01');
    open('gone0001');
    boardStore().link('linked01', { vcs: 'gitlab', project: PROJECT, iid: 7, url: 'https://git.acme.test/acme/app/-/issues/7', linkedAt: '2026-10-07T09:00:00.000Z' });
    boardStore().link('gone0001', { vcs: 'gitlab', project: PROJECT, iid: 99, url: 'https://git.acme.test/acme/app/-/issues/99', linkedAt: '2026-10-07T09:00:00.000Z' });
    const view = await boardView(true);
    expect(Object.fromEntries(view.cards.map((c) => [c.id, c.hostState]))).toEqual({ linked01: 'linked', gone0001: 'missing' });
    // The card the host holds is one entry: the listed issue it stands for is not an item as well.
    expect(view.items).toEqual([]);
  });

  it('keeps the card and says the read failed when the host cannot be read as a whole', async () => {
    open('local002');
    setBoardHost({ ...realBoardHost, read: async () => ({ at: '2026-10-07T10:00:00.000Z', noProject: false, projects: [], items: [], seen: {}, error: 'the host answered 500' }) });
    const view = await boardView();
    expect(view.host?.error).toBe('the host answered 500');
    expect(view.cards).toHaveLength(1);
  });
});
