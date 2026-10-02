import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseAction } from '../src/shared/types';
import { type Fixture, IDENTITY, cloneSnapshot, git, makeFixture, originSha } from './helpers/conflictRepos';

const proposeSpy = vi.hoisted(() => vi.fn());

vi.mock('../src/main/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/agents')>()),
  conflictPropose: proposeSpy,
  conflictAsk: vi.fn(),
  rewriteQaComment: vi.fn(),
}));

const { approveAction, conflictApply, conflictChoose, conflictCommit, conflictDiscard, conflictHooks, conflictPrepare, conflictPropose, conflictReopen, listActions, skipAction } = await import('../src/main/actions');
const { saveVerifyCommands } = await import('../src/main/conflictVerify');
const { ATAS } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();

const ACTIONS = join(ATAS, 'acoes.json');
const AUDIT = join(ATAS, 'auditoria.jsonl');
let f: Fixture;
const qa = vi.fn();

function seed(fx: Fixture): string {
  const action: Partial<ReleaseAction> = {
    id: 'c1',
    key: 'conflict:grp/proj!1234:abc',
    kind: 'conflict',
    issue: 15526,
    issueTitle: 'Fixture issue',
    stage: 'STAGE:: Test OK',
    release: '99.0.0',
    mrs: [{ ref: 'grp/proj!1234', url: 'https://example.test/mr/1234', branch: fx.branch, behind: 1 }],
    files: ['app.js', 'old.txt'],
    retest: false,
    state: 'pending',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    output: null,
    noteId: null,
    currentBody: null,
    proposedBody: null,
    sessionId: null,
    msgs: [],
    summary: null,
    command: null,
    unit: { project_path: fx.project, mr_iid: 1234, mr_ref: 'grp/proj!1234', source_branch: fx.branch, target_branch: 'main', repo: '/nonexistent/mirror/grp/proj.git' },
  };
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(ACTIONS, JSON.stringify({ releaseSeen: null, actions: [action] }));
  return 'c1';
}

const get = (id: string): ReleaseAction => listActions().find((a) => a.id === id) as ReleaseAction;
const wtList = (): string => git(f.clone, 'worktree', 'list', '--porcelain');

// The stub agent combines both sides, as a complementary conflict asks for.
function combineStub(): void {
  proposeSpy.mockImplementation(async (p: { hunks: { id: string; ours: string; theirs: string; base: string | null }[] }) => ({
    summary: 'Both sides registered different handlers.',
    items: p.hunks.map((h) => ({ id: h.id, resolution: h.ours + h.theirs, explanation: 'combina os dois', confidence: 'alta' as const, test: 'rodar o módulo' })),
  }));
}

async function toProposed(id: string): Promise<void> {
  await conflictPrepare(id);
  await conflictPropose(id);
}

function decideAll(id: string): void {
  const r = get(id).resolve;
  for (const file of r?.files ?? []) {
    for (const h of file.hunks) conflictChoose(id, h.id, h.whole ? 'theirs' : 'proposal');
  }
}

beforeAll(() => {
  Object.assign(process.env, IDENTITY);
});

beforeEach(() => {
  rmSync(ATAS, { recursive: true, force: true });
  f = makeFixture();
  conflictHooks.cloneRoots = f.cloneRoots;
  conflictHooks.scheduleQaComment = qa;
  qa.mockReset();
  proposeSpy.mockReset();
  combineStub();
  saveVerifyCommands({});
});

afterEach(() => {
  rmSync(f.root, { recursive: true, force: true });
});

