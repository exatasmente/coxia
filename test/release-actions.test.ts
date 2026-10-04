// The release actions behind the door of Actions: the proposal that waits, the audited call an agent's autonomy lets go out, what is checked again when a person
// says "sim", and the refusal in a test workspace. The repository is a real temporary one (test/helpers/releaseWorld.ts); the code host is the fake forge.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { setLanguage } from '../src/shared/i18n';
import { flowOf, freezePlan, recordSubject, startRun } from '../src/shared/runs';
import { type Forge, HEAD, makeForge } from './helpers/fakeForge';
import { AUTHOR, ReleaseWorld, cleanWorlds } from './helpers/releaseWorld';
import { type Repo, runnerConfig } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { runStore } = await import('../src/main/runs');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });
const RUN = 'r-rel001-aaaa';
const unit = (over: Record<string, unknown>) => ({ version: '0.5.0', runId: RUN, ...over });
const input = (key: string, u: Record<string, unknown>) => ({ key, issue: 0, issueTitle: 'Release 0.5.0', summary: `Release step ${key}`, unit: u as never });

let w: ReleaseWorld;
let forge: Forge;

function configure(identity: { name: string; email: string } | null = AUTHOR): void {
  updateConfig(() => {
    const c = runnerConfig(neutralConfig(), { root: w.root, origin: w.origin, clone: w.dir, worktrees: join(w.root, 'worktrees') } as Repo);
    c.language = 'en';
    if (identity) c.runner.identity = identity;
    else c.runner.identity = { name: '', email: '' };
    return c;
  });
}

function makeRun(over: { version?: string; status?: 'cancelled' } = {}): void {
  const flow = flowOf(getConfig());
  const { run } = startRun(
    { id: RUN, issue: { ref: `release:${over.version ?? '0.5.0'}`, iid: 0, title: `Release ${over.version ?? '0.5.0'}`, url: null }, repo: 'app', branch: 'cycle/release-0.5.0', worktree: join(w.root, 'worktrees', 'app', 'release-0.5.0'), cycleFolder: 'docs/cycles/release-0.5.0', cycleId: 'release-flow', subject: { kind: 'release', version: over.version ?? '0.5.0', from: null, tracking: null, activities: [] } },
    flow,
    '2026-10-03T10:00:00.000Z',
  );
  runStore().create(over.status ? { ...run, status: over.status } : run);
}

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  setLanguage('en');
});
afterAll(() => {
  setLanguage('pt-BR');
  cleanWorlds();
});
// The script runs with the process's own environment here (the door gives it none of its own): the stub `npx` of the world goes first on the PATH.
const realPath = process.env.PATH;
beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  rmSync(join(ATAS, 'runs'), { recursive: true, force: true });
  asReal(false);
  w = new ReleaseWorld();
  // where the steps of the run work: next to the run's own worktree, derived from it
  w.stepsDir = join(w.root, 'worktrees', 'app', 'release-0.5.0-steps');
  process.env.PATH = w.scriptEnv().PATH;
  forge = makeForge({ pr: null });
  setVcsRuntimeForTests(forge.runtime());
  configure();
  makeRun();
});
afterAll(() => {
  process.env.PATH = realPath;
});

/** The person accepted a plan that read the pull request 7 at `head`: the run knows it, and froze it. */
function planned(head: string): void {
  runStore().update(RUN, (r) => recordSubject(r, { activities: [{ pr: 7, title: 'Add the x', url: 'u', head, state: 'open', approved: true, issue: null }], seen: { '7': head } }, '2026-10-03T10:30:00.000Z'));
  runStore().update(RUN, (r) => freezePlan(r, '2026-10-03T10:31:00.000Z'));
}

const approve = (id: string) => actions.approveAction(id);
const propose = (key: string, u: Record<string, unknown>) => actions.proposeRelease(input(key, u)) as NonNullable<ReturnType<typeof actions.proposeRelease>>;

