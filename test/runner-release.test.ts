// The run of a release. A run whose subject is a version goes through the release flow with a scripted Release manager, against a real temporary repository
// (the repository's own release script runs) and a fake host with a memory: the real provider, the real list of writes, the real door (proposals in Actions, the
// audit log, the refusal of a test workspace). Every write the host received is checked, and so is every one it did not.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTemplate, releaseFlow } from '../src/shared/cycles';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Forge, makeForge } from './helpers/fakeForge';
import { AUTHOR, ReleaseWorld, cleanWorlds } from './helpers/releaseWorld';
import { type Boot, type Repo, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { onRunnerActionDone } = await import('../src/main/runner/door');

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

let w: ReleaseWorld;
let forge: Forge;
let clock: Date;
let stop: (() => void) | null = null;
const realPath = process.env.PATH;

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  setLanguage('en');
});
afterAll(() => {
  process.env.PATH = realPath;
  setLanguage('pt-BR');
  cleanWorlds();
});
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
  w = new ReleaseWorld();
  // the release script of the repository runs with the stub `npx` of the world first on the PATH
  process.env.PATH = w.scriptEnv().PATH;
  forge = makeForge({ pr: null });
  setVcsRuntimeForTests(forge.runtime());
  clock = new Date('2026-10-03T12:00:00Z');
});

const section = (heading: string, body: string) => ({ heading, body });
const PLAN = { sections: [section('Version', 'It is 0.5.0: a feature.'), section('What goes in', 'One activity.'), section('Changelog', 'The first thing.'), section('Left out or at risk', 'Nothing.')], technical: 'Branch release/0.5.0.' };
const STEP = (heading: string) => ({ sections: [section(heading, 'Done.'), section('What happens next', 'Pushes wait for you.')], technical: '' });

const repoOf = (): Repo => ({ root: w.root, origin: w.origin, clone: w.dir, worktrees: join(w.root, 'worktrees') });
const configureRelease = (extra: (c: Parameters<NonNullable<Parameters<typeof boot>[0]>['configure'] & object>[0]) => void = () => undefined) => (c: Parameters<NonNullable<NonNullable<Parameters<typeof boot>[0]>['configure']>>[0]) => {
  c.language = 'en';
  const applied = applyTemplate(c, releaseFlow);
  c.devCycle = applied.devCycle;
  c.agents = applied.agents;
  extra(c);
};

async function start(options: { autonomous?: boolean; script?: (b: Boot) => void } = {}): Promise<{ b: Boot; run: Run }> {
  const b = await boot({
    dir: ATAS,
    publish: true,
    repo: repoOf(),
    now: () => clock,
    localTags: async () => w.git('tag', '--list').split('\n').filter(Boolean),
    configure: configureRelease((c) => {
      if (options.autonomous === false) c.agents.team.find((a) => a.id === 'release-manager')!.autonomous = false;
    }),
  });
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  // The agents answer from the first moment: the first stage starts as the run does.
  if (options.script) options.script(b);
  else b.engine.script('release-manager', () => work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN }));
  const run = await b.runner.startRelease('0.5.0');
  await b.settle();
  return { b, run };
}

const current = (b: Boot, run: Run): Run => b.runner.get(run.id) as Run;
const comments = (n = 200) => forge.bodies(n).map(([, body]) => body);
const pending = () => actions.listActions().filter((a) => a.state === 'pending');

