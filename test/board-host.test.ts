import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeBoardHost } from './helpers/boardHost';

// The board's door to the code host: what a card does to the issue it became, over a fake GitLab that records every command it is handed. The board's own
// autonomy decides whether a write goes out at once (executed and audited) or waits in Actions for the person's "yes"; a test workspace refuses both.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-board-host-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { setTestFlag } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { listAudit } = await import('../src/main/auditoria');
const { boardStore } = await import('../src/main/boardSource');
const { boardView, register, setBoardHost } = await import('../src/main/board');
const { realBoardHost } = await import('../src/main/boardHost');
const { forgetHost } = await import('../src/main/vcs/boardRead');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const PROJECT = 'acme/app';
const ENDPOINT = `projects/${encodeURIComponent(PROJECT)}/issues`;
const base = structuredClone(getConfig());
base.language = 'en';
base.vcs = [{ id: 'gitlab', kind: 'gitlab', host: 'git.acme.test', apiUrl: '', user: '', secretRef: null, cliPreference: 'cli', cliCommand: null }];
base.projects.issues.vcsId = 'gitlab';
base.projects.issues.project = PROJECT;
base.projects.issues.refPrefix = 'app#';
base.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: 'gitlab', projectPath: PROJECT }];
base.devCycle.stages = [
  { id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 },
  { id: 'doing', label: 'Doing', match: [], kind: 'development', rank: 1 },
  { id: 'review', label: 'Review', match: [], kind: 'review', rank: 2 },
];
base.devCycle.stageMapping = [];
base.devCycle.priority.labels = ['^priority:high$', '^priority:low$'];
base.squads = [{ id: 'core', name: 'Core', mission: '', label: 'core', liaison: null, autonomy: true, scope: { labels: [], repos: [], paths: [], unclaimed: false } }];

// The refusal of a workspace of test, in the language the workspace speaks.
const REFUSED = /Test workspace/;

// The handlers exactly as the app registers them, over the door the app hands in.
const handlers = new Map<string, (...args: never[]) => unknown>();
const events: unknown[] = [];
setBoardHost(realBoardHost);
register({
  handle: (channel: string, fn: (...args: never[]) => unknown) => handlers.set(channel, fn),
  notify: () => undefined,
  emit: (ev: unknown) => events.push(ev),
  job: () => undefined,
} as never);
const call = async (channel: string, ...args: unknown[]): Promise<any> => handlers.get(channel)!(...(args as never[]));

let host = fakeBoardHost();

/** The workspace's config for a test: the board's autonomy, and any change to the cycle. */
function configure(autonomy: boolean, tweak: (c: typeof base) => void = () => undefined): void {
  const c = structuredClone(base);
  c.runner.autonomy.board = autonomy;
  tweak(c);
  saveConfig(c);
}

