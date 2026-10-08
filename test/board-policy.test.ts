import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { t } from '../src/shared/i18n';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';
import { fakeBoardHost } from './helpers/boardHost';

// Another data root: the registry this file writes marks the workspace as one of test, so the guard under the board refuses every write, whatever
// it is. Test workspaces are the product's own safety model, and the board is part of it.
const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-policy-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { readRegistry, setTestFlag } = await import('../src/main/workspaces-core');
const { boardStore } = await import('../src/main/boardSource');
const { register, setBoardHost } = await import('../src/main/board');
const { realBoardHost } = await import('../src/main/boardHost');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const actions = await import('../src/main/actions');
const { DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const MAIN = join(import.meta.dirname, '../src/main');
const SHARED = join(import.meta.dirname, '../src/shared');
const FILE = join(MAIN, 'board.ts');
const source = readFileSync(FILE, 'utf8');

// The board's seven channels change the workspace's own file or, through the door, a code host; a paired browser may use them, and the guard that refuses a
// workspace of test lives in each handler, not in this policy. The door (`boardHost.ts`) is the one board file that reaches the host and Actions.

const CHANNELS = ['board:list', 'board:create', 'board:send', 'board:update', 'board:comment', 'board:close', 'board:reopen'];
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
} as never);

const call = async (channel: string, ...args: unknown[]): Promise<any> => handlers.get(channel)!(...(args as never[]));