describe('proposing a release step', () => {
  it('stores a pending action of its own kind whose unit is the operation and the version and nothing else, and runs nothing', () => {
    const a = propose('release:r:open', unit({ op: 'open' }));
    expect(a).toMatchObject({ kind: 'release-git', state: 'pending', summary: 'Release step release:r:open', unit: { op: 'open', version: '0.5.0', runId: RUN } });
    expect(Object.keys(a.unit as object).sort()).toEqual(['op', 'runId', 'version']);
    expect(a.output).toContain('scripts/release.sh open 0.5.0');
    expect(a.command).toBeNull();
    expect(w.argv()).toEqual([]);
    expect(w.branch).toBe('main');
    // the same key is not proposed twice
    expect(actions.proposeRelease(input('release:r:open', unit({ op: 'open' })))).toBeNull();
    expect(actions.listActions()).toHaveLength(1);
  });

  it('refuses, before anything is stored, a unit that names a path, a flag, a bad version or no run', () => {
    for (const bad of [{ op: 'beta', path: '/tmp/x' }, { op: 'beta', emergency: true }, { op: 'beta', version: '0.5' }, { op: 'push', version: '0.5.0' }, { op: 'beta', runId: undefined }]) {
      expect(() => actions.proposeRelease(input('k', unit(bad as Record<string, unknown>))), JSON.stringify(bad)).toThrow();
    }
    expect(actions.listActions()).toEqual([]);
  });

  it('can be proposed in a test workspace (the confirmation is what is refused)', () => {
    asReal(true);
    expect(propose('release:r:beta', unit({ op: 'beta' })).state).toBe('pending');
  });
});

