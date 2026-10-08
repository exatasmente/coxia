import type { AppEvent } from '../../src/shared/types';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import type { RemoteRelease } from '../../src/main/runner/release';
import type { CommandResult, CommandRunner } from '../../src/main/runner/commands';
import { SandboxError, type ExecResult, type HostOpenOptions, type OpenOptions, type SandboxService, type SandboxSession } from '../../src/main/sandbox';
import type { ImageRead, SandboxGui } from '../../src/main/sandbox/session';
import type { SandboxStatus } from '../../src/shared/sandbox';
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

/** A code host that can only be read, and records what was read. `triggered` is the person's own issues (`listMyIssues`): what carries `label` and is open and that
 * this person opened or was assigned, so an unassigned issue of another author never reaches the automatic scan — exactly the real host. */
export function fakeIssues(): FakeIssues {
  const items = new Map<number, { issue: VcsIssue; comments: VcsComment[] }>();
  const reads: number[] = [];
  const ME = 'ana';
  const mine = (i: VcsIssue): boolean => i.author === ME || i.assignees.includes(ME);
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
      return [...items.values()].map((x) => x.issue).filter((i) => i.state === 'open' && i.labels.some((l) => l.toLowerCase() === label.toLowerCase()) && mine(i));
    },
    async unassigned(label) {
      return [...items.values()].map((x) => x.issue).filter((i) => i.state === 'open' && i.labels.some((l) => l.toLowerCase() === label.toLowerCase()) && i.assignees.length === 0);
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
  const ctx: ToolContext = { cwd: call.cwd, roots: [call.cwd], isSecret: (p) => secretPath(p, call.cwd), secretGlobs: SECRET_GLOBS, outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off', writeRoot: call.confine?.writeRoot ?? call.confine?.root ?? null };
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

export async function keepQaEvidence(call: AgentCall): Promise<string[]> {
  // The folder the stage keeps evidence from: a sandbox's `out`, or the output folder a host session that tests an interface declared.
  const dir = call.exec?.outputDir;
  if (!dir || !call.evidence) return [];
  writeFileSync(join(dir, 'qa-result.txt'), 'QA check completed.\n');
  const saved = await call.evidence.save({ path: 'qa-result.txt', title: 'QA result' });
  const id = /\bev-\d+\b/.exec(saved.text)?.[0];
  if (!id) throw new Error(`QA evidence was not saved: ${saved.text}`);
  return [id];
}

/** What a responder returns for a call that ran out of turns and answered from the wrap-up: the engine reports it as `partial`. */
export class PartialAnswer {
  constructor(readonly data: unknown) {}
}

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
  let sessions = 0;
  const engine = Object.assign(async (call: AgentCall) => {
    calls.push(call);
    jobs.push(currentJobId());
    const id = call.agent.id;
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    const list = scripts.get(id) ?? [];
    const responder = list[Math.min(n, list.length) - 1];
    if (!responder) throw new Error(`the fake engine has no answer for ${id} (call ${n})`);
    const said = await responder(call, toolsFor(call), n);
    // The session of the call: the one a round that continues it resumes, or a new one.
    const sessionId = call.resume?.session ?? `session-${++sessions}`;
    return said instanceof PartialAnswer ? { data: said.data, partial: true as const, sessionId } : { data: said, sessionId };
  }, { calls, jobs, script: (agent: string, ...responders: Responder[]) => void scripts.set(agent, responders) });
  return engine;
}

export const work = (summary: string, extra: Record<string, unknown> = {}) => ({ summary, commit: '', artifacts: [], handoff: null, question: null, ...extra });
export const doc = (name: string, content = `# ${name}\n`) => ({ name, content });

/** A command runner that records what it was asked and answers from a table (exit 0 and "ok" otherwise): a test never starts a real process for QA. */
export function fakeCommands(table: Record<string, Partial<CommandResult>> = {}): CommandRunner & { ran: { cwd: string; command: string }[] } {
  const ran: { cwd: string; command: string }[] = [];
  const run = Object.assign(async (cwd: string, command: string): Promise<CommandResult> => {
    ran.push({ cwd, command });
    return { command, exitCode: 0, timedOut: false, output: 'ok', ms: 1, ...table[command] };
  }, { ran });
  return run;
}

export interface FakeSandbox extends SandboxService {
  /** What each stage asked for, and the sessions made. */
  opened: { options: OpenOptions; session: FakeSession; host: boolean }[];
}

export interface FakeSession extends SandboxSession {
  closed: boolean;
  /** What `exec` was asked, in order. */
  asked: string[];
}

/**
 * A sandbox that runs nothing: it answers every command from a table (exit 0 and "ok" otherwise), reports each one the way the real session does, and records when it was
 * closed. `available: false` makes it refuse like a machine without one. `onClose` runs when a session closes (to look at what the world was like then).
 */
export function fakeSandbox(o: { gui?: SandboxGui; images?: Record<string, ImageRead>; onOpen?: (options: OpenOptions) => void; repoFolders?: string[]; depsOutside?: string[]; available?: boolean; table?: Record<string, Partial<ExecResult>>; onClose?: () => void | Promise<void> } = {}): FakeSandbox {
  const opened: FakeSandbox['opened'] = [];
  const status: SandboxStatus = o.available === false ? { available: false, backend: null, version: null, reason: 'no-bwrap', detail: '' } : { available: true, backend: 'bwrap', version: '0.9.0', reason: null, detail: '' };
  return {
    opened,
    status: async () => status,
    purge: () => undefined,
    guiStatus: () => ({ browsers: 'unset', display: 'off' }),
    async open(options) {
      if (!status.available) throw new SandboxError('unavailable', { reason: 'bubblewrap is not installed' });
      o.onOpen?.(options);
      for (const f of o.repoFolders ?? []) options.onNote?.({ code: 'runner.sandbox.repoFolder', params: { path: f } });
      for (const name of o.depsOutside ?? []) options.onNote?.({ code: 'runner.sandbox.depsOutside', params: { name } });
      return session(options, false);
    },
    // A host session needs no sandbox: it opens on a machine without one too.
    async openHost(options) {
      o.onOpen?.(options);
      return session(options, true);
    },
  };

  function session(options: OpenOptions & Pick<HostOpenOptions, 'approve'>, host: boolean): FakeSession {
    const log: ExecResult[] = [];
    const asked: string[] = [];
    // A stage folder with an `out` inside, as the real sandbox makes: what the evidence tools read.
    const stageDir = mkdtempSync(join(tmpdir(), 'cerimonias-fake-stage-'));
    mkdirSync(join(stageDir, 'out'), { recursive: true });
    // The output folder this session declares: a sandbox's `out`, or the folder a host session is told to save in (`gui.out`, a real one the test names).
    const outDir = host ? (o.gui ? (o.gui.out ?? join(stageDir, 'out')) : null) : join(stageDir, 'out');
    // A host session makes the folder it saves in, as the real one does (`mkdirSync(shots)`); a test may name a real one of its own.
    if (outDir && o.gui) mkdirSync(outDir, { recursive: true });
    const made: FakeSession = {
      ...(host ? { description: 'host' } : {}),
      ...(host ? {} : { stageDir }),
      ...(outDir ? { outputDir: outDir } : {}),
      // What the stage offers to test an interface, and the reading of images from its output folder: a sandbox always reads one, a host session when it was given the settings
      // (and then its folder is a real one, named in `gui.out`).
      ...(o.gui ? { gui: host ? { ...o.gui, out: outDir as string } : o.gui } : {}),
      ...(outDir
        ? {
            readImage: (path: string): ImageRead => {
              const known = o.images?.[path];
              if (known) return known;
              // A file the stage really left in its output folder is read from it, as the real session does, so the looked path is the real one. The folder is named two
              // ways: `/coxia/out` (the sandbox's own name, which its tools hand over) and the real path a host stage saves in.
              const rel = path === '/coxia/out' || path === outDir ? '' : path.startsWith('/coxia/out/') ? path.slice('/coxia/out/'.length) : path.startsWith(`${outDir}/`) ? path.slice(outDir.length + 1) : path;
              const file = join(outDir, rel);
              try {
                const bytes = readFileSync(file);
                return { ok: true as const, path, mediaType: 'image/png', data: bytes.toString('base64'), file };
              } catch {
                return { ok: false as const, why: 'missing' as const };
              }
            },
          }
        : {}),
      closed: false,
      asked,
      log,
      async exec(command) {
        asked.push(command);
        // What the real session refuses without running it; a host session asks the person first.
        const answer = command.trim() && options.approve ? await options.approve(command) : { ok: true };
        if (!answer.ok) {
          const r: ExecResult = { n: log.length + 1, command, exitCode: null, timedOut: false, output: answer.note ?? '', ms: 0, refused: 'denied' };
          log.push(r);
          options.onExec?.(r, 'refused');
          return r;
        }
        const refused = !command.trim() ? ('empty' as const) : undefined;
        const r: ExecResult = refused ? { n: log.length + 1, command, exitCode: null, timedOut: false, output: '', ms: 0, refused } : { n: log.length + 1, command, exitCode: 0, timedOut: false, output: 'ok', ms: 5, ...o.table?.[command] };
        log.push(r);
        options.onExec?.(r, refused ? 'refused' : 'run');
        return r;
      },
      async close() {
        if (made.closed) return;
        made.closed = true;
        await o.onClose?.();
      },
    };
    opened.push({ options, session: made, host });
    return made;
  }
}

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
  /** What the app's commands before QA answer; a fake that exits 0 by default. */
  commandRunner?: CommandRunner;
  /** The sandbox of the agents set to `shell: sandbox`; none by default (such an agent's stage then fails). */
  sandbox?: SandboxService;
  timeoutMs?: number;
  /** Replaces the idle limit and the cap of a stage one by one. */
  limits?: { idleMs?: number; maxMs?: number };
  /** The one small call the sweep makes to a provider whose key ran out of budget; without it the runs keep waiting. */
  probeBudget?: RunnerDeps['probeBudget'];
  /** The clock the runner and its publisher read (a release run's waits are about how long ago something was published). */
  now?: () => Date;
  /** The tags a release run's wait for its beta reads. */
  localTags?: (run: Run) => Promise<string[]>;
  /** What the remote has of a release run's version: what its waits for the host read. */
  remoteRelease?: (run: Run) => Promise<RemoteRelease | null>;
  /** Told when an event of the fixed catalog happens in a run (a plugin is called through it). */
  pluginEvent?: RunnerDeps['pluginEvent'];
  pluginHold?: RunnerDeps['pluginHold'];
  pluginRelease?: RunnerDeps['pluginRelease'];
  pluginNotes?: RunnerDeps['pluginNotes'];
}

