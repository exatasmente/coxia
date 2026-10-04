// The run of a release. A run whose subject is a version goes through the release flow with a scripted Release manager, against a real temporary repository
// (the repository's own release script runs) and a fake host with a memory: the real provider, the real list of writes, the real door (proposals in Actions, the
// audit log, the refusal of a test workspace). Every write the host received is checked, and so is every one it did not.
import { existsSync, rmSync } from 'node:fs';
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
const { onRunnerActionDone, onRunnerActionRefused } = await import('../src/main/runner/door');
const { remoteReleaseOf } = await import('../src/main/runner/release');

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
  // the steps of a run work in a worktree next to the run's own, derived from it
  w.stepsDir = join(w.root, 'worktrees', 'app', 'release-0.5.0-steps');
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

async function start(options: { autonomous?: boolean; script?: (b: Boot) => void; version?: string; from?: string } = {}): Promise<{ b: Boot; run: Run }> {
  const b = await boot({
    dir: ATAS,
    publish: true,
    repo: repoOf(),
    now: () => clock,
    localTags: async () => w.git('tag', '--list').split('\n').filter(Boolean),
    // what the bare origin on disk has: the remote the waits for the host read
    remoteRelease: async (r) => remoteReleaseOf(w.dir, r.subject?.version ?? ''),
    configure: configureRelease((c) => {
      if (options.autonomous === false) c.agents.team.find((a) => a.id === 'release-manager')!.autonomous = false;
    }),
  });
  const stops = [onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses)), onRunnerActionRefused((a, reason) => b.runner.actionRefused(a, reason))];
  stop = () => stops.forEach((f) => f());
  // The agents answer from the first moment: the first stage starts as the run does.
  if (options.script) options.script(b);
  else b.engine.script('release-manager', () => work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN }));
  const run = await b.runner.startRelease(options.version ?? '0.5.0', options.from);
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
    expect(w.steps.branch).toBe('release/0.5.0');
    expect(w.branch).toBe('main');
    expect(w.argv()[0]).toEqual(['open', '0.5.0', '--author', 'Runner Test <runner@example.test>', '--worktree']);
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

  it('adopts an issue of that title only when it is the person own or carries the label of the version; somebody else issue is left alone and a new one is made, with the reason in the thread', async () => {
    forge.issues.set(150, { number: 150, title: 'Release 0.5.0', body: '', labels: [], state: 'open', author: 'a-stranger' });
    const first = await start();
    expect(current(first.b, first.run).subject?.tracking).toMatchObject({ iid: 200 });
    expect(forge.writes.filter((x) => x.endpoint.endsWith('/issues'))).toHaveLength(1);
    expect(first.b.thread(first.run).some((m) => m.kind === 'system' && m.code === 'runner.release.trackingNotAdopted' && JSON.stringify(m).includes('a-stranger'))).toBe(true);
    // the same title by somebody else, but labelled with the version (the pattern of the cycle), is the release one
    forge.issues.clear();
    forge.issues.set(160, { number: 160, title: 'Release 0.6.0', body: '', labels: ['0.6.0'], state: 'open', author: 'a-maintainer' });
    const labelled = await start({ version: '0.6.0' });
    expect(current(labelled.b, labelled.run).subject?.tracking).toMatchObject({ iid: 160 });
  });

  it('never takes a pull request for the tracking issue, whatever its title', async () => {
    forge.issues.set(150, { number: 150, title: 'Release 0.5.0', body: '', labels: [], state: 'open', pull: true });
    const { b, run } = await start();
    expect(current(b, run).subject?.tracking).toMatchObject({ iid: 200 });
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
    expect(w.steps.branch).toBe('release/0.5.0');
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
  /** The pull request the plan is written for: somebody pushes the branch the release opened and aims a pull request at it while the plan stage runs. */
  async function aPullRequestAppears(pr: { head: string }, over: Partial<NonNullable<Forge['pr']>> = {}): Promise<void> {
    for (let i = 0; i < 200 && !(existsSync(join(w.stepsDir, '.git')) && w.steps.branch === 'release/0.5.0'); i++) await new Promise((r) => setTimeout(r, 20));
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    pr.head = w.pushedBranch('feat/x', 'release/0.5.0');
    forge.others.push({ number: 7, branch: 'feat/x', head: pr.head, base: 'release/0.5.0', files: [], approved: true, title: 'Add the x', body: 'Closes #12', ...over });
  }

  /** Everything the Release manager says, stage by stage; the calls of the tool are what each stage does. */
  function script(b: Boot, pr: { head: string }): void {
    b.engine.script(
      'release-manager',
      async () => {
        await aPullRequestAppears(pr);
        return work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN });
      },
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

  it('does not merge a pull request that moved after the plan was accepted, whatever head the agent names', async () => {
    const asked: string[] = [];
    const seen = { head: '' };
    const { b, run } = await start({
      script: (x) =>
        x.engine.script(
          'release-manager',
          async () => {
            await aPullRequestAppears(seen, { body: '' });
            return work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN });
          },
          async (call) => {
            const head = forge.others[0].head;
            for (const named of [head, 'f'.repeat(40)]) {
              try {
                asked.push(await call.release!({ op: 'merge-pr', version: '0.5.0', pr: 7, head: named }));
              } catch (e) {
                asked.push(`refused: ${(e as Error).message}`);
              }
            }
            return work('Nothing merged.', { comment: STEP('What was merged') });
          },
        ),
    });
    const planned = seen.head;
    expect(current(b, run).status).toBe('gate');
    expect(current(b, run).subject?.seen).toEqual({ '7': planned });
    // the author pushes again after the plan was written, and a sweep reads the host before the person says yes to it: the activities have the new head, what the gate
    // shows and freezes is still the one the run entered it with
    forge.others[0].head = 'a'.repeat(40);
    await b.runner.sweep();
    await b.settle();
    expect(current(b, run).subject?.activities).toEqual([expect.objectContaining({ pr: 7, head: 'a'.repeat(40) })]);
    expect(current(b, run).subject?.seen).toEqual({ '7': planned });
    // a call the gate refuses (no reason for a skip, an action that is none) freezes nothing
    expect(() => b.runner.gate(run.id, 'skip', '')).toThrow();
    expect(() => b.runner.gate(run.id, 'bogus' as never)).toThrow();
    expect(current(b, run).subject?.planned).toBeUndefined();
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(current(b, run).subject?.planned).toEqual({ '7': planned });
    // the host is read again at once, and the person is told the pull request moved since the plan
    expect(b.thread(run).some((m) => m.kind === 'system' && m.code === 'runner.release.movedSincePlan')).toBe(true);
    expect(current(b, run).subject?.activities).toEqual([expect.objectContaining({ pr: 7, head: 'a'.repeat(40) })]);
    expect(asked).toHaveLength(2);
    expect(asked.every((a) => /^Did not happen:.*was not in the plan you approved/.test(a))).toBe(true);
    expect(w.git('log', '-1', '--format=%s', 'release/0.5.0')).not.toMatch(/Merge pull request/);
  });

  it('goes all the way: the plan on the tracking issue, a merge made locally, a beta, the waits, the stable, and a push that always waits for a yes', async () => {
    const pr = { head: '' };
    // the person's checkout: nothing a release does may change it
    const before = w.snapshot();
    const { b, run } = await start({ script: (x) => script(x, pr) });
    // (a pull request was aimed at the branch the release opened while the plan was written: the plan has it)

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
    expect(activities).toContain(`[#7 Add the x](https://example.test/group/project/pull/7): approved and ready to merge (at \`${pr.head.slice(0, 9)}\`)`);
    expect(now.subject?.activities).toEqual([expect.objectContaining({ pr: 7, state: 'open', approved: true, issue: 12 })]);

    // the gate is approved: the Release manager merges the approved pull request into the branch, locally, and the run waits for the merges to be in
    b.runner.gate(run.id, 'approve');
    await b.settle();
    now = current(b, run);
    // accepting the plan froze the head the pull request had in it
    expect(now.subject?.planned).toEqual({ '7': pr.head });
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

    // the beta and both pushes wait in Actions even though the agent runs by itself (D6, D18): nothing was cut and nothing was sent, and the run waits for the host to
    // show the beta, not for the agent to have asked for it
    now = current(b, run);
    expect(now.stage).toBe('release-beta-out');
    expect(now.status).toBe('waiting');
    expect(now.wait?.kind).toBe('beta-out');
    expect(w.git('tag', '--list')).not.toContain('beta');
    expect(w.remote('tag', '--list')).not.toContain('beta');
    const proposals = pending().filter((a) => a.kind === 'release-git');
    expect(proposals.map((a) => (a.unit as { op: string }).op).sort()).toEqual(['beta', 'push-branch', 'push-tag']);
    const say = (op: string, list = proposals) => list.find((a) => (a.unit as { op: string }).op === op)!.id;
    const codes = (code: string) => b.thread(run).filter((m) => m.kind === 'system' && m.code === code);
    // the person says yes to the pushes before the cut: each is refused before it runs, nothing is sent, and the thread says why
    await expect(actions.approveAction(say('push-tag'))).rejects.toThrow(/waits for a step asked in the same stage: .*Cut the next beta/);
    await expect(actions.approveAction(say('push-branch'))).rejects.toThrow(/waits for a step asked in the same stage: .*Cut the next beta/);
    await b.settle();
    expect(codes('runner.release.stepWaits')).toHaveLength(2);
    expect(codes('runner.release.stepDone')).toHaveLength(0);
    expect(listAudit().filter((l) => l.kind === 'push')).toEqual([]);
    // in order: the cut (the script and the checks run), then the branch, then the tag
    await actions.approveAction(say('beta'));
    expect(w.git('tag', '--list')).toContain('v0.5.0-beta.1');
    expect(w.remote('tag', '--list')).not.toContain('beta');
    // a cut that stayed in the app's worktree is not a beta on the host
    expect(await b.runner.tick()).toEqual([]);
    // the branch went out by hand meanwhile: the app's push of it sends nothing, and says so instead of "done"
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    expect(await actions.approveAction(say('push-branch'))).toMatchObject({ state: 'done', nothingSent: true });
    await b.settle();
    expect(codes('runner.release.nothingSent')).toEqual([expect.objectContaining({ params: expect.objectContaining({ detail: expect.stringMatching(/^Nothing sent: the remote already has release\/0\.5\.0 at/) }) })]);
    await actions.approveAction(say('push-tag'));
    expect(w.remote('tag', '--list')).toContain('v0.5.0-beta.1');
    expect(listAudit().filter((l) => l.kind === 'push').map((l) => [l.target, l.fields.sent])).toEqual([['git push origin refs/tags/v0.5.0-beta.<latest>', 'true'], ['git push origin <sha>:refs/heads/release/0.5.0', 'false']]);

    // the tag is on the remote, and the run still waits for the host to show its pre-release published
    expect(await b.runner.tick()).toEqual([]);
    expect(current(b, run).stage).toBe('release-beta-out');
    forge.releases.set('v0.5.0-beta.1', { draft: false, prerelease: true, publishedAt: clock.toISOString() });
    await b.runner.tick();
    await b.settle();
    now = current(b, run);
    expect(now.stage).toBe('release-feedback');
    expect(now.status).toBe('waiting');
    expect(comments().some((c) => c.includes('**Beta published**') && c.includes('v0.5.0-beta.1 is out'))).toBe(true);
    // then for the beta to be out for a day: nothing happens before the day, nor with a blocking issue open
    expect(await b.runner.tick()).toEqual([]);
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    forge.issues.set(300, { number: 300, title: 'The beta crashes', body: '', labels: ['beta-blocker'], state: 'open' });
    expect(await b.runner.tick()).toEqual([]);
    forge.close(300);
    await b.runner.tick();
    await b.settle();
    now = current(b, run);
    expect(now.stage).toBe('release-stable-gate');
    expect(now.status).toBe('gate');

    // the stable: the cut and the pushes of main and of its tag all wait for a yes, and the run waits for the host to have the stable instead of ending with them pending
    b.runner.gate(run.id, 'approve');
    await b.settle();
    now = current(b, run);
    expect(now.stage).toBe('release-stable-out');
    expect(now.status).toBe('waiting');
    expect(w.git('tag', '--list')).not.toContain('v0.5.0\n');
    const stable = pending().filter((a) => a.kind === 'release-git');
    expect(stable.map((a) => (a.unit as { op: string }).op).sort()).toEqual(['push-branch', 'push-tag', 'stable']);
    expect(await b.runner.tick()).toEqual([]);
    await actions.approveAction(say('stable', stable));
    expect(w.steps.version).toBe('0.5.0');
    expect(w.git('tag', '--list').split('\n')).toContain('v0.5.0');
    expect(w.argv().flat()).not.toContain('--emergency');
    expect(w.argv().flat()).not.toContain('--allow-branch');
    expect(w.remote('tag', '--list').split('\n')).not.toContain('v0.5.0');
    // the stable tag is cut but only here: the run is not published
    expect(await b.runner.tick()).toEqual([]);
    expect(current(b, run).status).toBe('waiting');
    // the tag goes after main
    await expect(actions.approveAction(say('push-tag', stable))).rejects.toThrow(/waits for a step asked in the same stage/);
    for (const op of ['push-branch', 'push-tag']) await actions.approveAction(say(op, stable));
    expect(w.remote('tag', '--list').split('\n')).toContain('v0.5.0');
    expect(w.remote('rev-parse', 'main')).toBe(w.git('rev-parse', 'v0.5.0^{commit}'));
    // the host has the stable tag on main: the run is published, and ends there
    await b.runner.tick();
    await b.settle();
    now = current(b, run);
    expect(now.stage).toBe('release-published');
    expect(now.status).toBe('done');

    // the tracking issue stays open until the host shows the stable published; then it says so and is closed, by the agent, through the door
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
    // the whole release was made in the worktree of its own: the person's checkout, its HEAD, its branch and its status are as they were
    expect(w.snapshot()).toBe(before);
    expect(w.branch).toBe('main');
    void AUTHOR;
  });
});