describe('approving a step', () => {
  it('runs it in the repository of the run with the configured identity, audits it with the commits before and after, and tells the listeners', async () => {
    const told: string[] = [];
    const stop = actions.onActionDone((a) => told.push(a.id));
    const a = propose('release:r:open', unit({ op: 'open' }));
    const done = await approve(a.id);
    stop();
    expect(done).toMatchObject({ state: 'done' });
    expect(w.steps.branch).toBe('release/0.5.0');
    expect(w.branch).toBe('main');
    expect(told).toEqual([a.id]);
    const [line] = listAudit();
    expect(line).toMatchObject({ kind: 'release', via: 'release.sh', ok: true, target: 'scripts/release.sh open 0.5.0 --worktree', origin: { actionId: a.id, kind: 'release-git' }, fields: { op: 'open', version: '0.5.0', run: RUN, repo: 'app' } });
    expect(line.fields.before).toBe(w.git('rev-parse', 'main'));
    expect(line.fields.after).toBe(w.steps.git('rev-parse', 'HEAD'));
    expect(line.by ?? null).toBeNull();
  });

  it('audits a push as a push, with the ref it sent, and only after a person approved it', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    const push = propose('p', unit({ op: 'push-branch' }));
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
    await approve(push.id);
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(w.steps.git('rev-parse', 'HEAD'));
    expect(listAudit()[0]).toMatchObject({ kind: 'push', via: 'git', ok: true, target: 'git push origin <sha>:refs/heads/release/0.5.0', fields: { op: 'push-branch', version: '0.5.0' } });
  });

  it('merges an approved pull request into the release branch locally, reading it from the host, never calling the host\'s merge', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true };
    planned(head);
    const done = await approve(propose('m', unit({ op: 'merge-pr', pr: 7, head })).id);
    expect(done.state).toBe('done');
    expect(w.steps.git('log', '-1', '--format=%s')).toBe('Merge pull request #7 from feat/x');
    expect(w.steps.git('log', '-1', '--format=%an <%ae>')).toBe(`${AUTHOR.name} <${AUTHOR.email}>`);
    expect(forge.writes).toEqual([]);
    expect(listAudit()[0]).toMatchObject({ kind: 'release', ok: true, fields: { op: 'merge-pr', pr: '7' } });
  });

  it('fails a merge of a pull request that is not approved, whose base is another branch, or whose head moved, with the reason and nothing merged', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const before = w.steps.git('rev-parse', 'HEAD');
    planned(head);
    const attempt = async (key: string, pr: Partial<NonNullable<Forge['pr']>>, u: Record<string, unknown> = {}) => {
      forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true, ...pr };
      return approve(propose(key, unit({ op: 'merge-pr', pr: 7, head, ...u })).id);
    };
    expect((await attempt('m1', { approved: false })).output).toMatch(/not approved/);
    expect((await attempt('m2', { base: 'main' })).output).toMatch(/aimed at main/);
    expect((await attempt('m3', { draft: true })).output).toMatch(/draft/);
    expect((await attempt('m4', {}, { head: 'f'.repeat(40) })).output).toMatch(/was not in the plan you approved/);
    expect((await attempt('m5', { fork: true })).output).toMatch(/comes from a fork/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
    const failed = listAudit().filter((l) => l.fields.op === 'merge-pr');
    expect(failed).toHaveLength(4);
    expect(failed.every((l) => !l.ok)).toBe(true);
  });

  it('merges only the head the person approved with the plan: a pull request that was not in it, or that moved after it, is refused before anything runs', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true };
    const merge = (key: string, h = head) => approve(propose(key, unit({ op: 'merge-pr', pr: 7, head: h })).id);
    const before = w.steps.git('rev-parse', 'HEAD');
    const audits = listAudit().length;
    // no plan accepted yet
    expect((await merge('m1')).output).toMatch(/was not in the plan you approved/);
    planned('1'.repeat(40));
    // the plan was written for another commit, and the pull request was pushed to since
    expect((await merge('m2')).output).toMatch(/was not in the plan you approved/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
    // refused before the audit: nothing ran
    expect(listAudit()).toHaveLength(audits);
    // freezing is once: a second acceptance does not move the heads the first plan froze
    planned(head);
    expect((await merge('m3')).state).toBe('failed');
    // only a new plan (here, the file edited as a run sent back to its plan and accepted again would) makes it the planned head
    runStore().update(RUN, (r) => ({ run: { ...r, subject: { ...(r.subject as NonNullable<typeof r.subject>), planned: { '7': head } } }, messages: [] }));
    expect((await merge('m4')).state).toBe('done');
  });

  it('merges on an approval only when a member gave it on the head, and with checks that can be read and pass', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    planned(head);
    const attempt = async (key: string, over: Partial<NonNullable<Forge['pr']>>) => {
      forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true, ...over };
      return approve(propose(key, unit({ op: 'merge-pr', pr: 7, head })).id);
    };
    const before = w.steps.git('rev-parse', 'HEAD');
    expect((await attempt('a1', { approval: { association: 'NONE' } })).output).toMatch(/not approved/);
    expect((await attempt('a2', { approval: { commit: 'b'.repeat(40) } })).output).toMatch(/not approved/);
    expect((await attempt('a3', { checks: 'failing' })).output).toMatch(/checks .* are failing/);
    // a CI nobody could read is not "no checks": it counts as still running
    expect((await attempt('a4', { checks: 'unreadable' })).output).toMatch(/checks .* are running/);
    // no checks at all, on a pull request that was updated a minute ago, may be checks that have not started: still running; long ago, there are none to wait for
    expect((await attempt('a4b', { updatedAt: new Date(Date.now() - 60_000).toISOString() })).output).toMatch(/checks .* are running/);
    // a time the host did not give, one that is not a time, and one in the future (its clock is ahead) are all "just now": the doubt waits
    expect((await attempt('a4c', { updatedAt: null })).output).toMatch(/checks .* are running/);
    expect((await attempt('a4d', { updatedAt: 'sometime' })).output).toMatch(/checks .* are running/);
    expect((await attempt('a4e', { updatedAt: new Date(Date.now() + 3_600_000).toISOString() })).output).toMatch(/checks .* are running/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
    expect((await attempt('a5', { approval: { association: 'COLLABORATOR' } })).state).toBe('done');
  });

  it('judges the stored unit again: an action edited on disk to name a path or a flag fails and runs nothing', async () => {
    const a = propose('release:r:beta', unit({ op: 'beta' }));
    const file = join(ATAS, 'acoes.json');
    const store = JSON.parse(readFileSync(file, 'utf8')) as { actions: { id: string; unit: Record<string, unknown> }[] };
    store.actions.find((x) => x.id === a.id)!.unit = { ...store.actions[0].unit, cwd: '/etc', emergency: true };
    writeFileSync(file, JSON.stringify(store));
    const failed = await approve(a.id);
    expect(failed.state).toBe('failed');
    expect(failed.output).toMatch(/unknown-field/);
    expect(w.argv()).toEqual([]);
    expect(listAudit()).toEqual([]);
  });

  it('fails for a run that is not in the workspace, one that releases another version, or one that was cancelled', async () => {
    const a = propose('x', unit({ op: 'open', runId: 'r-nope01-aaaa' }));
    expect((await approve(a.id)).output).toMatch(/names no run of this workspace that is releasing 0\.5\.0/);
    const b = propose('y', unit({ op: 'open', version: '0.9.0' }));
    expect((await approve(b.id)).output).toMatch(/releasing 0\.9\.0/);
    runStore().update(RUN, (r) => ({ run: { ...r, status: 'cancelled' }, messages: [] }));
    const c = propose('z', unit({ op: 'open' }));
    expect((await approve(c.id)).state).toBe('failed');
    expect(w.argv()).toEqual([]);
  });

  it('fails when the runner has no identity: the app never signs a release as anyone else', async () => {
    configure(null);
    const a = propose('o', unit({ op: 'open' }));
    const failed = await approve(a.id);
    expect(failed.state).toBe('failed');
    expect(failed.output).toMatch(/no identity/);
    expect(w.branch).toBe('main');
    expect(existsSync(w.stepsDir)).toBe(false);
    expect(w.argv()).toEqual([]);
  });

  it('is refused in a test workspace and runs and logs nothing', async () => {
    const a = propose('o', unit({ op: 'open' }));
    asReal(true);
    await expect(approve(a.id)).rejects.toThrow(/Test workspace/);
    expect(w.branch).toBe('main');
    expect(existsSync(w.stepsDir)).toBe(false);
    expect(w.argv()).toEqual([]);
    expect(listAudit()).toEqual([]);
    expect(actions.listActions().find((x) => x.id === a.id)?.state).toBe('pending');
  });

  it('shows what a push would send before the person says yes', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.change('Added', 'a thing');
    const push = propose('p', unit({ op: 'push-branch' }));
    const preview = await actions.previewAction(push.id);
    expect(preview).toContain('git push origin <sha>:refs/heads/release/0.5.0');
    expect(preview).toContain('feat: a thing');
  });
});