/** The workspace config of the tests: the agent cycle on a workspace with one repository, a project of issues and the identity the app commits as. */
export function runnerConfig(c: WorkspaceConfig, repo: Repo, over: (c: WorkspaceConfig) => void = () => undefined, flow: 'engineering' | 'business' = 'engineering'): WorkspaceConfig {
  const next = applyTemplate(c, flow === 'business' ? agentFlow : agentFlowEngineering);
  next.projects.repos = [{ id: 'app', path: repo.clone, remoteUrl: null, vcsId: null, projectPath: 'group/project' }];
  next.projects.issues = { vcsId: null, project: 'group/project', projectId: null, refPrefix: 'app#', cardScope: 'assigned', cardLabels: [] };
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
    commandRunner: options.commandRunner ?? fakeCommands(),
    sandbox: options.sandbox,
    timeoutMs: options.timeoutMs,
    limits: options.limits,
    probeBudget: options.probeBudget,
    now: options.now,
    pluginEvent: options.pluginEvent,
    pluginHold: options.pluginHold,
    pluginRelease: options.pluginRelease,
    pluginNotes: options.pluginNotes,
  };
  if (options.publish) {
    const { createPublisher } = await import('../../src/main/runner/publish');
    const { realDoor } = await import('../../src/main/runner/door');
    const { uploadsOf } = await import('../../src/main/evidence/store');
    deps.publisher = createPublisher({
      runs,
      forum,
      config: getConfig,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: realDoor,
      now: options.now,
      // The evidence a comment cites, read from the run's own store: what a test with a sandbox can put on the host.
      evidenceUploads: (run, ids) => {
        const images = uploadsOf(dir, run, [...ids]);
        const present = ids.filter((id) => run.evidence?.[id]);
        return { images, total: present.length || ids.length };
      },
      localTags: options.localTags,
      remoteRelease: options.remoteRelease,
    });
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