describe('prepare', () => {
  it('builds the worktree from the user clone without touching it', async () => {
    const id = seed(f);
    const before = cloneSnapshot(f);
    const a = await conflictPrepare(id);
    const r = a.resolve;
    expect(r?.worktree).toBe(join(ATAS, 'conflicts', 'proj-1234'));
    expect(r?.clone).toBe(f.clone);
    expect(r?.syncBranch).toBe('sync/1234');
    expect(r?.originSha).toBe(originSha(f, f.branch));
    expect(wtList()).toContain(`worktree ${r?.worktree}`);
    expect(git(r?.worktree as string, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('sync/1234');
    expect(git(r?.worktree as string, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toBeTruthy();

    const app = r?.files.find((x) => x.path === 'app.js')?.hunks;
    expect(app).toHaveLength(1);
    expect(app?.[0].ours).toBe('register("from-branch");\n');
    expect(app?.[0].theirs).toBe('register("from-main");\n');
    expect(app?.[0].base).toBe('');
    const old = r?.files.find((x) => x.path === 'old.txt')?.hunks[0];
    expect(old).toMatchObject({ whole: true, oursGone: false, theirsGone: true, ours: 'old content\nbranch edit\n' });

    // The clone: same HEAD, branch, index, untracked work and git config.
    expect(cloneSnapshot(f)).toEqual(before);
    expect(get(id).state).toBe('pending');
  });

  it('refuses to prepare twice, without a clone, or over a foreign sync branch', async () => {
    const id = seed(f);
    await conflictPrepare(id);
    await expect(conflictPrepare(id)).rejects.toThrow(/já está preparado/);
    await conflictDiscard(id);

    conflictHooks.cloneRoots = [join(f.root, 'elsewhere')];
    await expect(conflictPrepare(id)).rejects.toThrow(/não achei um clone local/);
    conflictHooks.cloneRoots = f.cloneRoots;

    git(f.clone, 'branch', 'sync/1234', 'HEAD');
    await expect(conflictPrepare(id)).rejects.toThrow(/não é deste app/);
    expect(existsSync(join(ATAS, 'conflicts', 'proj-1234'))).toBe(false);
  });
});

describe('propose and choose', () => {
  it('stores a proposal per hunk and keeps the sensitive files away from the agent', async () => {
    const id = seed(f);
    await toProposed(id);
    expect(proposeSpy).toHaveBeenCalledTimes(1);
    const sent = proposeSpy.mock.calls[0][0] as { hunks: { id: string; file: string; base: string | null }[]; worktree: string };
    expect(sent.hunks.map((h) => h.file).sort()).toEqual(['app.js', 'old.txt']);
    expect(sent.worktree).toBe(join(ATAS, 'conflicts', 'proj-1234'));

    const h = get(id).resolve?.files.find((x) => x.path === 'app.js')?.hunks[0];
    expect(h).toMatchObject({ proposal: 'register("from-branch");\nregister("from-main");\n', confidence: 'alta', explanation: 'combina os dois', choice: null });
    expect(get(id).resolve?.proposedAt).toBeTruthy();
    expect(get(id).resolve?.proposalSummary).toContain('handlers');
  });

  it('after a partial proposal, asking again sends only the hunks still without one and keeps the others', async () => {
    const id = seed(f);
    await conflictPrepare(id);
    proposeSpy.mockImplementationOnce(async (p: { hunks: { id: string; ours: string; theirs: string }[] }) => ({
      summary: 'parcial',
      items: [p.hunks[0]].map((h) => ({ id: h.id, resolution: h.ours + h.theirs, explanation: 'primeiro', confidence: 'alta' as const, test: 't' })),
      failed: p.hunks.slice(1).map((h) => h.id),
    }));
    await conflictPropose(id);
    const first = (proposeSpy.mock.calls[0][0] as { hunks: { id: string }[] }).hunks.map((h) => h.id);
    expect(first.length).toBeGreaterThan(1);
    combineStub();
    await conflictPropose(id);
    const second = (proposeSpy.mock.calls[1][0] as { hunks: { id: string }[] }).hunks.map((h) => h.id);
    expect(second).toEqual(first.slice(1));
    const hunks = get(id).resolve?.files.flatMap((x) => x.hunks).filter((h) => !h.sensitive) ?? [];
    expect(hunks.every((h) => h.proposal)).toBe(true);
    expect(hunks.find((h) => h.id === first[0])?.explanation).toBe('primeiro');
  });

  it('validates choices and edited text', async () => {
    const id = seed(f);
    await toProposed(id);
    const hid = 'app.js#0';
    expect(() => conflictChoose(id, 'nope#0', 'ours')).toThrow(/não existe/);
    expect(() => conflictChoose(id, hid, 'edit')).toThrow(/falta o texto/);
    expect(() => conflictChoose(id, hid, 'edit', 'x\n<<<<<<< HEAD\ny\n')).toThrow(/marcador/);
    expect(() => conflictChoose(id, '*', 'ours')).toThrow(/só vale para a proposta/);
    conflictChoose(id, hid, 'edit', 'my text\n');
    expect(get(id).resolve?.files[0].hunks[0]).toMatchObject({ choice: 'edit', edited: 'my text\n' });
    conflictChoose(id, '*', 'proposal');
    expect(get(id).resolve?.files.flatMap((x) => x.hunks).filter((h) => h.choice === 'proposal')).toHaveLength(2);
  });
});

describe('apply, verify and commit', () => {
  it('refuses without a verification command unless the user confirms going without tests', async () => {
    const id = seed(f);
    await toProposed(id);
    decideAll(id);
    await expect(conflictApply(id, { skipTests: false })).rejects.toThrow(/comando de verificação/);
    expect(get(id).resolve?.appliedAt).toBeNull();
    const wt = get(id).resolve?.worktree as string;
    expect(readFileSync(join(wt, 'app.js'), 'utf8')).toContain('<<<<<<<');

    const done = await conflictApply(id, { skipTests: true });
    expect(done.resolve?.verify).toMatchObject({ skipped: true, command: null });
    expect(done.resolve?.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses to apply while a hunk is undecided, or when a proposal still carries markers; writes nothing', async () => {
    const id = seed(f);
    await toProposed(id);
    await expect(conflictApply(id, { skipTests: true })).rejects.toThrow(/falta decidir/);

    proposeSpy.mockImplementation(async (p: { hunks: { id: string }[] }) => ({
      summary: 's',
      items: p.hunks.map((h) => ({ id: h.id, resolution: '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> main\n', explanation: 'e', confidence: 'baixa' as const, test: 't' })),
    }));
    await conflictPropose(id);
    decideAll(id);
    const wt = get(id).resolve?.worktree as string;
    const before = readFileSync(join(wt, 'app.js'), 'utf8');
    await expect(conflictApply(id, { skipTests: true })).rejects.toThrow(/marcador/);
    expect(readFileSync(join(wt, 'app.js'), 'utf8')).toBe(before);
    expect(git(wt, 'diff', '--name-only', '--diff-filter=U').split('\n').sort()).toEqual(['app.js', 'old.txt']);
    expect(get(id).resolve?.appliedAt).toBeNull();
  });

  it('runs the configured command in the worktree, logs it, and commits the merge with the clone identity', async () => {
    saveVerifyCommands({ [f.project]: 'echo "clone=$CLONE_DIR"; grep -c from-main app.js; test ! -e old.txt' });
    const id = seed(f);
    await toProposed(id);
    decideAll(id);
    const a = await conflictApply(id, { skipTests: false });
    const r = a.resolve;
    expect(r?.verify?.exitCode).toBe(0);
    expect(r?.verify?.tail).toContain(`clone=${f.clone}`);
    expect(readFileSync(r?.verify?.log as string, 'utf8')).toContain('clone=');
    expect(r?.commit).toBeTruthy();

    const wt = r?.worktree as string;
    expect(git(wt, 'log', '-1', '--format=%s')).toBe("Merge branch 'main' into 'release/bugfix/1234'");
    expect(git(wt, 'log', '-1', '--format=%B')).not.toMatch(/Co-Authored|Generated/i);
    expect(git(wt, 'log', '-1', '--format=%an <%ae>')).toBe('Fixture Dev <fixture@example.test>');
    expect(git(wt, 'rev-parse', 'HEAD^2')).toBe(r?.mainSha);
    expect(git(wt, 'rev-parse', 'HEAD^1')).toBe(r?.originSha);
    expect(readFileSync(join(wt, 'app.js'), 'utf8')).toBe(
      ['// handlers', 'const a = 1;', '// -- register --', 'register("base");', 'register("from-branch");', 'register("from-main");', '// -- end --', 'module.exports = {};', ''].join('\n'),
    );
    expect(existsSync(join(wt, 'old.txt'))).toBe(false);

    const push = listActions().find((x) => x.kind === 'conflict-push');
    expect(push).toMatchObject({ state: 'pending', issue: 15526 });
    expect(r?.pushId).toBe(push?.id);
    // Nothing reached the remote yet.
    expect(originSha(f, f.branch)).toBe(r?.originSha);
  });

  it('leaves a failing verification to the user: no commit until they decide, and the markers can come back', async () => {
    saveVerifyCommands({ [f.project]: 'echo "FAIL: 1 test"; exit 3' });
    const id = seed(f);
    await toProposed(id);
    decideAll(id);
    const a = await conflictApply(id, { skipTests: false });
    expect(a.resolve?.verify).toMatchObject({ exitCode: 3 });
    expect(a.resolve?.verify?.tail).toContain('FAIL: 1 test');
    expect(a.resolve?.commit).toBeNull();
    expect(listActions().some((x) => x.kind === 'conflict-push')).toBe(false);

    const reopened = await conflictReopen(id);
    expect(reopened.resolve?.appliedAt).toBeNull();
    const wt = reopened.resolve?.worktree as string;
    expect(readFileSync(join(wt, 'app.js'), 'utf8')).toContain('<<<<<<< ');
    conflictChoose(id, 'app.js#0', 'ours');
    saveVerifyCommands({ [f.project]: 'true' });
    const again = await conflictApply(id, { skipTests: false });
    expect(again.resolve?.commit).toBeTruthy();
    expect(readFileSync(join(wt, 'app.js'), 'utf8')).not.toContain('from-main');
  });

  it('reopens with the exact text the merge left, not a re-merge, so the decided hunks still match', async () => {
    saveVerifyCommands({ [f.project]: 'exit 2' });
    const id = seed(f);
    await toProposed(id);
    const wt = get(id).resolve?.worktree as string;
    const snapshot = join(`${wt}.markers`, 'app.js');
    expect(readFileSync(snapshot, 'utf8')).toContain('<<<<<<< ');
    // a re-merge may split hunks differently; mark the snapshot so we can tell which text came back
    writeFileSync(snapshot, `${readFileSync(snapshot, 'utf8')}// as prepared\n`);
    decideAll(id);
    await conflictApply(id, { skipTests: false });
    await conflictReopen(id);
    expect(readFileSync(join(wt, 'app.js'), 'utf8')).toBe(readFileSync(snapshot, 'utf8'));
    decideAll(id);
    saveVerifyCommands({ [f.project]: 'true' });
    expect((await conflictApply(id, { skipTests: false })).resolve?.commit).toBeTruthy();
    await conflictDiscard(id).catch(() => undefined);
  });

  it('removes the snapshot with the worktree', async () => {
    const id = seed(f);
    await conflictPrepare(id);
    const wt = get(id).resolve?.worktree as string;
    expect(existsSync(`${wt}.markers`)).toBe(true);
    await conflictDiscard(id);
    expect(existsSync(`${wt}.markers`)).toBe(false);
  });

  it('commits a failed verification only when asked to', async () => {
    saveVerifyCommands({ [f.project]: 'exit 1' });
    const id = seed(f);
    await toProposed(id);
    decideAll(id);
    await conflictApply(id, { skipTests: false });
    const done = await conflictCommit(id);
    expect(done.resolve?.commit).toBeTruthy();
    expect(listActions().find((x) => x.kind === 'conflict-push')?.output).toContain('código 1');
  });

  it('stops with a clear message when the clone has no git identity, and never writes config', async () => {
    const id = seed(f);
    await toProposed(id);
    decideAll(id);
    const saved = { ...process.env };
    for (const k of Object.keys(IDENTITY)) if (k.includes('NAME') && (k.includes('AUTHOR') || k.includes('COMMITTER')) || k.includes('EMAIL')) delete process.env[k];
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'user.useConfigOnly';
    process.env.GIT_CONFIG_VALUE_0 = 'true';
    const before = cloneSnapshot(f).config;
    try {
      await expect(conflictApply(id, { skipTests: true })).rejects.toThrow(/identidade git/);
    } finally {
      process.env = saved;
    }
    expect(get(id).resolve?.appliedAt).toBeTruthy();
    expect(get(id).resolve?.commit).toBeNull();
    expect(cloneSnapshot(f).config).toBe(before);
    // Identity back: the commit goes through from the same state.
    const done = await conflictCommit(id);
    expect(done.resolve?.commit).toBeTruthy();
  });
});

describe('publish', () => {
  async function toPush(id: string): Promise<ReleaseAction> {
    await toProposed(id);
    decideAll(id);
    const a = await conflictApply(id, { skipTests: true });
    return listActions().find((x) => x.id === a.resolve?.pushId) as ReleaseAction;
  }

  it('pushes fast-forward only after the explicit approval, then cleans up and chains the QA comment', async () => {
    const id = seed(f);
    const before = cloneSnapshot(f);
    const push = await toPush(id);
    expect(push.kind).toBe('conflict-push');
    const r = get(id).resolve;
    const wt = r?.worktree as string;
    expect(originSha(f, f.branch)).toBe(r?.originSha);

    const done = await approveAction(push.id);
    expect(done.state).toBe('done');
    const pushed = originSha(f, f.branch);
    expect(pushed).toBe(r?.commit);
    expect(git(f.origin, 'merge-base', '--is-ancestor', r?.originSha as string, pushed)).toBe('');
    expect(git(f.origin, 'rev-parse', `${pushed}^2`)).toBe(r?.mainSha);

    // Worktree and branch gone; the clone is as the user left it.
    expect(existsSync(wt)).toBe(false);
    expect(wtList()).not.toContain(wt);
    expect(git(f.clone, 'branch', '--list', 'sync/1234')).toBe('');
    expect(cloneSnapshot(f)).toEqual(before);

    expect(get(id)).toMatchObject({ state: 'done' });
    expect(get(id).resolve?.publishedAt).toBeTruthy();
    expect(qa).toHaveBeenCalledTimes(1);
    expect(qa.mock.calls[0][0]).toMatchObject({ issue: 15526, retest: true, stage: 'STAGE:: Test OK' });

    const audit = readFileSync(AUDIT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'push', ok: true, via: 'git', target: `git push origin HEAD:refs/heads/${f.branch}`, issue: 15526 });
    expect(audit[0].fields).toMatchObject({ branch: f.branch, commit: r?.commit });
  });

  it('refuses when origin moved since the preparation: nothing is sent and the action stays pending', async () => {
    const id = seed(f);
    const push = await toPush(id);
    const r = get(id).resolve;
    git(f.seed, 'checkout', '-q', f.branch);
    writeFileSync(join(f.seed, 'late.txt'), 'someone pushed\n');
    git(f.seed, 'add', 'late.txt');
    git(f.seed, 'commit', '-q', '-m', 'late push');
    git(f.seed, 'push', '-q', 'origin', f.branch);
    const moved = originSha(f, f.branch);

    await expect(approveAction(push.id)).rejects.toThrow(/mudou no GitLab/);
    expect(originSha(f, f.branch)).toBe(moved);
    expect(moved).not.toBe(r?.commit);
    expect(listActions().find((x) => x.id === push.id)?.state).toBe('pending');
    expect(existsSync(join(ATAS, 'auditoria.jsonl'))).toBe(false);
    expect(qa).not.toHaveBeenCalled();

    // The way out is to discard and start over.
    await conflictDiscard(id);
    expect(listActions().find((x) => x.id === push.id)?.state).toBe('skipped');
    expect(get(id).state).toBe('pending');
    expect(get(id).resolve).toBeNull();
    const again = await conflictPrepare(id);
    expect(again.resolve?.originSha).toBe(moved);
  });

  it('a rejected push (not fast-forward at the remote) fails the action and reports it in the audit log', async () => {
    const id = seed(f);
    const push = await toPush(id);
    // Origin moves between the check and the push: simulated by a pre-receive hook that refuses every update.
    const hook = join(f.origin, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho "remote: refused" >&2\nexit 1\n', { mode: 0o755 });
    const done = await approveAction(push.id);
    expect(done.state).toBe('failed');
    expect(done.output).toContain('refused');
    const audit = readFileSync(AUDIT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit[0]).toMatchObject({ kind: 'push', ok: false });
    expect(get(id).state).toBe('pending');
    expect(get(id).resolve?.publishedAt).toBeNull();
    expect(qa).not.toHaveBeenCalled();
  });

  it('refuses the push of an action whose conflict was discarded', async () => {
    const id = seed(f);
    const push = await toPush(id);
    await conflictDiscard(id);
    await expect(approveAction(push.id)).rejects.toThrow(/já foi tratada/);
  });
});

describe('discard', () => {
  it('aborts the merge, removes the worktree and the sync branch, and keeps the conflict pending', async () => {
    const id = seed(f);
    const before = cloneSnapshot(f);
    const prepared = await conflictPrepare(id);
    const wt = prepared.resolve?.worktree as string;
    const out = await conflictDiscard(id);
    expect(out.state).toBe('pending');
    expect(out.resolve).toBeNull();
    expect(existsSync(wt)).toBe(false);
    expect(wtList()).not.toContain('conflicts');
    expect(git(f.clone, 'branch', '--list', 'sync/*')).toBe('');
    expect(cloneSnapshot(f)).toEqual(before);
    // Discarding again is harmless, and a new preparation works.
    expect((await conflictDiscard(id)).resolve).toBeNull();
    expect((await conflictPrepare(id)).resolve?.files).toHaveLength(2);
  });

  it('the push action cannot be skipped on its own: discarding the conflict is the way out', async () => {
    const id = seed(f);
    await toProposed(id);
    decideAll(id);
    const done = await conflictApply(id, { skipTests: true });
    await expect(skipAction(done.resolve?.pushId as string)).rejects.toThrow(/Descartar/);
    expect(listActions().find((x) => x.id === done.resolve?.pushId)?.state).toBe('pending');
  });

  it('"already handled outside" also cleans up the worktree', async () => {
    const id = seed(f);
    const wt = (await conflictPrepare(id)).resolve?.worktree as string;
    const done = await skipAction(id);
    expect(done.state).toBe('skipped');
    expect(existsSync(wt)).toBe(false);
    expect(git(f.clone, 'branch', '--list', 'sync/*')).toBe('');
  });
});