describe('starting a release', () => {
  it('makes a run whose subject is the version, with the tracking issue on the host, the branch opened locally and the record of the release for the first stage', async () => {
    const { b, run } = await start();
    const now = current(b, run);
    expect(now.issue).toMatchObject({ ref: 'release:0.5.0', iid: 0, title: 'Release 0.5.0' });
    expect(now.subject).toMatchObject({ kind: 'release', version: '0.5.0', from: null, tracking: { iid: 200 }, activities: [] });
    expect(now.branch).toBe('cycle/release-0.5.0');
    expect(now.cycleId).toBe('release-flow');
    // the tracking issue was made through the door, by the agent, with the audit line to say so
    expect(forge.writes.filter((x) => x.method === 'POST' && x.endpoint.endsWith('/issues'))).toEqual([expect.objectContaining({ json: expect.objectContaining({ title: 'Release 0.5.0' }) })]);
    expect(forge.issues.get(200)?.state).toBe('open');
    // the branch was opened by the repository's own script, signed with the identity of the runner
    expect(w.branch).toBe('release/0.5.0');
    expect(w.argv()[0]).toEqual(['open', '0.5.0', '--author', 'Runner Test <runner@example.test>']);
    const audit = listAudit().reverse();
    expect(audit.map((l) => [l.kind, l.by, l.fields.op ?? l.target.split(' ')[1].replace(/^repos\/group\/project\//, '')])).toEqual([['github', 'release-manager', 'issues'], ['github', 'release-manager', 'issues/200/comments'], ['release', 'release-manager', 'open'], ['github', 'release-manager', 'issues/200/comments']]);
    // the first stage is given the record of the release
    const { readFileSync } = await import('node:fs');
    const record = readFileSync(join(now.worktree, now.cycleFolder, '0_ISSUE.md'), 'utf8');
    expect(record).toContain('# Release 0.5.0');
    expect(record).toContain('Nothing is aimed at release/0.5.0 yet.');
    // the plan was written (the stage ran with the record) and the run waits at its first gate
    expect(now.stage).toBe('release-plan-gate');
    expect(now.status).toBe('gate');
  });

  it('adopts the issue that is already open for the version instead of making another', async () => {
    forge.issues.set(150, { number: 150, title: 'Release 0.5.0', body: '', labels: [], state: 'open' });
    const { b, run } = await start();
    expect(current(b, run).subject?.tracking).toMatchObject({ iid: 150 });
    expect(forge.writes.filter((x) => x.endpoint.endsWith('/issues'))).toEqual([]);
  });

  it('does not take a closed issue of that title, and refuses a version that is not X.Y.Z, a flow it does not have and a second run for the same version', async () => {
    forge.issues.set(150, { number: 150, title: 'Release 0.5.0', body: '', labels: [], state: 'closed' });
    const { b, run } = await start();
    expect(current(b, run).subject?.tracking).toMatchObject({ iid: 200 });
    await expect(b.runner.startRelease('0.5.0')).rejects.toThrow(/already/i);
    for (const version of ['0.5', 'v0.5.0', '0.5.0-beta.1', '0.05.0', '', '../0.5.0']) await expect(b.runner.startRelease(version), version).rejects.toThrow(/is not a version/);
    await expect(b.runner.startRelease('0.6.0', 'main')).rejects.toThrow(/is not a version/);
    const bare = await boot({ dir: ATAS, repo: repoOf(), configure: (c) => (c.language = 'en') });
    await expect(bare.runner.startRelease('0.6.0')).rejects.toThrow(/no release flow/);
  });

  it('waits for a yes before anything exists when the Release manager does not run by itself: the tracking issue and the branch are proposals', async () => {
    const { b, run } = await start({ autonomous: false });
    expect(current(b, run).subject?.tracking).toBeNull();
    expect(forge.writes).toEqual([]);
    expect(w.branch).toBe('main');
    const [tracking, open] = [pending().find((a) => a.unit?.purpose === 'release-tracking'), pending().find((a) => a.kind === 'release-git')];
    expect(tracking).toMatchObject({ kind: 'vcs', summary: 'Create the tracking issue of the release 0.5.0' });
    expect(open).toMatchObject({ kind: 'release-git', unit: { op: 'open', version: '0.5.0', runId: run.id } });
    // a yes to the tracking issue makes it and tells the run
    await actions.approveAction((tracking as { id: string }).id);
    await b.settle();
    expect(current(b, run).subject?.tracking).toMatchObject({ iid: 200 });
    expect(forge.writes).toHaveLength(1);
    await actions.approveAction((open as { id: string }).id);
    expect(w.branch).toBe('release/0.5.0');
    expect(listAudit()[0]).toMatchObject({ kind: 'release', origin: { kind: 'release-git' } });
    expect(listAudit()[0].by ?? null).toBeNull();
  });

  it('writes nothing in a test workspace: no tracking issue, and the step the agent asks for is refused with the reason', async () => {
    asReal(true);
    const { b, run } = await start();
    expect(current(b, run).subject?.tracking).toBeNull();
    expect(forge.writes).toEqual([]);
    expect(w.branch).toBe('main');
    expect(b.thread(run).some((m) => m.kind === 'system' && /test workspace/i.test(JSON.stringify(m)))).toBe(true);
  });
});

describe('the release from the plan to the stable', () => {
  /** Everything the Release manager says, stage by stage; the calls of the tool are what each stage does. */
  function script(b: Boot, pr: { head: string }): void {
    b.engine.script(
      'release-manager',
      () => work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN }),
      async (call) => {
        const merged = await call.release!({ op: 'merge-pr', version: '0.5.0', pr: 7, head: pr.head });
        return work(`Assembled. ${merged}`, { comment: STEP('What was merged') });
      },
      async (call) => {
        const cut = await call.release!({ op: 'beta', version: '0.5.0' });
        const branch = await call.release!({ op: 'push-branch', version: '0.5.0' });
        const tag = await call.release!({ op: 'push-tag', version: '0.5.0', channel: 'beta' });
        return work(`Beta. ${cut} ${branch} ${tag}`, { comment: STEP('The beta') });
      },
      async (call) => {
        const cut = await call.release!({ op: 'stable', version: '0.5.0' });
        const branch = await call.release!({ op: 'push-branch', version: '0.5.0', branch: 'main' });
        const tag = await call.release!({ op: 'push-tag', version: '0.5.0', channel: 'stable' });
        return work(`Stable. ${cut} ${branch} ${tag}`, { comment: STEP('The release') });
      },
    );
  }

  it('goes all the way: the plan on the tracking issue, a merge made locally, a beta, the waits, the stable, and a push that always waits for a yes', async () => {
    const pr = { head: '' };
    const { b, run } = await start({ script: (x) => script(x, pr) });
    // the person pushes the branch the release opened, and a pull request is aimed at it
    w.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    pr.head = w.pushedBranch('feat/x', 'release/0.5.0');
    forge.others.push({ number: 7, branch: 'feat/x', head: pr.head, base: 'release/0.5.0', files: [], approved: true, title: 'Add the x', body: 'Closes #12' });

    // the plan ends: its document is written, its comment is on the tracking issue, and the run waits at the first gate
    await b.runner.sweep();
    await b.settle();
    let now = current(b, run);
    expect(now.error?.detail ?? null).toBeNull();
    expect(now.status).toBe('gate');
    expect(now.stage).toBe('release-plan-gate');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(now.worktree, now.cycleFolder, 'RELEASE_PLAN.md'), 'utf8')).toContain('RELEASE_PLAN.md');
    const onIssue = comments();
    expect(onIssue.some((c) => c.includes('**Release plan ready to approve**') && c.includes('It is 0.5.0: a feature.'))).toBe(true);
    // the activities of the version are listed there too, with the pull request, its link and the issue it closes
    const activities = onIssue.find((c) => c.includes('**Activities of the release**'));
    expect(activities).toContain('[#7 Add the x](https://example.test/group/project/pull/7): approved and ready to merge');
    expect(now.subject?.activities).toEqual([expect.objectContaining({ pr: 7, state: 'open', approved: true, issue: 12 })]);

    // the gate is approved: the Release manager merges the approved pull request into the branch, locally, and the run waits for the merges to be in
    b.runner.gate(run.id, 'approve');
    await b.settle();
    now = current(b, run);
    expect(now.stage).toBe('release-merged');
    expect(now.status).toBe('waiting');
    expect(now.wait?.kind).toBe('release-approved');
    expect(w.git('log', '-1', '--format=%s %an', 'release/0.5.0')).toBe(`Merge pull request #7 from feat/x ${'Runner Test'}`);
    // the host's merge button was never used: no write of the host merges anything
    expect(forge.writes.filter((x) => /merge/.test(x.endpoint))).toEqual([]);
    expect(await b.runner.tick()).toEqual([]);
    forge.others[0].merged = true;
    await b.runner.tick();
    await b.settle();

    // the beta is cut locally; both pushes wait in Actions even though the agent runs by itself
    now = current(b, run);
    expect(now.stage).toBe('release-feedback');
    expect(w.git('tag', '--list')).toContain('v0.5.0-beta.1');
    expect(w.remote('tag', '--list')).not.toContain('beta');
    const proposals = pending().filter((a) => a.kind === 'release-git');
    expect(proposals.map((a) => (a.unit as { op: string }).op).sort()).toEqual(['push-branch', 'push-tag']);
    for (const op of ['push-branch', 'push-tag']) await actions.approveAction(proposals.find((a) => (a.unit as { op: string }).op === op)!.id);
    expect(w.remote('tag', '--list')).toContain('v0.5.0-beta.1');
    expect(listAudit().filter((l) => l.kind === 'push').map((l) => l.target)).toEqual(['git push origin refs/tags/v0.5.0-beta.<latest>', 'git push origin HEAD:refs/heads/release/0.5.0']);

    // the run waits for the beta to be out for a day: nothing happens before the host shows it published, nor before the day, nor with a blocking issue open
    expect(await b.runner.tick()).toEqual([]);
    forge.releases.set('v0.5.0-beta.1', { draft: false, prerelease: true, publishedAt: clock.toISOString() });
    await b.runner.tick();
    await b.settle();
    expect(comments().some((c) => c.includes('**Beta published**') && c.includes('v0.5.0-beta.1 is out'))).toBe(true);
    expect(current(b, run).status).toBe('waiting');
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    forge.issues.set(300, { number: 300, title: 'The beta crashes', body: '', labels: ['beta-blocker'], state: 'open' });
    expect(await b.runner.tick()).toEqual([]);
    forge.close(300);
    await b.runner.tick();
    await b.settle();
    now = current(b, run);
    expect(now.stage).toBe('release-stable-gate');
    expect(now.status).toBe('gate');

    // the stable: merged into main and cut by the script; main and its tag wait for a yes
    b.runner.gate(run.id, 'approve');
    await b.settle();
    now = current(b, run);
    expect(now.status).toBe('done');
    expect(w.version).toBe('0.5.0');
    expect(w.git('tag', '--list')).toContain('v0.5.0');
    expect(w.argv().flat()).not.toContain('--emergency');
    expect(w.argv().flat()).not.toContain('--allow-branch');
    const stablePushes = pending().filter((a) => a.kind === 'release-git');
    expect(stablePushes.map((a) => (a.unit as { op: string }).op).sort()).toEqual(['push-branch', 'push-tag']);
    expect(w.remote('tag', '--list')).not.toContain('v0.5.0\n');
    for (const op of ['push-branch', 'push-tag']) await actions.approveAction(stablePushes.find((a) => (a.unit as { op: string }).op === op)!.id);
    expect(w.remote('tag', '--list').split('\n')).toContain('v0.5.0');

    // the tracking issue stays open until the host shows the stable published; then it says so and is closed, by the agent, through the door
    await b.runner.tick();
    await b.settle();
    expect(forge.issues.get(200)?.state).toBe('open');
    forge.releases.set('v0.5.0', { draft: false, prerelease: false, publishedAt: clock.toISOString() });
    await b.runner.tick();
    await b.settle();
    expect(forge.issues.get(200)?.state).toBe('closed');
    expect(comments().some((c) => c.includes('**Stable version published**'))).toBe(true);
    expect(current(b, run).subject?.tracking?.closed).toBe(true);
    expect(listAudit()[0]).toMatchObject({ kind: 'github', by: 'release-manager', target: expect.stringContaining('PATCH repos/group/project/issues/200') });
    // and it is not looked at again
    const writes = forge.writes.length;
    await b.runner.tick();
    await b.settle();
    expect(forge.writes).toHaveLength(writes);
    void AUTHOR;
  });
});
