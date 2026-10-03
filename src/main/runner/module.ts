import { HOME, ATAS } from '../env';
import { runAgent } from '../agents';
import { forumStore, interceptPosts } from '../forum';
import { RunError, isFlowCycle } from '../../shared/runs';
import type { Module } from '../module';
import { runStore } from '../runs';
import { vcsProvider, vcsReady } from '../vcs';
import { getConfig, rc, updateConfig } from '../workspaceConfig';
import { readArtifact } from './cycleFolder';
import { realDoor, onRunnerActionDone } from './door';
import { createPublisher } from './publish';
import { type GateAction, type IssueSource, type Runner, RunnerError, createRunner } from './service';

// The runner of the running workspace, and its channels. What a paired browser may call is decided in webPolicy.ts: reading runs and answering a
// question are open to it (the phone is where a person answers), everything else that starts work or changes a run is the desktop window's.
// What leaves the machine from a run (comments, reviews, the push, the pull request) goes through `realDoor` (door.ts): proposals in Actions, or, for an
// agent that is autonomous, an audited write; the push and the pull request always wait for a "sim".

const source: IssueSource = {
  ready: () => vcsReady(),
  async get(iid) {
    const project = rc().issues.project as string;
    const provider = vcsProvider();
    return { issue: await provider.getIssue(project, iid), comments: await provider.listIssueComments(project, iid) };
  },
  async triggered(label) {
    const provider = vcsProvider();
    if (!provider.caps.issues) return [];
    const want = label.trim().toLowerCase();
    return (await provider.listMyIssues({ project: rc().issues.project, limit: 100 })).filter((i) => i.state === 'open' && i.labels.some((l) => l.toLowerCase() === want));
  },
};

let current: Runner | null = null;

/** The runner of this process; undefined until the module registered. */
export const runner = (): Runner | null => current;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const id = (v: unknown): string => {
  if (typeof v !== 'string') throw new RunError('unknown-run', { id: '' });
  return v;
};

export const runsModule: Module = (ctx) => {
  const r = createRunner({
    runs: runStore(),
    forum: forumStore(),
    config: getConfig,
    env: () => ({ repos: rc().repos, issues: rc().issues, cloneRoots: rc().cloneRoots, host: rc().vcsHost, home: HOME, dataDir: ATAS, fallbackCwd: rc().projectsRoot }),
    issues: source,
    engine: (call, commands) => runAgent(call, commands),
    publisher: createPublisher({
      runs: runStore(),
      forum: forumStore(),
      config: getConfig,
      env: () => ({ issueProject: rc().issues.project ?? '', repos: rc().repos.map((x) => ({ id: x.id, projectPath: x.projectPath })) }),
      door: realDoor,
    }),
    updateConfig,
    notify: (n) => ctx.notify(n),
  });
  current = r;
  // A comment, a review, the push or the pull request that waited in Actions was approved: the run learns what the host made.
  onRunnerActionDone((action, responses) => r.actionDone(action, responses));
  // A person's post that answers the run's question is the answer; a person's @mention calls on the agent, read only.
  interceptPosts((thread, body) => r.answerPost(thread, body));
  forumStore().subscribe((m) => r.onMessage(m));

  ctx.handle('runs:list', () => r.list());
  ctx.handle('runs:get', (run: unknown) => (typeof run === 'string' ? r.get(run) : null));
  // A document a stage produced, for the run screen to show: read only, from the run's own cycle folder, and open to a paired browser like the thread beside it.
  ctx.handle('runs:artifact', (run: unknown, name: unknown) => {
    const found = typeof run === 'string' ? r.get(run) : null;
    return found ? readArtifact(found.worktree, found.cycleFolder, text(name)) : null;
  });
  ctx.handle('runs:start', (ref: unknown, repo?: unknown) => r.start(text(ref), typeof repo === 'string' && repo ? repo : undefined));
  ctx.handle('runs:startStage', (run: unknown) => r.startStage(id(run)));
  ctx.handle('runs:accept', (run: unknown, note?: unknown) => r.accept(id(run), text(note)));
  ctx.handle('runs:return', (run: unknown, note: unknown) => r.returnStage(id(run), text(note)));
  ctx.handle('runs:gate', (run: unknown, action: unknown, reason?: unknown) => r.gate(id(run), action as GateAction, text(reason)));
  ctx.handle('runs:answer', (run: unknown, answer: unknown) => r.answer(id(run), text(answer)));
  ctx.handle('runs:retry', (run: unknown) => r.retry(id(run)));
  ctx.handle('runs:cancel', (run: unknown) => r.cancel(id(run)));
  ctx.handle('runs:skipWait', (run: unknown, reason: unknown) => r.skipWait(id(run), text(reason)));
  ctx.handle('runs:migrateFlow', (run: unknown) => r.migrateFlow(id(run)));
  ctx.handle('runs:undoPost', (run: unknown, key: unknown) => r.undoPost(id(run), text(key)));
  ctx.handle('runs:setSquad', (run: unknown, squad: unknown) => r.setSquad(id(run), typeof squad === 'string' && squad ? squad : null));
  ctx.handle('runs:removeSquad', (squad: unknown, confirm?: unknown) => r.removeSquad(text(squad), confirm === true));
  ctx.handle('runs:setSquadAutonomous', (squad: unknown, on: unknown) => {
    if (typeof on !== 'boolean') throw new RunError('unknown-squad', { squad: '' });
    r.setSquadAutonomous(text(squad), on);
    return getConfig().squads?.find((q) => q.id === squad)?.autonomy ?? true;
  });
  ctx.handle('runs:setAutonomous', (agent: unknown, on: unknown) => {
    if (typeof agent !== 'string' || typeof on !== 'boolean') throw new RunnerError('unknown-agent', { agent: '' });
    r.setAutonomous(agent, on);
    return getConfig().agents.team.find((a) => a.id === agent)?.autonomous ?? false;
  });

  ctx.job({
    name: 'runner',
    everyMin: 5,
    workHoursOnly: false,
    enabled: () => getConfig().runner.enabled && isFlowCycle(getConfig().devCycle.stages) && vcsReady(),
    // Looks for new issues, for what the waiting runs wait for (a merged pull request, a reply, a label, the time) and for the reviews that waited for their pull
    // request. It never waits for a stage to end, and a sweep that is still going is not started twice.
    run: () => r.sweep(),
  });
  // A run that was in the middle of a stage when the app closed starts that stage over; the others go on where they were.
  setTimeout(() => r.resume(), 2_000);
};