describe('the tool the Release manager asks for the steps with', () => {
  const REFUSED = [
    ['a path', { op: 'beta', version: '0.5.0', path: '/etc/passwd' }],
    ['a way to skip the beta', { op: 'stable', version: '0.5.0', emergency: true }],
    ['a flag', { op: 'beta', version: '0.5.0', flags: '--allow-branch' }],
    ['another version', { op: 'beta', version: '0.6.0' }],
    ['a step that is not one', { op: 'push', version: '0.5.0' }],
    ['a merge of nothing', { op: 'merge-pr', version: '0.5.0' }],
    ['a suffix on the version', { op: 'beta', version: '0.5.0-beta.1' }],
    ['a tag push with no channel', { op: 'push-tag', version: '0.5.0' }],
  ] as const;

  it('refuses what is not one of the six steps of this run\'s version, tells the agent so, and does nothing', async () => {
    const answers: string[] = [];
    const { b, run } = await start({
      script: (x) =>
        x.engine.script('release-manager', async (call) => {
          for (const [, input] of REFUSED) answers.push(await call.release!(input));
          return work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN });
        }),
    });
    expect(answers).toHaveLength(REFUSED.length);
    for (const a of answers) expect(a).toMatch(/^Refused, nothing was done/);
    expect(w.argv()).toEqual([['open', '0.5.0', '--author', 'Runner Test <runner@example.test>', '--worktree']]);
    expect(pending()).toEqual([]);
    expect(listAudit().filter((l) => l.kind === 'release')).toHaveLength(1);
    expect(b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.release.stepRefused')).toHaveLength(REFUSED.length);
  });

  it('is given to the Release manager of a release run only, with the host read and nothing that writes: no shell, no files, no confinement', async () => {
    const { b } = await start();
    const call = b.engine.calls[0];
    expect(typeof call.release).toBe('function');
    expect(call.agent).toMatchObject({ id: 'release-manager', permission: 'read', tracker: 'read', shell: 'none' });
    expect(call.confine).toBeUndefined();
    expect(call.exec).toBeUndefined();
    expect(call.prompt).toContain('The release this run is about');
    expect(call.prompt).toContain('release/0.5.0');
    expect(call.prompt).toContain('does not exist yet');
    // an issue run gets no such tool
    const issueRun = await boot({ dir: ATAS, publish: true, repo: repoOf(), configure: (c) => (c.language = 'en') });
    issueRun.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    await issueRun.runner.start('app#101');
    await issueRun.settle();
    expect(issueRun.engine.calls[0].release).toBeUndefined();
    expect(issueRun.engine.calls[0].prompt).not.toContain('The release this run is about');
  });

  it('proposes a push that an autonomous agent asks for, and a step of a Release manager that waits, and runs neither', async () => {
    const asked: string[] = [];
    const { b, run } = await start({
      autonomous: false,
      script: (x) =>
        x.engine.script('release-manager', async (call) => {
          asked.push(await call.release!({ op: 'beta', version: '0.5.0' }));
          asked.push(await call.release!({ op: 'push-branch', version: '0.5.0' }));
          return work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN });
        }),
    });
    // the first stage of the run was started by the person who started it, and its result waits to be accepted
    expect(current(b, run).status).toBe('to-accept');
    expect(asked.map((a) => a.slice(0, 22))).toEqual(['Waiting for the person', 'Waiting for the person']);
    expect(pending().filter((a) => a.kind === 'release-git').map((a) => (a.unit as { op: string }).op).sort()).toEqual(['beta', 'open', 'push-branch']);
    expect(w.git('tag', '--list')).toBe('v0.4.0');
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
  });
});