beforeEach(() => {
  setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
  for (const f of ['board.json', 'acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  forgetHost();
  host = fakeBoardHost();
  setVcsRuntimeForTests(host.runtime);
  setBoardHost(realBoardHost);
  configure(true);
  events.length = 0;
});

const open = (over: Record<string, unknown> = {}) => call('board:create', { title: 'A card', body: 'What to do', column: 'backlog', repo: 'app', ...over });
const issueOf = (iid: number) => host.find(PROJECT, iid)!;

/** A card already linked to an issue the fake holds, labelled as given. */
function linkedCard(labels: string[], over: Partial<Parameters<ReturnType<typeof boardStore>['create']>[0]> = {}): string {
  const id = `link${String(boardStore().list().length + 1).padStart(4, '0')}`;
  const iid = 200 + boardStore().list().length;
  host.add(PROJECT, iid, { title: 'A card', labels });
  boardStore().create({ id, title: 'A card', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app', ...over });
  boardStore().link(id, { vcs: 'gitlab', project: PROJECT, iid, url: `https://git.acme.test/${PROJECT}/-/issues/${iid}`, linkedAt: '2026-10-07T09:00:00.000Z' });
  return id;
}
const iidOf = (id: string): number => boardStore().get(id)!.host!.iid;

describe('with the board\'s autonomy on', () => {
  it('opens a card as one issue in the issue project, with the card\'s title, description and labels, audited once', async () => {
    const card = await open({ squad: 'core', priority: 'priority:high' });
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0]).toMatchObject({ method: 'POST', endpoint: ENDPOINT, fields: { title: 'A card', description: 'What to do', labels: 'board:backlog,core,priority:high' } });
    expect(issueOf(101).labels).toEqual(['board:backlog', 'core', 'priority:high']);
    const saved = boardStore().get(card.id)!;
    expect(saved.host).toMatchObject({ vcs: 'gitlab', project: PROJECT, iid: 101, url: `https://git.acme.test/${PROJECT}/-/issues/101` });
    expect(saved.hostNote).toBeUndefined();
    expect(saved.history.map((h) => h.kind)).toEqual(['created', 'sent']);
    const audit = listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ ok: true, by: 'board', target: `POST ${ENDPOINT}` });
    expect(audit[0].origin.summary).toContain('A card');
    expect(events.length).toBeGreaterThan(0);
  });

  it('puts the comments written before it reached the host in the description under "Notes so far"', async () => {
    // A card made before the host was connected, with a comment already written on it.
    const local = boardStore().create({ id: 'early001', title: 'Early', body: 'Body', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });
    boardStore().comment(local.id, 'first thought');
    await call('board:send', local.id);
    expect(host.commands.at(-1)?.fields.description).toBe('Body\n\nNotes so far\n- first thought');
  });

  it('sends a card once: a second send is refused and no second issue is made', async () => {
    const card = await open();
    await expect(call('board:send', card.id)).rejects.toThrow(/already on the code host/);
    expect(host.issues).toHaveLength(1);
  });

  it('moves a card by adding the column\'s label and taking off only the app\'s own label for another column', async () => {
    const id = linkedCard(['board:backlog', 'bug', 'priority:low', 'core']);
    const moved = await call('board:update', id, { column: 'doing' });
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0]).toMatchObject({ method: 'PUT', fields: { add_labels: 'board:doing', remove_labels: 'board:backlog' } });
    expect(issueOf(iidOf(id)).labels.sort()).toEqual(['board:doing', 'bug', 'core', 'priority:low']);
    expect(moved.column).toBe('doing');
  });

  it('writes the label of a mapping rule that is a plain name, and the default for one that is not', async () => {
    configure(true, (c) => {
      c.devCycle.stageMapping = [
        { provider: 'any', source: 'label', name: '', pattern: '^in progress$', stage: 'doing' },
        { provider: 'any', source: 'label', name: '', pattern: 'rev(iew)?', stage: 'review' },
      ];
    });
    const id = linkedCard(['bug']);
    await call('board:update', id, { column: 'doing' });
    expect(issueOf(iidOf(id)).labels).toEqual(['bug', 'in progress']);
    await call('board:update', id, { column: 'review' });
    // A regular expression cannot be written: the app's own label is.
    expect(issueOf(iidOf(id)).labels.sort()).toEqual(['board:review', 'bug']);
  });

  it('refuses a move whose label a rule would read as another column, and sends nothing', async () => {
    configure(true, (c) => {
      c.devCycle.stageMapping = [{ provider: 'any', source: 'label', name: '', pattern: '^board:', stage: 'review' }];
    });
    const id = linkedCard([]);
    await expect(call('board:update', id, { column: 'doing' })).rejects.toThrow(/would read the label board:doing as another column/);
    expect(host.commands).toEqual([]);
    expect(boardStore().get(id)?.column).toBe('backlog');
  });

  it('changes the priority and the squad by adding the new label and removing only the one the previous value stood for', async () => {
    const id = linkedCard(['priority:low', 'bug', 'frontend'], { priority: 'priority:low' });
    await call('board:update', id, { priority: 'priority:high', squad: 'core' });
    expect(issueOf(iidOf(id)).labels.sort()).toEqual(['bug', 'core', 'frontend', 'priority:high']);
    expect(boardStore().get(id)).toMatchObject({ priority: 'priority:high', squad: 'core' });
    await call('board:update', id, { squad: null });
    expect(issueOf(iidOf(id)).labels.sort()).toEqual(['bug', 'frontend', 'priority:high']);
  });

  it('plans no command, and changes the copy at once, when the issue already carries the label', async () => {
    const id = linkedCard(['board:doing']);
    await call('board:update', id, { column: 'doing' });
    expect(host.commands).toEqual([]);
    expect(boardStore().get(id)?.column).toBe('doing');
  });

  it('comments once on the issue, and closes and reopens it', async () => {
    const id = linkedCard([]);
    await call('board:comment', id, 'a thought');
    expect(issueOf(iidOf(id)).comments).toEqual(['a thought']);
    expect(boardStore().get(id)?.history.filter((h) => h.kind === 'commented')).toHaveLength(1);
    await call('board:close', id);
    expect(issueOf(iidOf(id)).state).toBe('closed');
    expect(boardStore().get(id)?.state).toBe('closed');
    await call('board:reopen', id);
    expect(issueOf(iidOf(id)).state).toBe('opened');
    expect(boardStore().get(id)?.state).toBe('open');
    expect(listAudit().every((l) => l.by === 'board' && l.ok)).toBe(true);
  });

  it('refuses to edit the title or the description of a card on the host', async () => {
    const id = linkedCard([]);
    await expect(call('board:update', id, { title: 'New' })).rejects.toThrow(/belong to the host/);
    await expect(call('board:update', id, { body: 'New' })).rejects.toThrow(/belong to the host/);
    expect(host.commands).toEqual([]);
  });

  it('keeps the card, local and said so, when the workspace has no issue project', async () => {
    configure(true, (c) => {
      c.projects.issues.project = null;
    });
    const card = await open();
    expect(card.host).toBeUndefined();
    expect(card.hostNote).toMatchObject({ kind: 'unsupported' });
    expect(host.commands).toEqual([]);
  });

  it('keeps the card with the reason when the host fails, and sends it later without making a second issue', async () => {
    host.failNext = 'the host said no';
    const card = await open();
    expect(card.host).toBeUndefined();
    expect(card.hostNote).toMatchObject({ kind: 'failed' });
    expect(card.hostNote.text).toContain('the host said no');
    expect(listAudit()[0]).toMatchObject({ ok: false });
    const sent = await call('board:send', card.id);
    expect(sent.host?.iid).toBe(101);
    expect(sent.hostNote).toBeUndefined();
    expect(host.issues.filter((i) => i.title === 'A card')).toHaveLength(1);
  });

  it('marks a card whose issue the host made without saying its number, and links nothing', async () => {
    host.noNumber = true;
    const card = await open();
    expect(card.host).toBeUndefined();
    expect(card.hostNote).toMatchObject({ kind: 'unlinked' });
  });
});

