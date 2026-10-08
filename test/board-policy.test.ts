import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { t } from '../src/shared/i18n';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

// Another data root: the registry this file writes marks the workspace as one of test, so the guard under the board refuses every write, whatever
// it is. Test workspaces are the product's own safety model, and the board is part of it.
const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-policy-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { readRegistry, setTestFlag } = await import('../src/main/workspaces-core');
const { boardStore } = await import('../src/main/boardSource');
const { register } = await import('../src/main/board');
const { DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const FILE = join(import.meta.dirname, '../src/main/board.ts');
const source = readFileSync(FILE, 'utf8');

// The board of a workspace with no code host: its six channels are the workspace's own file, so a paired browser may use them, and nothing in the
// file proposes, runs or approves a write to a code host. The guard that refuses a workspace of test lives in the handler, not in this policy.

const CHANNELS = ['board:list', 'board:create', 'board:update', 'board:comment', 'board:close', 'board:reopen'];
/** The channels that change a card: everything but the read. */
const WRITES = CHANNELS.filter((c) => c !== 'board:list');

// The refusal every handler of the board raises in a test workspace: the wording `main.workspaces.testRefusal`, read in the workspace's language.
const REFUSED = new RegExp(
  t('main.workspaces.testRefusal', { what: '.*' })
    .split('.*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*'),
);

const config = structuredClone(getConfig());
config.vcs = [];
config.projects.issues.vcsId = null;
config.projects.issues.project = null;
config.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: null, projectPath: null }];
config.devCycle.stages = [
  { id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 },
  { id: 'doing', label: 'Doing', match: [], kind: 'development', rank: 1 },
];
config.devCycle.priority.labels = ['^priority:high$', '^priority:low$'];
config.squads = [{ id: 'core', name: 'Core', mission: '', label: 'core', liaison: null, autonomy: true, scope: { labels: [], repos: [], paths: [], unclaimed: false } }];
saveConfig(config);

// The handlers exactly as the app registers them: the same function, over the workspace's own board file.
const handlers = new Map<string, (...args: never[]) => unknown>();
register({
  handle: (channel: string, fn: (...args: never[]) => unknown) => handlers.set(channel, fn),
  notify: () => undefined,
  emit: () => undefined,
  job: () => undefined,
  deps: () => undefined,
} as never);

const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)!(...(args as never[]));

describe('the board in a workspace of test', () => {
  it('refuses opening a card first, before anything of the board is written', () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    expect(readRegistry(DATA_ROOT)?.list.find((w) => w.id === WORKSPACE_ID)?.test).toBe(true);

    expect(() => call('board:create', { title: 'A card', column: 'backlog' })).toThrow(REFUSED);
    // A test workspace has no board at all: the refusal is the guard, not a card that is missing or a column nobody has.
    expect(boardStore().list()).toEqual([]);
  });

  it('refuses moving, commenting, prioritising, giving to a squad, closing and reopening the card itself', () => {
    // The board writes straight to its own file here: the card is there, so a handler that reached `required` and stopped at the guard is the only
    // reading of a refusal.
    const card = boardStore().create({ id: 'test0001', title: 'A card', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });

    // Every write the spec names, each through its own channel, all refused with the reason.
    expect(() => call('board:update', card.id, { column: 'doing' })).toThrow(REFUSED);
    expect(() => call('board:comment', card.id, 'a note')).toThrow(REFUSED);
    expect(() => call('board:update', card.id, { priority: 'priority:high' })).toThrow(REFUSED);
    expect(() => call('board:update', card.id, { squad: 'core' })).toThrow(REFUSED);
    expect(() => call('board:close', card.id)).toThrow(REFUSED);
    // Reopening a closed card of a test workspace: the same refusal, from the same guard.
    boardStore().close(card.id);
    expect(() => call('board:reopen', card.id)).toThrow(REFUSED);
    boardStore().reopen(card.id);

    // Nothing of the card moved: the guard refused, the handler did not work up to it. The only lines of its past are the two this test wrote
    // straight to the file to put the card where `reopen` had something to do.
    expect(boardStore().get(card.id)).toMatchObject({ column: 'backlog', priority: null, squad: null, state: 'open' });
    expect(boardStore().get(card.id)?.history.map((h) => h.kind)).toEqual(['created', 'closed', 'reopened']);
  });

  it('writes the same calls once the workspace is not one of test, so it is the guard that refuses and not the channel', () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    const card = call('board:create', { title: 'Another card', column: 'backlog' }) as { id: string };
    expect(boardStore().get(card.id)?.state).toBe('open');
    expect(call('board:update', card.id, { column: 'doing' })).toMatchObject({ column: 'doing' });
    expect(call('board:close', card.id)).toMatchObject({ state: 'closed' });
    expect(call('board:reopen', card.id)).toMatchObject({ state: 'open' });
  });
});

describe('web policy for the board', () => {
  it('gives a paired browser every channel of the board', () => {
    for (const channel of CHANNELS) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
  });

  it('are exactly the channels the module serves, each one classified here', () => {
    const served = [...source.matchAll(/ctx\.handle\('(board:[\w-]+)'/g)].map((m) => m[1]);
    expect(served.sort()).toEqual([...CHANNELS].sort());
  });
});

describe('the board writes nothing to a code host', () => {
  it('never proposes, runs or approves a host write, and every changing handler goes through the external-write guard', () => {
    expect(source).not.toMatch(/from '\.\/vcs\/(exec|runtime|validate)'/);
    expect(source).not.toMatch(/proposeVcsAction|proposeVcsGroup|proposeRunPush|runVcsAuto|approveAction|externalRefusal|isTestWorkspace/);
    // Opening, moving, commenting, prioritising, giving to a squad and closing a card all pass the same guard as the rest of the app: the body of
    // each write handler carries it before it touches the board. A guard moved off a handler, or a handler left without one, fails here.
    for (const channel of WRITES) {
      const at = source.indexOf(`ctx.handle('${channel}'`);
      expect(at, channel).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf('\n  });', at));
      expect(body, channel).toMatch(/assertExternalWrite\(/);
    }
  });
});