describe('the steps one stage asked for', () => {
  const GROUP = `${RUN}:release-beta:1`;
  const step = (key: string, u: Record<string, unknown>) => actions.proposeRelease({ ...input(key, u), group: GROUP }) as NonNullable<ReturnType<typeof actions.proposeRelease>>;
  const state = (id: string) => actions.listActions().find((a) => a.id === id)?.state;

  it('carries out a push only after the cut it sends: a yes given out of order is refused before anything runs, with the reason, and the step keeps waiting', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.change('Added', 'a thing');
    const cut = step('cut', unit({ op: 'beta' }));
    const branch = step('branch', unit({ op: 'push-branch' }));
    const tag = step('tag', unit({ op: 'push-tag', channel: 'beta' }));
    const refusals: [string, string][] = [];
    const stop = actions.onActionRefused((a, reason) => refusals.push([a.id, reason]));
    const audits = listAudit().length;
    // the order the person clicked in a real run: the tag, then the branch, then the cut
    await expect(approve(tag.id)).rejects.toThrow('"Release step tag" waits for a step asked in the same stage: Release step branch; Release step cut. Say yes to that first; nothing was done.');
    await expect(approve(branch.id)).rejects.toThrow(/"Release step branch" waits for a step asked in the same stage: Release step cut\./);
    expect([state(tag.id), state(branch.id), state(cut.id)]).toEqual(['pending', 'pending', 'pending']);
    expect(refusals.map(([id]) => id)).toEqual([tag.id, branch.id]);
    expect(listAudit()).toHaveLength(audits);
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
    expect(w.git('tag', '--list')).not.toContain('beta');
    // in order, each goes, and the tag the cut made is the one that reaches the remote
    expect((await approve(cut.id)).state).toBe('done');
    await expect(approve(tag.id)).rejects.toThrow(/waits for a step asked in the same stage: Release step branch\./);
    expect((await approve(branch.id)).state).toBe('done');
    expect((await approve(tag.id)).state).toBe('done');
    expect(w.remote('tag', '--list')).toContain('v0.5.0-beta.1');
    stop();
  });

  it('does not hold a push back for a cut the person skipped, or for one another stage asked for', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    const cut = step('cut', unit({ op: 'beta' }));
    const other = actions.proposeRelease({ ...input('cut-2', unit({ op: 'beta' })), group: `${RUN}:release-beta:2` });
    expect(other).not.toBeNull();
    await actions.skipAction(cut.id);
    expect((await approve(step('branch', unit({ op: 'push-branch' })).id)).state).toBe('done');
  });

  it('marks a push that found the remote already holding what it would send as "nothing sent", not as a plain success, in the action and in the audit log', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    const first = await approve(propose('p1', unit({ op: 'push-branch' })).id);
    expect(first.state).toBe('done');
    expect(first.nothingSent).toBeUndefined();
    expect(listAudit()[0].fields.sent).toBe('true');
    const told: boolean[] = [];
    const stop = actions.onActionDone((a) => told.push(a.nothingSent === true));
    const again = await approve(propose('p2', unit({ op: 'push-branch' })).id);
    stop();
    expect(again).toMatchObject({ state: 'done', nothingSent: true });
    expect(again.output).toMatch(/^Nothing sent: the remote already has release\/0\.5\.0 at [0-9a-f]{9}\. Nothing moved on the host\.$/);
    expect(told).toEqual([true]);
    expect(listAudit()[0]).toMatchObject({ kind: 'push', ok: true, fields: { op: 'push-branch', sent: 'false' } });
  });
});