describe('with the board\'s autonomy off', () => {
  beforeEach(() => configure(false));

  it('leaves a creation in Actions with the exact command and sends nothing before the yes', async () => {
    const card = await open();
    expect(host.commands).toEqual([]);
    const waiting = actions.listActions();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ state: 'pending', unit: { purpose: 'board-create', cardId: card.id } });
    expect(waiting[0].command).toMatchObject({ method: 'POST', endpoint: ENDPOINT });
    expect(waiting[0].output).toContain('board:backlog');
    expect(boardStore().get(card.id)?.host).toBeUndefined();
    const view = await boardView();
    expect(view.cards[0]).toMatchObject({ hostState: 'waiting', waiting: { kinds: ['create'], failed: false } });
  });

  it('locks a card that waits: nothing about it changes until the proposal is decided', async () => {
    const card = await open();
    for (const [channel, args] of [
      ['board:update', [card.id, { column: 'doing' }]],
      ['board:comment', [card.id, 'hello']],
      ['board:close', [card.id]],
      ['board:reopen', [card.id]],
      ['board:send', [card.id]],
    ] as const) {
      await expect(call(channel, ...args), channel).rejects.toThrow(/waiting for your yes/);
    }
    expect(boardStore().get(card.id)).toMatchObject({ column: 'backlog', state: 'open' });
  });

  it('links the card when the person says yes, and unlocks it', async () => {
    const card = await open();
    await actions.approveAction(actions.listActions()[0].id);
    expect(host.commands).toHaveLength(1);
    const saved = boardStore().get(card.id)!;
    expect(saved.host).toMatchObject({ project: PROJECT, iid: 101 });
    expect(saved.history.map((h) => h.kind)).toEqual(['created', 'sent']);
    expect(listAudit()).toHaveLength(1);
    expect(events.length).toBeGreaterThan(1);
    expect(await call('board:update', card.id, { column: 'doing' })).toBeTruthy();
  });

  it('says declined when the proposal is skipped, and the card can be sent again', async () => {
    const card = await open();
    await actions.skipAction(actions.listActions()[0].id);
    expect(host.commands).toEqual([]);
    expect(boardStore().get(card.id)?.hostNote).toMatchObject({ kind: 'declined' });
    expect(boardStore().get(card.id)?.host).toBeUndefined();
    await call('board:send', card.id);
    expect(actions.listActions().filter((a) => a.state === 'pending')).toHaveLength(1);
    expect(boardStore().get(card.id)?.hostNote).toBeUndefined();
  });

  it('shows a proposal that failed when approved as failed, and keeps the card locked', async () => {
    const card = await open();
    host.failNext = 'boom';
    await actions.approveAction(actions.listActions()[0].id);
    const view = await boardView();
    expect(view.cards[0]).toMatchObject({ id: card.id, hostState: 'failed', waiting: { failed: true } });
    expect(boardStore().get(card.id)?.host).toBeUndefined();
    await expect(call('board:send', card.id)).rejects.toThrow(/waiting for your yes/);
  });

  it('proposes a move and changes the copy only when the yes comes', async () => {
    const id = linkedCard(['board:backlog', 'bug']);
    await call('board:update', id, { column: 'doing' });
    expect(host.commands).toEqual([]);
    expect(boardStore().get(id)?.column).toBe('backlog');
    const [action] = actions.listActions();
    expect(action).toMatchObject({ state: 'pending', unit: { purpose: 'board-labels', cardId: id } });
    expect(action.command).toMatchObject({ fields: { add_labels: 'board:doing', remove_labels: 'board:backlog' } });
    await actions.approveAction(action.id);
    expect(issueOf(iidOf(id)).labels.sort()).toEqual(['board:doing', 'bug']);
    expect(boardStore().get(id)?.column).toBe('doing');
  });

  it('refuses a second change of labels, or of state, while one waits; comments do not block each other', async () => {
    const id = linkedCard(['board:backlog']);
    await call('board:update', id, { column: 'doing' });
    await expect(call('board:update', id, { column: 'review' })).rejects.toThrow(/already waiting in Actions/);
    await call('board:close', id);
    await expect(call('board:reopen', id)).rejects.toThrow(/already waiting in Actions/);
    await call('board:comment', id, 'one');
    await call('board:comment', id, 'two');
    expect(actions.listActions().filter((a) => a.state === 'pending')).toHaveLength(4);
    expect(host.commands).toEqual([]);
  });

  it('proposes a comment, a close and a reopen, each applied when approved', async () => {
    const id = linkedCard([]);
    await call('board:comment', id, 'a thought');
    await actions.approveAction(actions.listActions()[0].id);
    expect(issueOf(iidOf(id)).comments).toEqual(['a thought']);
    expect(boardStore().get(id)?.history.filter((h) => h.kind === 'commented')).toHaveLength(1);
    await call('board:close', id);
    await actions.approveAction(actions.listActions()[0].id);
    expect(boardStore().get(id)?.state).toBe('closed');
    expect(issueOf(iidOf(id)).state).toBe('closed');
  });
});