describe('the board in a workspace of test', () => {
  it('refuses opening a card first, before anything of the board is written', async () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    expect(readRegistry(DATA_ROOT)?.list.find((w) => w.id === WORKSPACE_ID)?.test).toBe(true);

    await expect(call('board:create', { title: 'A card', column: 'backlog' })).rejects.toThrow(REFUSED);
    // A test workspace has no board at all: the refusal is the guard, not a card that is missing or a column nobody has.
    expect(boardStore().list()).toEqual([]);
  });

  it('refuses moving, commenting, prioritising, giving to a squad, closing and reopening the card itself', async () => {
    // The board writes straight to its own file here: the card is there, so a handler that reached `required` and stopped at the guard is the only
    // reading of a refusal.
    const card = boardStore().create({ id: 'test0001', title: 'A card', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });

    // Every write the spec names, each through its own channel, all refused with the reason.
    await expect(call('board:update', card.id, { column: 'doing' })).rejects.toThrow(REFUSED);
    await expect(call('board:comment', card.id, 'a note')).rejects.toThrow(REFUSED);
    await expect(call('board:update', card.id, { priority: 'priority:high' })).rejects.toThrow(REFUSED);
    await expect(call('board:update', card.id, { squad: 'core' })).rejects.toThrow(REFUSED);
    await expect(call('board:close', card.id)).rejects.toThrow(REFUSED);
    // Reopening a closed card of a test workspace: the same refusal, from the same guard.
    boardStore().close(card.id);
    await expect(call('board:reopen', card.id)).rejects.toThrow(REFUSED);
    boardStore().reopen(card.id);

    // Nothing of the card moved: the guard refused, the handler did not work up to it. The only lines of its past are the two this test wrote
    // straight to the file to put the card where `reopen` had something to do.
    expect(boardStore().get(card.id)).toMatchObject({ column: 'backlog', priority: null, squad: null, state: 'open' });
    expect(boardStore().get(card.id)?.history.map((h) => h.kind)).toEqual(['created', 'closed', 'reopened']);
  });

  it('writes the same calls once the workspace is not one of test, so it is the guard that refuses and not the channel', async () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    const card = (await call('board:create', { title: 'Another card', column: 'backlog' })) as { id: string };
    expect(boardStore().get(card.id)?.state).toBe('open');
    expect(await call('board:update', card.id, { column: 'doing' })).toMatchObject({ column: 'doing' });
    expect(await call('board:close', card.id)).toMatchObject({ state: 'closed' });
    expect(await call('board:reopen', card.id)).toMatchObject({ state: 'open' });
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

/** The module specifiers a file imports (`from '...'` and `import('...')`). */
const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((m) => m[1]);
const files = (dir: string, pattern: RegExp): string[] => readdirSync(dir).filter((f) => pattern.test(f)).map((f) => join(dir, f));

// The names of the door's functions: the proposal, the unattended write, the approval and the listeners of what became of a proposal.
const DOOR = /proposeVcsAction|proposeVcsGroup|proposeVcsCommands|proposeRunPush|runVcsAuto|approveAction|onActionDone|onActionSkipped|externalRefusal|isTestWorkspace/;

describe('which board file may reach the code host', () => {
  const door = join(MAIN, 'boardHost.ts');
  const board = [join(MAIN, 'board.ts'), join(MAIN, 'boardSource.ts'), join(MAIN, 'board-core.ts'), ...files(SHARED, /^board.*\.ts$/)];

  it('keeps the host and Actions out of the board proper, its store, its file and its pure part', () => {
    expect(board.length).toBeGreaterThanOrEqual(5);
    for (const file of board) {
      const text = readFileSync(file, 'utf8');
      for (const spec of importsOf(file)) expect(spec, file).not.toMatch(/(^|\/)(vcs|actions)(\/|$)/);
      expect(text, file).not.toMatch(DOOR);
    }
  });

  it('lets only the door import Actions, and keeps the executors and the validator out of every board file', () => {
    const all = [...board, door, ...files(join(MAIN, 'vcs'), /^board.*\.ts$/)];
    for (const file of all) {
      const imports = importsOf(file);
      expect(imports.some((s) => /(^|\/)actions$/.test(s)), file).toBe(file === door);
      expect(imports.filter((s) => /vcs\/(exec|runtime|validate)$/.test(s)), file).toEqual([]);
    }
  });

  it('keeps the door from approving or proposing a single command', () => {
    const text = readFileSync(door, 'utf8');
    expect(text).not.toMatch(/approveAction|proposeVcsAction\b/);
    // What it does use: the grouped proposal, the audited unattended write, and the two listeners.
    expect(text).toMatch(/proposeVcsGroup/);
    expect(text).toMatch(/runVcsAuto/);
  });

  it('reads the host from files that cannot write to it', () => {
    for (const file of files(join(MAIN, 'vcs'), /^board.*\.ts$/)) expect(readFileSync(file, 'utf8'), file).not.toMatch(DOOR);
  });
});

describe('every write of the board is guarded', () => {
  it('carries the external-write guard in the body of each changing handler, before anything is sent', () => {
    expect(source).not.toMatch(/from '\.\/vcs\/(exec|runtime|validate)'/);
    for (const channel of WRITES) {
      const at = source.indexOf(`ctx.handle('${channel}'`);
      expect(at, channel).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf('\n  });', at));
      expect(body, channel).toMatch(/assertExternalWrite\(/);
      // The guard comes before the port: a test workspace never plans, proposes or reads for a write.
      const guard = body.indexOf('assertExternalWrite(');
      for (const reach of ['host.send(', 'sendCard(', 'run(plan)']) {
        const first = body.indexOf(reach);
        if (first >= 0) expect(guard, `${channel} ${reach}`).toBeLessThan(first);
      }
    }
  });
});

describe('a workspace of test with a host that is ready', () => {
  it('refuses every write of the board, for a card of the board and for a listed issue, and proposes and sends nothing', async () => {
    const host = fakeBoardHost();
    host.add('acme/app', 7, { labels: ['board:backlog'] });
    setVcsRuntimeForTests(host.runtime);
    setBoardHost(realBoardHost);
    const hosted = structuredClone(getConfig());
    hosted.vcs = [{ id: 'gitlab', kind: 'gitlab', host: 'git.acme.test', apiUrl: '', user: '', secretRef: null, cliPreference: 'cli', cliCommand: null }];
    hosted.projects.issues.vcsId = 'gitlab';
    hosted.projects.issues.project = 'acme/app';
    hosted.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: 'gitlab', projectPath: 'acme/app' }];
    for (const autonomy of [true, false]) {
      hosted.runner.autonomy.board = autonomy;
      saveConfig(hosted);
      setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
      const card = boardStore().create({ id: `host000${autonomy ? 1 : 2}`, title: 'Not sent', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });
      setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
      const issue = { project: 'acme/app', iid: 7 };
      const writes: [string, unknown[]][] = [
        ['board:create', [{ title: 'New', column: 'backlog' }]],
        ['board:send', [card.id]],
        ['board:update', [card.id, { column: 'doing' }]],
        ['board:update', [issue, { column: 'doing' }]],
        ['board:comment', [card.id, 'x']],
        ['board:comment', [issue, 'x']],
        ['board:close', [card.id]],
        ['board:close', [issue]],
        ['board:reopen', [card.id]],
        ['board:reopen', [issue]],
      ];
      for (const [channel, args] of writes) await expect(call(channel, ...args), `${channel} ${autonomy}`).rejects.toThrow(REFUSED);
    }
    expect(actions.listActions()).toEqual([]);
    expect(host.commands).toEqual([]);
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
  });
});