describe('a step an agent\'s autonomy lets go out', () => {
  const meta = { issue: 0, key: 'release:auto:open', summary: 'Open 0.5.0', by: 'release-manager' };

  it('goes through the same door and log, with the agent as who, and no proposal in Actions', async () => {
    const out = await actions.runReleaseAuto(meta, unit({ op: 'open' }));
    expect(out).toContain('release/0.5.0');
    expect(w.steps.branch).toBe('release/0.5.0');
    expect(actions.listActions()).toEqual([]);
    expect(listAudit()[0]).toMatchObject({ kind: 'release', ok: true, by: 'release-manager', origin: { actionId: 'auto:release:auto:open', kind: 'auto' }, fields: { op: 'open', run: RUN } });
  });

  it('never pushes, and never cuts: a push, a beta and a stable wait for a person whatever the caller says', async () => {
    await actions.runReleaseAuto(meta, unit({ op: 'open' }));
    const calls = w.argv().length;
    for (const [key, u] of [['b', { op: 'push-branch' }], ['t', { op: 'push-tag', channel: 'beta' }], ['c', { op: 'beta' }], ['s', { op: 'stable' }]] as const) {
      await expect(actions.runReleaseAuto({ ...meta, key }, unit(u)), key).rejects.toThrow(/never go out by themselves/);
    }
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
    expect(w.argv()).toHaveLength(calls);
    expect(listAudit()).toHaveLength(1);
  });

  it('goes on with the two steps that follow the autonomy: opening the branch and merging what the plan approved', async () => {
    const out = await actions.runReleaseAuto(meta, unit({ op: 'open' }));
    expect(out).toContain('release/0.5.0');
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true };
    planned(head);
    await expect(actions.runReleaseAuto({ ...meta, key: 'merge' }, unit({ op: 'merge-pr', pr: 7, head }))).resolves.toContain('Merged');
    expect(listAudit()[0]).toMatchObject({ kind: 'release', by: 'release-manager', fields: { op: 'merge-pr' } });
  });

  it('is refused in a test workspace, with nothing run and nothing logged', async () => {
    asReal(true);
    await expect(actions.runReleaseAuto(meta, unit({ op: 'open' }))).rejects.toThrow(/Test workspace/);
    expect(w.argv()).toEqual([]);
    expect(listAudit()).toEqual([]);
  });

  it('judges the unit like an approval does', async () => {
    await expect(actions.runReleaseAuto(meta, unit({ op: 'open', cwd: '/etc' }))).rejects.toThrow(/unknown-field/);
    expect(w.argv()).toEqual([]);
  });
});

void HEAD;