describe('what the sweep and the waits read from the host', () => {
  async function waiting(kind: 'release-approved' | 'beta-age' | 'beta-out' | 'stable-out', wait: { minutes?: number; label?: string } = {}): Promise<{ b: Boot; run: Run; over: () => Promise<boolean> }> {
    const { b, run } = await start();
    const { createPublisher } = await import('../src/main/runner/publish');
    const { realDoor } = await import('../src/main/runner/door');
    const { getConfig } = await import('../src/main/workspaceConfig');
    const publisher = createPublisher({ runs: b.runs, forum: b.forum, config: getConfig, env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }), door: realDoor, now: () => clock, localTags: async () => w.git('tag', '--list').split('\n').filter(Boolean), remoteRelease: async () => remoteReleaseOf(w.dir, '0.5.0') });
    b.runs.update(run.id, (r) => ({ run: { ...r, status: 'waiting', wait: { kind, since: clock.toISOString(), ...wait } }, messages: [] }));
    return { b, run, over: async () => (await publisher.waitOver(run.id)).over };
  }

  const pr = (number: number, over: Partial<NonNullable<Forge['pr']>> = {}) => forge.others.push({ number, branch: `feat/${number}`, head: `${number}`.repeat(40), base: 'release/0.5.0', files: [], ...over });

  const tag = (name: string) => w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'tag', '-a', name, '-m', name);
  const published = (name: string) => forge.releases.set(name, { draft: false, prerelease: name.includes('beta'), publishedAt: clock.toISOString() });

  it('beta-out needs the latest beta on the remote, not only in this clone, and its pre-release published', async () => {
    const { over } = await waiting('beta-out');
    expect(await over()).toBe(false);
    w.change('Added', 'a thing for the version');
    tag('v0.5.0-beta.1');
    // the host shows a release for it, but the tag was never sent: a cut that stayed here
    published('v0.5.0-beta.1');
    expect(await over()).toBe(false);
    w.git('push', '-q', 'origin', 'v0.5.0-beta.1');
    expect(await over()).toBe(true);
    // a newer cut that stayed here: the remote only has the previous beta's tag
    w.change('Fixed', 'a fix after the beta');
    tag('v0.5.0-beta.2');
    expect(await over()).toBe(false);
    // sent, but its pre-release is not published yet
    w.git('push', '-q', 'origin', 'v0.5.0-beta.2');
    expect(await over()).toBe(false);
    published('v0.5.0-beta.2');
    expect(await over()).toBe(true);
  });

  it('stable-out needs the stable tag on the remote with its commit on the remote main, still true after main moved on, and is "not yet" when the remote cannot be read', async () => {
    const { over } = await waiting('stable-out');
    w.change('Added', 'the stable');
    tag('v0.5.0');
    expect(await over()).toBe(false);
    // the tag is on the remote, but main there does not have its commit
    w.git('push', '-q', 'origin', 'v0.5.0');
    expect(await over()).toBe(false);
    w.git('push', '-q', 'origin', 'main');
    expect(await over()).toBe(true);
    w.change('Fixed', 'something after the stable');
    w.git('push', '-q', 'origin', 'main');
    expect(await over()).toBe(true);
    w.git('remote', 'set-url', 'origin', join(w.root, 'nowhere.git'));
    expect(await over()).toBe(false);
  });

  it('release-approved goes on when no pull request is open against the branch, and not before', async () => {
    const { over } = await waiting('release-approved');
    expect(await over()).toBe(true);
    pr(7, { approved: true });
    pr(8, { merged: true });
    expect(await over()).toBe(false);
    forge.others[0].merged = true;
    expect(await over()).toBe(true);
    // a pull request aimed at another branch is not this release's
    forge.others.push({ number: 9, branch: 'feat/9', head: '9'.repeat(40), base: 'main', files: [] });
    expect(await over()).toBe(true);
  });

  it('beta-age needs a beta tag the host shows published, for the minutes asked, and no open issue with the blocking label', async () => {
    const { over } = await waiting('beta-age', { minutes: 60, label: 'beta-blocker' });
    // no beta tag at all
    expect(await over()).toBe(false);
    w.change('Added', 'a thing for the version');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'tag', '-a', 'v0.5.0-beta.1', '-m', 'beta');
    // a tag nobody published (a draft the host does not show)
    expect(await over()).toBe(false);
    forge.releases.set('v0.5.0-beta.1', { draft: true, prerelease: true, publishedAt: null });
    expect(await over()).toBe(false);
    // published, but not for long enough
    forge.releases.set('v0.5.0-beta.1', { draft: false, prerelease: true, publishedAt: new Date(clock.getTime() - 30 * 60_000).toISOString() });
    expect(await over()).toBe(false);
    clock = new Date(clock.getTime() + 31 * 60_000);
    expect(await over()).toBe(true);
    // a blocking report keeps it going until it is closed; another label does not
    forge.issues.set(300, { number: 300, title: 'Crash', body: '', labels: ['other'], state: 'open' });
    expect(await over()).toBe(true);
    forge.issues.get(300)!.labels = ['beta-blocker'];
    expect(await over()).toBe(false);
    forge.close(300);
    expect(await over()).toBe(true);
    // the latest beta is the one that counts: a newer one, not published yet, starts it over
    w.change('Fixed', 'a fix after the beta');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'tag', '-a', 'v0.5.0-beta.2', '-m', 'beta 2');
    expect(await over()).toBe(false);
  });

  it('beta-age counts a beta the host shows even when this clone has no tag of it (cut elsewhere), and the newest of them starts the wait over', async () => {
    const { over } = await waiting('beta-age', { minutes: 60 });
    expect(w.git('tag', '--list')).not.toContain('beta');
    forge.releases.set('v0.5.0-beta.1', { draft: false, prerelease: true, publishedAt: new Date(clock.getTime() - 3 * 3_600_000).toISOString() });
    expect(await over()).toBe(true);
    forge.releases.set('v0.5.0-beta.2', { draft: false, prerelease: true, publishedAt: new Date(clock.getTime() - 5 * 60_000).toISOString() });
    expect(await over()).toBe(false);
    clock = new Date(clock.getTime() + 56 * 60_000);
    expect(await over()).toBe(true);
  });

  it('beta-age reads the blocking label from the wait, and beta-blocker when it names none; and it goes on being unsure where the host cannot say', async () => {
    const { over } = await waiting('beta-age', { minutes: 1 });
    w.change('Added', 'a thing for the version');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'tag', '-a', 'v0.5.0-beta.1', '-m', 'beta');
    forge.releases.set('v0.5.0-beta.1', { draft: false, prerelease: true, publishedAt: new Date(clock.getTime() - 3_600_000).toISOString() });
    forge.issues.set(300, { number: 300, title: 'Crash', body: '', labels: ['beta-blocker'], state: 'open' });
    expect(await over()).toBe(false);
    forge.close(300);
    expect(await over()).toBe(true);
    // a host whose issues have no labels cannot say whether anything blocks: the wait goes on until the person skips it
    const rt = forge.runtime();
    const { VcsError } = await import('../src/main/vcs/errors');
    rt.provider.listIssues = async () => {
      throw new VcsError('unsupported', { kind: 'Bitbucket', what: 'labels' });
    };
    expect(await over()).toBe(false);
  });
});

