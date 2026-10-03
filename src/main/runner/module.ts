import { HOME, ATAS } from '../env';
import { runAgent } from '../agents';
import { forumStore, interceptPosts } from '../forum';
import { RunError } from '../../shared/runs';
import type { Module } from '../module';
import { runStore } from '../runs';
import { vcsProvider, vcsReady } from '../vcs';
import { getConfig, rc, updateConfig } from '../workspaceConfig';
import { type GateAction, type IssueSource, type Runner, RunnerError, createRunner } from './service';

// The runner of the running workspace, and its channels. What a paired browser may call is decided in webPolicy.ts: reading runs and answering a
// question are open to it (the phone is where a person answers), everything else that starts work or changes a run is the desktop window's.
// Nothing here writes to the code host: the issue is read through the provider and nothing else leaves the worktree.

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
    updateConfig,
    notify: (n) => ctx.notify(n),
  });
  current = r;
  // A person's post that answers the run's question is the answer; a person's @mention calls on the agent, read only.
  interceptPosts((thread, body) => r.answerPost(thread, body));
  forumStore().subscribe((m) => r.onMessage(m));

  ctx.handle('runs:list', () => r.list());
  ctx.handle('runs:get', (run: unknown) => (typeof run === 'string' ? r.get(run) : null));
  ctx.handle('runs:start', (ref: unknown, repo?: unknown) => r.start(text(ref), typeof repo === 'string' && repo ? repo : undefined));
  ctx.handle('runs:startStage', (run: unknown) => r.startStage(id(run)));
  ctx.handle('runs:accept', (run: unknown, note?: unknown) => r.accept(id(run), text(note)));
  ctx.handle('runs:return', (run: unknown, note: unknown) => r.returnStage(id(run), text(note)));
  ctx.handle('runs:gate', (run: unknown, action: unknown, reason?: unknown) => r.gate(id(run), action as GateAction, text(reason)));
  ctx.handle('runs:answer', (run: unknown, answer: unknown) => r.answer(id(run), text(answer)));
  ctx.handle('runs:retry', (run: unknown) => r.retry(id(run)));
  ctx.handle('runs:cancel', (run: unknown) => r.cancel(id(run)));
  ctx.handle('runs:setAutonomous', (agent: unknown, on: unknown) => {
    if (typeof agent !== 'string' || typeof on !== 'boolean') throw new RunnerError('unknown-agent', { agent: '' });
    r.setAutonomous(agent, on);
    return getConfig().agents.team.find((a) => a.id === agent)?.autonomous ?? false;
  });

  ctx.job({
    name: 'runner',
    everyMin: 5,
    workHoursOnly: false,
    enabled: () => getConfig().runner.enabled && getConfig().devCycle.templateId === 'agent-flow' && vcsReady(),
    run: async () => {
      await r.scan();
    },
  });
  // A run that was in the middle of a stage when the app closed starts that stage over; the others go on where they were.
  setTimeout(() => r.resume(), 2_000);
};
