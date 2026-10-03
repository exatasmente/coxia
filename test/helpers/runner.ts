import type { AppEvent } from '../../src/shared/types';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECRET_GLOBS, secretPath, type AgentCall } from '../../src/main/agents';
import { currentJobId } from '../../src/main/activity';
import { policyFromHooks } from '../../src/main/engine/open/policy';
import type { ToolContext } from '../../src/main/engine/open/tools/types';
import { writeTool } from '../../src/main/engine/open/tools/write';
import { createForumStore } from '../../src/main/forum-core';
import type { StageEngine } from '../../src/main/runner/executor';
import { type IssueSource, type Runner, type RunnerDeps, createRunner } from '../../src/main/runner/service';
import { createRunStore } from '../../src/main/runs-core';
import type { VcsComment, VcsIssue } from '../../src/main/vcs/types';
import { neutralConfig } from '../../src/shared/config';
import type { WorkspaceConfig } from '../../src/shared/config/types';
import { agentFlow, agentFlowEngineering, applyTemplate } from '../../src/shared/cycles';
import { type ForumMessage, runThreadId } from '../../src/shared/forum';
import type { Run } from '../../src/shared/runs';
import { IDENTITY, git } from './conflictRepos';

// Hermetic git: nothing of the machine's own git configuration reaches the repositories of a test.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

export interface Repo {
  root: string;
  origin: string;
  clone: string;
  worktrees: string;
}

/** A bare "origin" with a `main` that has a package.json (test and typecheck scripts) and one source file, and a clone of it. */
export function makeRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'cerimonias-runner-'));
  const origin = join(root, 'remote', 'group', 'project.git');
  const seed = join(root, 'seed');
  const clone = join(root, 'clones', 'project');
  mkdirSync(origin, { recursive: true });
  const env = { ...process.env, ...IDENTITY };
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore', env });
  execFileSync('git', ['clone', origin, seed], { stdio: 'ignore', env });
  git(seed, 'checkout', '-q', '-b', 'main');
  mkdirSync(join(seed, 'src'));
  writeFileSync(join(seed, 'src/app.ts'), 'export const app = 1;\n');
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok', typecheck: 'echo ok' } }));
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore', env });
  return { root, origin, clone, worktrees: join(root, 'worktrees') };
}

export const issue = (iid: number, over: Partial<VcsIssue> = {}): VcsIssue => ({
  project: 'group/project',
  iid,
  title: `Add the thing ${iid}`,
  state: 'open',
  status: null,
  labels: [],
  milestone: null,
  assignees: [],
  author: 'ana',
  createdAt: null,
  updatedAt: null,
  closedAt: null,
  webUrl: `https://example.com/group/project/issues/${iid}`,
  body: 'The thing must do X and not Y.',
  ...over,
});

export interface FakeIssues extends IssueSource {
  items: Map<number, { issue: VcsIssue; comments: VcsComment[] }>;
  add(i: VcsIssue, comments?: VcsComment[]): void;
  reads: number[];
}

/** A code host that can only be read, and records what was read. */
export function fakeIssues(): FakeIssues {
  const items = new Map<number, { issue: VcsIssue; comments: VcsComment[] }>();
  const reads: number[] = [];
  return {
    items,
    reads,
    add: (i, comments = []) => void items.set(i.iid, { issue: i, comments }),
    ready: () => true,
    async get(iid) {
      reads.push(iid);
      const found = items.get(iid);
      if (!found) throw new Error(`no such issue ${iid}`);
      return found;
    },
    async triggered(label) {
      return [...items.values()].map((x) => x.issue).filter((i) => i.state === 'open' && i.labels.some((l) => l.toLowerCase() === label.toLowerCase()));
    },
  };
}

export const comment = (author: string, body: string, system = false): VcsComment => ({ id: Math.random(), author, body, createdAt: '2026-10-01T10:00:00Z', system, webUrl: null });

export interface Tools {
  /** What an agent's Write does: the reason when the hook refuses, null when it wrote. */
  write(path: string, content: string): Promise<string | null>;
  /** What an agent's Bash does before it runs: the reason when the hook refuses, null when it would run. */
  bash(command: string): Promise<string | null>;
}