describe('the comments of a release on its tracking issue', () => {
  it('wait as drafts while the issue does not exist and go out when it does, in place of nothing', async () => {
    forge.failWith = { status: 500, message: 'the host is down' };
    const pr = { head: '' };
    const { b, run } = await start({ script: (x) => x.engine.script('release-manager', () => work('Plan written.', { artifacts: [doc('RELEASE_PLAN.md')], comment: PLAN })) });
    void pr;
    expect(current(b, run).subject?.tracking).toBeNull();
    expect(current(b, run).comments['release-plan']).toMatchObject({ status: 'draft', target: 'issue' });
    expect(b.thread(run).some((m) => m.kind === 'system' && m.code === 'runner.release.trackingFailed')).toBe(true);
    expect(forge.issues.size).toBe(0);
    forge.failWith = null;
    await b.runner.tick();
    await b.settle();
    expect(current(b, run).subject?.tracking).toMatchObject({ iid: 200 });
    expect(current(b, run).comments['release-plan']).toMatchObject({ status: 'published' });
    expect(comments().some((c) => c.includes('**Release plan ready to approve**'))).toBe(true);
    // one comment per key: asking again edits nothing and posts nothing
    const writes = forge.writes.length;
    await b.runner.tick();
    await b.settle();
    expect(forge.writes).toHaveLength(writes);
  });

  it('edits the list of activities in place when a pull request changes, and does not post it again when nothing did', async () => {
    const { b, run } = await start();
    w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    forge.others.push({ number: 7, branch: 'feat/x', head: 'a'.repeat(40), base: 'release/0.5.0', files: [], title: 'Add the x' });
    await b.runner.tick();
    await b.settle();
    const first = forge.bodies(200).filter(([, body]) => body.includes('**Activities of the release**'));
    expect(first).toHaveLength(1);
    expect(first[0][1]).toContain('not approved yet');
    forge.others[0].approved = true;
    await b.runner.tick();
    await b.settle();
    const second = forge.bodies(200).filter(([, body]) => body.includes('**Activities of the release**'));
    expect(second).toHaveLength(1);
    expect(second[0][0]).toBe(first[0][0]);
    expect(second[0][1]).toContain('approved and ready to merge');
    const edits = forge.writes.filter((x) => x.method === 'PATCH');
    const writes = forge.writes.length;
    await b.runner.tick();
    await b.settle();
    expect(forge.writes).toHaveLength(writes);
    expect(edits.length).toBeGreaterThan(0);
  });
});

describe('a patch release', () => {
  it('opens the branch from the stable tag it is a patch of', async () => {
    const { b, run } = await start({ version: '0.4.1', from: 'v0.4.0' });
    w.stepsDir = join(w.root, 'worktrees', 'app', 'release-0.4.1-steps');
    expect(current(b, run).subject).toMatchObject({ version: '0.4.1', from: 'v0.4.0' });
    expect(w.argv()[0]).toEqual(['open', '0.4.1', '--from', 'v0.4.0', '--author', 'Runner Test <runner@example.test>', '--worktree']);
    expect(w.steps.branch).toBe('release/0.4.1');
    expect(forge.issues.get(200)?.title).toBe('Release 0.4.1');
  });
});

describe('moving a release run to the flow of the workspace', () => {
  it('keeps it in the release flow', async () => {
    const { b, run } = await start();
    const moved = b.runner.migrateFlow(run.id);
    expect(moved.flow?.stages.map((s) => s.id)).toEqual(current(b, run).flow?.stages.map((s) => s.id));
    expect(moved.flow?.stages.every((s) => s.id.startsWith('release-'))).toBe(true);
  });
});
