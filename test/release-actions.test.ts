// The release actions behind the door of Actions: the proposal that waits, the audited call an agent's autonomy lets go out, what is checked again when a person
// says "sim", and the refusal in a test workspace. The repository is a real temporary one (test/helpers/releaseWorld.ts); the code host is the fake forge.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { setLanguage } from '../src/shared/i18n';
import { flowOf, startRun } from '../src/shared/runs';
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
    expect(listAudit()[0]).toMatchObject({ kind: 'push', via: 'git', ok: true, target: 'git push origin HEAD:refs/heads/release/0.5.0', fields: { op: 'push-branch', version: '0.5.0' } });
  });

  it('merges an approved pull request into the release branch locally, reading it from the host, never calling the host\'s merge', async () => {
    await approve(propose('o', unit({ op: 'open' })).id);
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true };
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
    const attempt = async (key: string, pr: Partial<NonNullable<Forge['pr']>>, u: Record<string, unknown> = {}) => {
      forge.pr = { number: 7, branch: 'feat/x', head, base: 'release/0.5.0', files: [], approved: true, ...pr };
      return approve(propose(key, unit({ op: 'merge-pr', pr: 7, head, ...u })).id);
    };
    expect((await attempt('m1', { approved: false })).output).toMatch(/not approved/);
    expect((await attempt('m2', { base: 'main' })).output).toMatch(/aimed at main/);
    expect((await attempt('m3', { draft: true })).output).toMatch(/draft/);
    expect((await attempt('m4', {}, { head: 'f'.repeat(40) })).output).toMatch(/plan read it/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
    const failed = listAudit().filter((l) => l.fields.op === 'merge-pr');
    expect(failed).toHaveLength(4);
    expect(failed.every((l) => !l.ok)).toBe(true);
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
    expect(preview).toContain('git push origin HEAD:refs/heads/release/0.5.0');
    expect(preview).toContain('feat: a thing');
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

  it('never pushes: a push waits for a person whatever the caller says', async () => {
    await actions.runReleaseAuto(meta, unit({ op: 'open' }));
    await expect(actions.runReleaseAuto({ ...meta, key: 'b' }, unit({ op: 'push-branch' }))).rejects.toThrow(/never goes out by itself/);
    await expect(actions.runReleaseAuto({ ...meta, key: 't' }, unit({ op: 'push-tag', channel: 'beta' }))).rejects.toThrow(/never goes out by itself/);
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
    expect(listAudit()).toHaveLength(1);
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