export const toolsFor = (call: AgentCall): Tools => {
  const policy = policyFromHooks(call.confine?.hooks, 'fake');
  const ctx: ToolContext = { cwd: call.cwd, roots: [call.cwd], isSecret: (p) => secretPath(p, call.cwd), secretGlobs: SECRET_GLOBS, outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off', writeRoot: call.confine?.root ?? null };
  return {
    async write(path, content) {
      const denied = await policy.pre('Write', { file_path: path, content }, call.cwd);
      if (denied) return denied;
      await writeTool.run({ file_path: path, content }, ctx);
      return null;
    },
    async bash(command) {
      return policy.pre('Bash', { command }, call.cwd);
    },
  };
};

export type Responder = (call: AgentCall, tools: Tools, n: number) => unknown | Promise<unknown>;

export interface FakeEngine extends StageEngine {
  calls: AgentCall[];
  /** The activity job each call ran under. */
  jobs: (string | null)[];
  /** Per agent, what it answers on its 1st, 2nd... call; the last one repeats unless `once`. */
  script(agent: string, ...responders: Responder[]): void;
}

/** An engine that answers from a script per agent and records every call. Never a model: what an agent "does" is what the responder says. */
export function fakeEngine(): FakeEngine {
  const scripts = new Map<string, Responder[]>();
  const counts = new Map<string, number>();
  const calls: AgentCall[] = [];
  const jobs: (string | null)[] = [];
  const engine = Object.assign(async (call: AgentCall) => {
    calls.push(call);
    jobs.push(currentJobId());
    const id = call.agent.id;
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    const list = scripts.get(id) ?? [];
    const responder = list[Math.min(n, list.length) - 1];
    if (!responder) throw new Error(`the fake engine has no answer for ${id} (call ${n})`);
    return { data: await responder(call, toolsFor(call), n) };
  }, { calls, jobs, script: (agent: string, ...responders: Responder[]) => void scripts.set(agent, responders) });
  return engine;
}

export const work = (summary: string, extra: Record<string, unknown> = {}) => ({ summary, commit: '', artifacts: [], handoff: null, question: null, ...extra });
export const doc = (name: string, content = `# ${name}\n`) => ({ name, content });

export interface Boot {
  repo: Repo;
  runner: Runner;
  runs: ReturnType<typeof createRunStore>;
  forum: ReturnType<typeof createForumStore>;
  issues: FakeIssues;
  engine: FakeEngine;
  notices: { title: string; body: string; onClick: AppEvent }[];
  dir: string;
  deps: RunnerDeps;
  thread(run: Run | string): ForumMessage[];
  settle(): Promise<void>;
}

export interface BootOptions {
  /** The runner publishes to the code host through the real door (Actions and the audit log); the test installs the fake host with `setVcsRuntimeForTests`. */
  publish?: boolean;
  /** Changes the workspace config of the test before the run (the language, the templates, an agent's autonomy). */
  configure?: (c: WorkspaceConfig) => void;
  /** Which built-in flow the workspace has: the engineering one (refine to ready, the default of the runner's tests) or the agent cycle with the business team. */
  flow?: 'engineering' | 'business';
  repo?: Repo;
  engine?: FakeEngine;
  issues?: FakeIssues;
  dir?: string;
  timeoutMs?: number;
  /** Replaces the idle limit and the cap of a stage one by one. */
  limits?: { idleMs?: number; maxMs?: number };
}

/** The workspace config of the tests: the agent cycle on a workspace with one repository, a project of issues and the identity the app commits as. */
export function runnerConfig(c: WorkspaceConfig, repo: Repo, over: (c: WorkspaceConfig) => void = () => undefined, flow: 'engineering' | 'business' = 'engineering'): WorkspaceConfig {
  const next = applyTemplate(c, flow === 'business' ? agentFlow : agentFlowEngineering);
  next.projects.repos = [{ id: 'app', path: repo.clone, remoteUrl: null, vcsId: null, projectPath: 'group/project' }];
  next.projects.issues = { vcsId: null, project: 'group/project', projectId: null, refPrefix: 'app#' };
  next.runner = { ...next.runner, worktreesDir: repo.worktrees, identity: { name: 'Runner Test', email: 'runner@example.test' } };
  over(next);
  return next;
}

export async function boot(options: BootOptions = {}): Promise<Boot> {
  const { getConfig, updateConfig } = await import('../../src/main/workspaceConfig');
  const repo = options.repo ?? makeRepo();
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'cerimonias-runner-data-'));
  // Every boot starts from a fresh configuration: what an earlier test switched (an agent's autonomy, say) must not leak into the next.
  updateConfig(() => runnerConfig(neutralConfig(), repo, options.configure, options.flow));
  const runs = createRunStore(join(dir, 'runs'));
  const forum = createForumStore(join(dir, 'forum'));
  const issues = options.issues ?? fakeIssues();
  if (!options.issues) issues.add(issue(101), [comment('bob', 'Please keep it small.'), comment('system', 'changed the label', true)]);
  const engine = options.engine ?? fakeEngine();
  const notices: { title: string; body: string; onClick: AppEvent }[] = [];
  const deps: RunnerDeps = {
    runs,
    forum,
    config: getConfig,
    env: () => ({ repos: getConfig().projects.repos.map((r) => ({ ...r })), issues: getConfig().projects.issues, cloneRoots: [], host: null, home: '/home/nobody', dataDir: dir, fallbackCwd: dir }),
    issues,
    engine,
    updateConfig,
    notify: (n) => notices.push({ title: n.title, body: n.body, onClick: n.onClick }),
    timeoutMs: options.timeoutMs,
    limits: options.limits,
  };
  if (options.publish) {
    const { createPublisher } = await import('../../src/main/runner/publish');
    const { realDoor } = await import('../../src/main/runner/door');
    deps.publisher = createPublisher({ runs, forum, config: getConfig, env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }), door: realDoor });
  }
  const runner = createRunner(deps);
  return {
    repo,
    runner,
    runs,
    forum,
    issues,
    engine,
    notices,
    dir,
    deps,
    thread: (run) => forum.read(runThreadId(typeof run === 'string' ? run : run.id), 0, 2000)?.messages ?? [],
    settle: () => runner.idle(),
  };
}
