import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome } from '../../shared/config/paths';
import type { IssueProjectConfig, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, parseMentions, runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import {
  type FlowStage,
  type Run,
  RunError,
  type Transition,
  acceptStage,
  assertStartable,
  answer as answerMove,
  ask,
  cancel as cancelMove,
  failuresText,
  findingsText,
  flowOf,
  gateApprove,
  gateReject,
  gateSkip,
  handBack,
  isTerminal,
  newRunId,
  recordQa,
  recordReview,
  resumeAfterRestart,
  retry as retryMove,
  returnStage as returnMove,
  reviewReturn,
  stageDone,
  stageFailed,
  startRun,
  startStage as startMove,
} from '../../shared/runs';
import type { AppEvent } from '../../shared/types';
import { updateAgent } from '../../shared/config/team';
import { withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { findClone, git } from '../conflictGit';
import { redact } from '../errorlog-core';
import type { ResolvedRepo } from '../config-resolve';
import type { ForumStore } from '../forum-core';
import { type RunStore } from '../runs-core';
import { beginRun, moveRun } from '../runs-forum';
import type { Notice } from '../scheduler';
import type { VcsComment, VcsIssue } from '../vcs/types';
import { cycleFolderOf, issueRecord, readFolder, slugOf, writeIssueRecord } from './cycleFolder';
import { type ExecutorDeps, type StageEngine, type StageRun, StageError, executeStage, pickAgent, withLimit } from './executor';
import { type Identity, WorktreeError, commitAll, commitMessage, createWorktree, repoIdentity } from './git';
import { mentionCall } from './mention';

// The runner: it takes an issue through the agent cycle. A run is started (a branch, a worktree, the cycle folder with the issue in it), and then every
// stage whose agent runs by itself is executed one after the other until the run reaches a gate, a question, a failure or its end; a stage whose agent waits
// for the person waits (to-start, to-accept). Everything goes through the run store and the forum (moveRun), so a restart resumes where the run was.
// Nothing here writes to the code host: the issue is only read, and what the agents do stays in the worktree.

export const RUNNER_ERROR_CODES = ['not-agent-flow', 'bad-ref', 'no-issue-project', 'issue-closed', 'repo-ambiguous', 'no-clone', 'no-identity', 'unknown-agent', 'bad-action', 'branch-exists', 'dest-exists', 'not-worktree'] as const;
export type RunnerErrorCode = (typeof RUNNER_ERROR_CODES)[number];

export class RunnerError extends Error {
  constructor(
    readonly code: RunnerErrorCode,
    params: Record<string, string | number> = {},
  ) {
    super(t(`main.runner.error.${code}`, params));
    this.name = 'RunnerError';
  }
}

/** What the runner reads from the code host: one issue with its comments, and the issues that ask for a run. Reads only. */
export interface IssueSource {
  get(iid: number): Promise<{ issue: VcsIssue; comments: VcsComment[] }>;
  /** Open issues carrying `label` that are assigned to the person. */
  triggered(label: string): Promise<VcsIssue[]>;
  /** The code host can be read right now. */
  ready(): boolean;
}

export interface RunnerEnv {
  repos: ResolvedRepo[];
  issues: IssueProjectConfig;
  cloneRoots: string[];
  host: string | null;
  home: string;
  /** The workspace's data folder: the default home of the worktrees. */
  dataDir: string;
  /** Where an agent that answers a mention looks when the run has no worktree any more. */
  fallbackCwd: string;
}

export interface RunnerDeps {
  runs: RunStore;
  forum: ForumStore;
  config(): WorkspaceConfig;
  env(): RunnerEnv;
  issues: IssueSource;
  engine: StageEngine;
  updateConfig(change: (config: WorkspaceConfig) => WorkspaceConfig): WorkspaceConfig;
  notify?(notice: Notice): void;
  now?(): Date;
  newId?(): string;
  identity?(wt: string): Promise<Identity | null>;
  /** Replaces `runner.stageTimeoutMs` (tests). */
  timeoutMs?: number;
}

export type GateAction = 'approve' | 'reject' | 'skip';

export interface Runner {
  list(): Run[];
  get(id: string): Run | null;
  start(ref: string, repoId?: string): Promise<Run>;
  startStage(id: string): Run;
  accept(id: string, note?: string): Run;
  returnStage(id: string, note: string): Run;
  gate(id: string, action: GateAction, reason?: string): Run;
  answer(id: string, text: string): Run;
  retry(id: string): Run;
  cancel(id: string): Run;
  setAutonomous(agentId: string, on: boolean): WorkspaceConfig;
  /** A person's post in a run's thread that answers the run's pending question: the answer is recorded and the stage goes on. Null when the post answers nothing. */
  answerPost(thread: string, text: string): ForumMessage | null;
  /** Reacts to a message of the forum: a person's `@agent` in a run's thread has that agent answer, read only. */
  onMessage(message: ForumMessage): void;
  /** Starts runs for the issues that ask for one, up to the configured number at a time. */
  scan(): Promise<Run[]>;
  /** After a restart: a run that was in the middle of a stage starts that stage over, and every run that can go on does. */
  resume(): void;
  /** Resolves when nothing is running: stages, mentions and what they started. */
  idle(): Promise<void>;
}

const MAX_STEPS = 200;
const iso = (d: Date): string => d.toISOString();

export function createRunner(deps: RunnerDeps): Runner {
  const now = (): string => iso(deps.now?.() ?? new Date());
  const flowNow = (): FlowStage[] => flowOf(deps.config());
  const d = { runs: deps.runs, forum: deps.forum };
  const exec: ExecutorDeps = { engine: deps.engine, config: deps.config, forum: deps.forum, identity: deps.identity, timeoutMs: deps.timeoutMs };

  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const aborts = new Map<string, AbortController>();
  const mentions = new Map<string, Promise<void>>();
  const refused = new Set<string>();
  const starting = new Set<string>();
  let scanning: Promise<Run[]> | null = null;

  const need = (id: string): Run => {
    const run = deps.runs.get(id);
    if (!run) throw new RunError('unknown-run', { id });
    return run;
  };

  // ---- telling the person -----------------------------------------------------------------------------------------------------------

  function tell(before: string | null, run: Run): void {
    if (before === run.status || !deps.notify || !deps.config().notifications) return;
    const key = ({ gate: 'gate', question: 'question', failed: 'failed', 'to-start': 'toStart', 'to-accept': 'toAccept', done: 'done' } as Record<string, string>)[run.status];
    if (!key) return;
    const params = { ref: run.issue.ref, title: run.issue.title, stage: flowNow().find((s) => s.id === run.stage)?.label ?? run.stage };
    const onClick: AppEvent = { type: 'navigate', to: 'today' };
    deps.notify({ title: t(`main.runner.notice.${key}.title`, params), body: t(`main.runner.notice.${key}.body`, params), onClick });
  }

  // Every change of a run goes through here: saved with its messages, the person told when it now waits for them, and the next stage started when it can.
  function move(id: string, change: (run: Run, flow: FlowStage[], at: string) => Transition): Run {
    const before = need(id).status;
    const run = moveRun(d, id, (r) => change(r, flowNow(), now()));
    tell(before, run);
    pump(id);
    return run;
  }
  // ---- running the stages -----------------------------------------------------------------------------------------------------------

  function pump(id: string): void {
    if (inflight.has(id)) {
      again.add(id);
      return;
    }
    const work = drive(id).finally(() => {
      inflight.delete(id);
      if (again.delete(id)) pump(id);
    });
    inflight.set(id, work);
  }

  async function drive(id: string): Promise<void> {
    for (let i = 0; i < MAX_STEPS; i++) {
      const run = deps.runs.get(id);
      if (!run || run.status !== 'working') return;
      await step(run);
      if (deps.runs.get(id)?.rev === run.rev) return;
    }
  }

  async function step(run: Run): Promise<void> {
    const abort = new AbortController();
    aborts.set(run.id, abort);
    let result: StageRun | null = null;
    let failure: unknown = null;
    try {
      result = await executeStage(exec, run, flowNow(), abort);
    } catch (e) {
      failure = e;
    } finally {
      aborts.delete(run.id);
    }
    // The person may have cancelled while the agent worked: what it did is kept in the worktree, and the run stays as the person left it.
    const current = deps.runs.get(run.id);
    if (!current || current.status !== 'working' || current.stage !== run.stage) return;
    try {
      if (failure) fail(current, failure);
      else if (result) settle(current, result);
    } catch (e) {
      if (e instanceof RunError && (e.code === 'wrong-state' || e.code === 'not-active')) return;
      fail(deps.runs.get(run.id) ?? current, e);
    }
  }

  function fail(run: Run, e: unknown): void {
    if (deps.runs.get(run.id)?.status !== 'working') return;
    const detail = redact(e instanceof Error ? e.message : String(e)).slice(0, 500);
    if (!(e instanceof StageError)) console.error('[runner]', run.id, run.stage, detail);
    const before = run.status;
    tell(before, moveRun(d, run.id, (r) => stageFailed(r, detail, now())));
  }

  // What an attempt means for the run: a question pauses it, findings send it back, anything else is the stage done.
  function settle(run: Run, r: StageRun): void {
    const flow = flowNow();
    const { agent } = pickAgent(deps.config(), run, flow);
    const by = agent.id;
    const stage = run.stage;
    const out = r.output;
    const refs = r.written.map((path) => ({ path }));
    const post = (text: string) => deps.forum.append(runThreadId(run.id), { kind: 'post', author: { type: 'agent', id: by }, text, refs, stage, public: true });
    const before = run.status;
    const apply = (change: (x: Run) => Transition): void => {
      tell(before, moveRun(d, run.id, change));
    };

    if (out.question) {
      if (out.summary) post(out.summary);
      apply((x) => ask(x, { by, text: out.question }, now()));
      return;
    }
    if (r.kind === 'review') {
      moveRun(d, run.id, (x) => recordReview(x, { stage, by, verdict: out.verdict ?? 'approved', summary: out.summary, findings: out.findings, head: r.head }, now()));
      const text = findingsText(out.summary, out.findings);
      if (out.verdict === 'changes') {
        apply((x) => reviewReturn(x, flow, { by, findings: text, handoff: text }, now()));
        return;
      }
      apply((x) => stageDone(x, flow, { summary: text, handoff: out.handoff, artifacts: r.written }, now()));
      return;
    }
    if (r.kind === 'qa') {
      moveRun(d, run.id, (x) => recordQa(x, { stage, by, summary: out.summary, scenarios: out.scenarios, head: r.head }, now()));
      const failed = out.scenarios.some((s) => s.result === 'fail');
      const builder = failed ? flow.find((s) => !s.human && s.agent && deps.config().agents.team.find((a) => a.id === s.agent)?.permission === 'worktree') : undefined;
      if (failed && builder && flow.findIndex((s) => s.id === builder.id) < flow.findIndex((s) => s.id === stage)) {
        const text = failuresText(out.summary, out.scenarios);
        post(text);
        apply((x) => handBack(x, flow, { by, toStage: builder.id, text, countRound: true }, now()));
        return;
      }
    }
    apply((x) => stageDone(x, flow, { summary: out.summary, handoff: out.handoff, artifacts: r.written }, now()));
  }

  // ---- starting a run ---------------------------------------------------------------------------------------------------------------

  function refOf(raw: string): { iid: number; ref: string } {
    const { refPrefix } = deps.env().issues;
    const bare = raw.trim().startsWith(refPrefix) ? raw.trim().slice(refPrefix.length) : raw.trim();
    if (!/^\d{1,9}$/.test(bare) || Number(bare) < 1) throw new RunnerError('bad-ref', { ref: raw.slice(0, 40) });
    return { iid: Number(bare), ref: `${refPrefix}${bare}` };
  }

  async function repoFor(project: string, repoId?: string): Promise<{ id: string; path: string }> {
    const env = deps.env();
    let repo: ResolvedRepo | undefined;
    if (repoId) repo = env.repos.find((r) => r.id === repoId);
    else {
      const own = env.repos.filter((r) => r.projectPath === project);
      repo = own.length === 1 ? own[0] : !own.length && env.repos.length === 1 ? env.repos[0] : undefined;
    }
    if (!repo) throw new RunnerError('repo-ambiguous', { project });
    if (existsSync(join(repo.path, '.git'))) return { id: repo.id, path: repo.path };
    const found = repo.projectPath && env.host ? await findClone(repo.projectPath, env.cloneRoots, env.host) : null;
    if (!found) throw new RunnerError('no-clone', { repo: repo.id });
    return { id: repo.id, path: found };
  }

  // Two starts for one issue at the same moment: the second is refused before it touches the repository.
  async function start(raw: string, repoId?: string): Promise<Run> {
    const { ref } = refOf(raw);
    if (starting.has(ref)) throw new RunError('duplicate', { issue: ref });
    starting.add(ref);
    try {
      return await create(raw, repoId);
    } finally {
      starting.delete(ref);
    }
  }

  async function create(raw: string, repoId?: string): Promise<Run> {
    const config = deps.config();
    if (config.devCycle.templateId !== 'agent-flow') throw new RunnerError('not-agent-flow');
    const env = deps.env();
    if (!env.issues.project) throw new RunnerError('no-issue-project');
    const { iid, ref } = refOf(raw);
    if (deps.runs.activeFor(ref)) throw new RunError('duplicate', { issue: ref });
    const flow = flowNow();
    // The refusal the first transition would give, before anything is created on disk.
    assertStartable(flow);

    const { issue, comments } = await deps.issues.get(iid);
    if (issue.state === 'closed') throw new RunnerError('issue-closed', { ref });
    const repo = await repoFor(env.issues.project, repoId);
    const identity = config.runner.identity.name.trim() ? { name: config.runner.identity.name.trim(), email: config.runner.identity.email.trim() } : await (deps.identity ?? repoIdentity)(repo.path);
    if (!identity) throw new RunnerError('no-identity', { repo: repo.id });

    const slug = slugOf(issue.title);
    const branch = `cycle/${iid}-${slug}`;
    const dest = join(config.runner.worktreesDir ? expandHome(config.runner.worktreesDir, env.home) : join(env.dataDir, 'worktrees'), repo.id, `${iid}-${slug}`);
    const folder = cycleFolderOf(iid, issue.title);

    const made = await createWorktree({ clone: repo.path, dest, branch }).catch((e) => {
      throw e instanceof WorktreeError ? new RunnerError(e.code, { detail: e.detail }) : e;
    });
    let run: Run;
    try {
      writeIssueRecord(dest, folder, issueRecord(issue, comments, ref));
      // i18n-ignore-next-line: the subject of a commit in the repository's history: English, like the rest of its commits
      await commitAll(dest, commitMessage(config.runner.commitMessage, 'add the issue record', iid), identity);
      const started = startRun(
        { id: deps.newId?.() ?? newRunId(Date.now(), Math.random().toString(36).slice(2, 6).padEnd(4, '0')), issue: { ref, iid, title: issue.title, url: issue.webUrl || null }, repo: repo.id, branch, worktree: dest, cycleFolder: folder, cycleId: config.devCycle.templateId, base: made.baseSha },
        flow,
        now(),
      );
      run = beginRun(d, started);
    } catch (e) {
      await discard(repo.path, dest, branch);
      throw e;
    }
    tell(null, run);
    pump(run.id);
    return run;
  }

  // A worktree and a branch this call made, left by a start that did not complete: the only thing the runner ever removes.
  async function discard(clone: string, dest: string, branch: string): Promise<void> {
    await git(clone, ['worktree', 'remove', '--force', dest], { fail: false });
    await git(clone, ['worktree', 'prune'], { fail: false });
    await git(clone, ['branch', '-D', branch], { fail: false });
  }

  // ---- what the person does ---------------------------------------------------------------------------------------------------------

  const api: Runner = {
    list: () => deps.runs.list(),
    get: (id) => deps.runs.get(id),
    start,
    startStage: (id) => move(id, (r, f, at) => startMove(r, f, at)),
    accept: (id, note = '') => move(id, (r, f, at) => acceptStage(r, f, at, note)),
    returnStage: (id, note) => move(id, (r, f, at) => returnMove(r, f, note, at)),
    gate(id, action, reason = '') {
      if (action === 'approve') return move(id, (r, f, at) => gateApprove(r, f, at, reason));
      if (action === 'reject') return move(id, (r, f, at) => gateReject(r, f, reason, at));
      if (action === 'skip') return move(id, (r, f, at) => gateSkip(r, f, reason, at));
      throw new RunnerError('bad-action', { action: String(action).slice(0, 20) });
    },
    answer: (id, text) => move(id, (r, f, at) => answerMove(r, f, text, at)),
    retry: (id) => move(id, (r, f, at) => retryMove(r, f, at)),
    cancel(id) {
      const run = move(id, (r, _f, at) => cancelMove(r, 'person', at));
      aborts.get(id)?.abort();
      return run;
    },
    setAutonomous(agentId, on) {
      if (!deps.config().agents.team.some((a) => a.id === agentId)) throw new RunnerError('unknown-agent', { agent: agentId.slice(0, 48) });
      return deps.updateConfig((c) => updateAgent(c, agentId, { autonomous: on }));
    },
    answerPost(thread, text) {
      const id = thread.startsWith('run-') ? thread.slice(4) : '';
      const run = id ? deps.runs.get(id) : null;
      if (!run || run.status !== 'question' || !text.trim()) return null;
      // Naming an agent asks that agent something; it is not the answer to the question that waits.
      if (parseMentions(text, deps.config().agents.team.map((a) => a.id)).length) return null;
      api.answer(run.id, text);
      const last = deps.forum.read(thread, Math.max(0, (deps.forum.summary(thread)?.count ?? 1) - 6))?.messages ?? [];
      return [...last].reverse().find((m) => m.kind === 'answer') ?? null;
    },
    onMessage(message) {
      if (message.author.type !== 'person' || message.kind !== 'post' || !message.mentions.length || !message.thread.startsWith('run-')) return;
      const runId = message.thread.slice(4);
      const prior = mentions.get(runId) ?? Promise.resolve();
      // One answer at a time per run: the thread reads in order.
      const next = prior.then(() => answerMention(runId, message)).catch(() => undefined);
      mentions.set(runId, next);
      void next.finally(() => {
        if (mentions.get(runId) === next) mentions.delete(runId);
      });
    },
    scan: () => (scanning ??= scanIssues().finally(() => (scanning = null))),
    resume() {
      for (const run of deps.runs.list().reverse()) {
        if (isTerminal(run)) continue;
        try {
          if (run.status === 'working') moveRun(d, run.id, (r) => resumeAfterRestart(r, flowNow(), now()));
          pump(run.id);
        } catch (e) {
          console.error('[runner] could not resume', run.id, e instanceof Error ? e.message : e);
        }
      }
    },
    async idle() {
      for (let i = 0; i < 50; i++) {
        const all = [...inflight.values(), ...mentions.values(), ...(scanning ? [scanning] : [])];
        if (!all.length) return;
        await Promise.allSettled(all);
      }
    },
  };

  // ---- the agents named in a message ------------------------------------------------------------------------------------------------

  // The agent answers in the thread, reading only: whatever its own permission is, a mention never gets it Edit, Write or a command.
  async function answerMention(runId: string, message: ForumMessage): Promise<void> {
    const run = deps.runs.get(runId);
    if (!run) return;
    const config = deps.config();
    const threadId = runThreadId(runId);
    const stage = run.stage;
    for (const id of message.mentions.slice(0, 3)) {
      const def = config.agents.team.find((a) => a.id === id);
      if (!def) continue;
      const reader = { ...def, permission: 'read' as const };
      const env = deps.env();
      const cwd = existsSync(run.worktree) ? run.worktree : env.fallbackCwd;
      const thread = deps.forum.read(threadId, 0, 2000)?.messages ?? [];
      try {
        const call: AgentCall = mentionCall({ run, agent: reader, config, message, thread, files: existsSync(run.worktree) ? readFolder(run.worktree, run.cycleFolder) : [], cwd });
        const abort = new AbortController();
        const r = await withLimit(withActivityContext(`run:${runId}`, () => deps.engine(call, [])), abort, deps.timeoutMs ?? config.runner.stageTimeoutMs);
        const text = typeof (r.data as { text?: unknown })?.text === 'string' ? (r.data as { text: string }).text.trim() : '';
        if (!text) throw new StageError('empty-answer');
        deps.forum.append(threadId, { kind: 'post', author: { type: 'agent', id }, text, stage, public: false });
      } catch (e) {
        const reason = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
        deps.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.mentionFailed', params: { agent: id, reason }, stage });
      }
    }
  }

  // ---- runs the app starts by itself ------------------------------------------------------------------------------------------------

  async function scanIssues(): Promise<Run[]> {
    const config = deps.config();
    if (!config.runner.enabled || config.devCycle.templateId !== 'agent-flow' || !deps.issues.ready()) return [];
    const room = config.runner.maxConcurrentRuns - deps.runs.list().filter((r) => r.status === 'working').length;
    if (room <= 0) return [];
    const found = (await deps.issues.triggered(config.runner.triggerLabel)).sort((a, b) => a.iid - b.iid);
    // An issue that ever had a run is not started again by itself: a cancelled or finished run with the label still on would otherwise come back.
    const known = new Set(deps.runs.list().map((r) => r.issue.ref));
    const started: Run[] = [];
    for (const issue of found) {
      if (started.length >= room) break;
      const { ref } = refOf(String(issue.iid));
      if (known.has(ref) || refused.has(ref)) continue;
      try {
        started.push(await start(ref));
      } catch (e) {
        // Tried once per app session: a refusal (no clone, no identity) does not become a retry every few minutes.
        refused.add(ref);
        console.error('[runner] could not start', ref, e instanceof Error ? e.message : e);
      }
    }
    return started;
  }

  return api;
}