describe('an issue the host lists that no card holds', () => {
  const target = () => ({ project: PROJECT, iid: 7 });

  beforeEach(() => {
    host.add(PROJECT, 7, { title: 'Made on the host', labels: ['board:backlog', 'bug', 'priority:low', 'core'] });
  });

  it('moves with the labels it carries, comments and closes, and writes nothing to the board file', async () => {
    expect(await call('board:update', target(), { column: 'doing', priority: 'priority:high' })).toBeNull();
    expect(host.commands).toHaveLength(1);
    expect(issueOf(7).labels.sort()).toEqual(['board:doing', 'bug', 'core', 'priority:high']);
    await call('board:comment', target(), 'seen');
    await call('board:close', target());
    expect(issueOf(7).comments).toEqual(['seen']);
    expect(issueOf(7).state).toBe('closed');
    await call('board:reopen', target());
    expect(issueOf(7).state).toBe('opened');
    expect(existsSync(join(ATAS, 'board.json'))).toBe(false);
  });

  it('takes the squad off by the label of the squad the issue carries, nothing local consulted', async () => {
    await call('board:update', target(), { squad: null });
    expect(issueOf(7).labels.sort()).toEqual(['board:backlog', 'bug', 'priority:low']);
  });

  it('refuses its title and description, and the board it cannot place the labels on', async () => {
    await expect(call('board:update', target(), { title: 'x' })).rejects.toThrow(/belong to the host/);
    (host.runtime.provider as { caps: unknown }).caps = { ...host.runtime.provider.caps, issueLabels: false };
    await expect(call('board:update', target(), { column: 'doing' })).rejects.toThrow(/have no labels/);
    expect(host.commands).toEqual([]);
  });

  it('waits in Actions with the autonomy off, one change of labels at a time', async () => {
    configure(false);
    await call('board:update', target(), { column: 'doing' });
    expect(host.commands).toEqual([]);
    expect(actions.listActions()[0]).toMatchObject({ state: 'pending', issue: 7, unit: { purpose: 'board-labels', cardId: null, project: PROJECT, iid: 7 } });
    await expect(call('board:update', target(), { column: 'review' })).rejects.toThrow(/already waiting in Actions/);
    const view = await boardView(true);
    expect(view.items.find((i) => i.iid === 7)?.waiting).toMatchObject({ kinds: ['labels'] });
    await actions.approveAction(actions.listActions()[0].id);
    expect(issueOf(7).labels.sort()).toEqual(['board:doing', 'bug', 'core', 'priority:low']);
  });

  it('is refused when it is not a number of an issue', async () => {
    await expect(call('board:update', { project: PROJECT, iid: 0 }, { column: 'doing' })).rejects.toThrow(/project and number/);
  });
});

describe('a card on a host whose issues have no labels', () => {
  it('keeps its column, priority and squad on the board, plans no label command, and still reaches the host for the rest', async () => {
    (host.runtime.provider as { caps: unknown }).caps = { ...host.runtime.provider.caps, issueLabels: false };
    const id = linkedCard([]);
    await call('board:update', id, { column: 'doing', priority: 'priority:high' });
    expect(host.commands).toEqual([]);
    expect(boardStore().get(id)).toMatchObject({ column: 'doing', priority: 'priority:high' });
    await call('board:comment', id, 'still reaches');
    await call('board:close', id);
    expect(host.commands).toHaveLength(2);
    const view = await boardView();
    expect(view.host?.labels).toBe(false);
    expect(view.columns.every((c) => c.writes === null)).toBe(true);
  });
});

describe('a workspace of test', () => {
  it.each([true, false])('refuses every write of the board with the autonomy %s, proposes nothing and sends nothing', async (autonomy) => {
    const id = linkedCard(['board:backlog']);
    const free = boardStore().create({ id: 'free0001', title: 'Not sent', body: '', column: 'backlog', squad: null, priority: null, labels: [], repo: 'app' });
    configure(autonomy);
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    const issue = { project: PROJECT, iid: 7 };
    host.add(PROJECT, 7, {});
    const writes: [string, unknown[]][] = [
      ['board:create', [{ title: 'New', column: 'backlog' }]],
      ['board:send', [free.id]],
      ['board:update', [id, { column: 'doing' }]],
      ['board:update', [free.id, { column: 'doing' }]],
      ['board:update', [issue, { column: 'doing' }]],
      ['board:comment', [id, 'x']],
      ['board:comment', [issue, 'x']],
      ['board:close', [id]],
      ['board:close', [issue]],
      ['board:reopen', [id]],
      ['board:reopen', [issue]],
    ];
    for (const [channel, args] of writes) await expect(call(channel, ...args), channel).rejects.toThrow(REFUSED);
    expect(actions.listActions()).toEqual([]);
    expect(host.commands).toEqual([]);
    expect(listAudit()).toEqual([]);
    expect(boardStore().list()).toHaveLength(2);
  });

  it('refuses a proposal approved after the workspace became one of test', async () => {
    configure(false);
    const card = await open();
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    await expect(actions.approveAction(actions.listActions()[0].id)).rejects.toThrow(REFUSED);
    expect(host.commands).toEqual([]);
    expect(boardStore().get(card.id)?.host).toBeUndefined();
  });
});

describe('a workspace with no usable host', () => {
  it('behaves as the board of phase 1: the card stays local, nothing is marked, nothing is read or written', async () => {
    setVcsRuntimeForTests(null);
    const bare = structuredClone(base);
    bare.vcs = [];
    bare.projects.issues.vcsId = null;
    bare.projects.repos = [{ id: 'app', path: DATA, remoteUrl: null, vcsId: null, projectPath: null }];
    saveConfig(bare);
    const card = await open();
    expect(card).toMatchObject({ title: 'A card', state: 'open' });
    expect(card.host).toBeUndefined();
    expect(card.hostNote).toBeUndefined();
    const moved = await call('board:update', card.id, { column: 'doing', title: 'Renamed' });
    expect(moved).toMatchObject({ column: 'doing', title: 'Renamed' });
    await call('board:comment', card.id, 'note');
    // There is no host to send to: the board says so and keeps the card.
    await expect(call('board:send', card.id)).rejects.toThrow(/no code host/);
    await call('board:close', card.id);
    const view = await boardView();
    expect(view.host).toBeNull();
    expect(view.cards[0].hostState).toBe('none');
    expect(host.commands).toEqual([]);
    expect(host.reads).toEqual([]);
    expect(actions.listActions()).toEqual([]);
  });
});
