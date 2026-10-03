import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome } from '../../shared/config/paths';
import type { AgentDef, IssueProjectConfig, SquadDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumDraft, type ForumMessage, SQUADS_CHANNEL, parseMentions, runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import {
  type FlowStage,
  type PendingQuestion,
  type Run,
  type ScopeRule,
  type RunLink,
  RunError,
  type StageOutput,
  type Transition,
  acceptStage,
  askReporter,
  askSquad,
  assertStartable,
  answer as answerMove,
  answerByAgent,
  ask,
  cancel as cancelMove,
  failuresText,
  findingsText,
  flowErrors,
  flowIssueText,
  flowOf,
  flowOfRun,
  isFlowCycle,
  migrateFlow as migrateFlowMove,
  gateApprove,
  gateReject,
  gateSkip,
  handBack,
  createdIssueOf,
  isTerminal,
  leaveSquad,
  linkUpdate,
  MAX_QUESTION_HOPS,
  newRunId,
  passQuestion,
  producerOf,
  recordQa,
  recordReview,
  resumeAfterRestart,
  retry as retryMove,
  routeIssue,
  routeSquad,
  returnStage as returnMove,
  reviewReturn,
  stageDone,
  stageFailed,
  squadErrors,
  squadIssueText,
  startRun,
  startStage as startMove,
  waitDone,
  waitLinked,
  waitSkip,
} from '../../shared/runs';
import type { AppEvent } from '../../shared/types';
import { autonomousOf, membersOf, removeSquad as removeSquadConfig, squadOf, squadView, squadsOf, updateSquad } from '../../shared/config/squads';
import { cycleText } from '../../shared/cycles/text';
import { ensureSquadChannels } from '../forum-channels';
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
import type { ReleaseAction } from '../../shared/types';
import type { VcsComment, VcsIssue } from '../vcs/types';
import { cycleFolderOf, issueRecord, readFolder, slugOf, writeIssueRecord } from './cycleFolder';
import { type ExecutorDeps, type StageEngine, type StageRun, StageError, askTarget, executeStage, pickAgent, withLimit } from './executor';
import { type Identity, WorktreeError, commitAll, commitMessage, createWorktree, repoIdentity } from './git';
import { type ChainRequest, chainCall, readChain } from './chain';
import { type RequestAnswer, readRequestAnswer, requestCall } from './request';
import { mentionCall } from './mention';
import type { IssueMade, Publisher } from './publish';

// The runner: it takes an issue through the agent cycle. A run is started (a branch, a worktree, the cycle folder with the issue in it), and then every
// stage whose agent runs by itself is executed one after the other until the run reaches a gate, a question, a failure or its end; a stage whose agent waits
// for the person waits (to-start, to-accept). Everything goes through the run store and the forum (moveRun), so a restart resumes where the run was.
// Nothing here writes to the code host: the issue is only read, and what the agents do stays in the worktree.

export const RUNNER_ERROR_CODES = ['nothing-to-undo', 'not-agent-flow', 'bad-ref', 'no-issue-project', 'issue-closed', 'repo-ambiguous', 'no-clone', 'no-identity', 'unknown-agent', 'bad-action', 'branch-exists', 'dest-exists', 'not-worktree'] as const;
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

/** A run that another squad's request makes: the squad it goes to, and the run that asked. */
export interface LinkedStart {
  squad: string;
  origin: NonNullable<Parameters<typeof startRun>[0]['origin']>;
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
  /** What leaves the machine from a run (comments, reviews, the push and the pull request); without it the runner writes nothing to the code host. */
  publisher?: Publisher;
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
  /** Proposes deleting a comment the runner posted by itself, as an action that waits for a "yes" (and is audited when it runs); the run keeps the record as removed. */
  undoPost(id: string, key: string): Promise<{ proposed: boolean; reason?: 'refused' | 'nothing' | 'no-host' }>;
  /** The person does not wait any longer for the event of a waiting run. A reason is required. */
  skipWait(id: string, reason: string): Run;
  /** The run follows the current flow of the cycle from now on, when its stage still exists there. */
  migrateFlow(id: string): Run;
  /** The person decides the squad of a run that waits for it (the scope rules could not pick one and the front door does not run by itself); null: go on with no squad. */
  setSquad(id: string, squad: string | null): Run;
  /** Removes a squad from the workspace. Its active runs go on with no squad, but only after the person confirms: without `confirm` nothing changes and the runs are listed. */
  removeSquad(squad: string, confirm: boolean): { removed: boolean; runs: string[] };
  setAutonomous(agentId: string, on: boolean): WorkspaceConfig;
  /** The switch of a whole squad: off holds every member (each agent's own switch applies when it is on). Takes effect at the next stage start or publication. */
  setSquadAutonomous(squad: string, on: boolean): WorkspaceConfig;
  /** A person's post in a run's thread that answers the run's pending question: the answer is recorded and the stage goes on. Null when the post answers nothing. */
  answerPost(thread: string, text: string): ForumMessage | null;
  /** Reacts to a message of the forum: a person's `@agent` in a run's thread has that agent answer, read only. */
  onMessage(message: ForumMessage): void;
  /** Starts runs for the issues that ask for one, up to the configured number at a time. */
  scan(): Promise<Run[]>;
  /** Looks for what each waiting run waits for (a merged pull request, a reply, a label, the time) and sends on the runs whose event happened. */
  tick(): Promise<Run[]>;
  /** A proposal of the runner was carried out in Actions (a comment, a review, the push, the pull request): the run goes on from there. */
  actionDone(action: ReleaseAction, responses: unknown[]): void;
  /** Posts the reviews that waited for their pull request, for the runs whose pull request exists by now. */
  flush(): Promise<void>;
  /** After a restart: a run that was in the middle of a stage starts that stage over, and every run that can go on does. */
  resume(): void;
  /** Resolves when nothing is running: stages, mentions and what they started. */
  idle(): Promise<void>;
}

const MAX_STEPS = 200;
const iso = (d: Date): string => d.toISOString();

export function createRunner(deps: RunnerDeps): Runner {
  const now = (): string => iso(deps.now?.() ?? new Date());
  const flowNow = (): FlowStage[] => flowOf(squadView(deps.config(), null));
  // A run follows the flow it started with (a copy it carries), with the agents as they are now.
  const flowFor = (run: Run): FlowStage[] => flowOfRun(run, deps.config());
  const d = { runs: deps.runs, forum: deps.forum };
  const exec: ExecutorDeps = { engine: deps.engine, config: deps.config, forum: deps.forum, identity: deps.identity, timeoutMs: deps.timeoutMs };

  // What goes to the code host is published one thing at a time per run, in the order it happened, without holding the stages back.
  const publishing = new Map<string, Promise<void>>();
  const publish = (runId: string, work: (p: Publisher) => Promise<void>): void => {
    const p = deps.publisher;
    if (!p) return;
    const next = (publishing.get(runId) ?? Promise.resolve()).then(() => work(p)).catch((e) => console.error('[runner] publishing', runId, e instanceof Error ? e.message : e));
    publishing.set(runId, next);
    void next.finally(() => {
      if (publishing.get(runId) === next) publishing.delete(runId);
    });
  };

  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const aborts = new Map<string, AbortController>();
  const mentions = new Map<string, Promise<void>>();
  const chains = new Map<string, Promise<void>>();
  const chainAborts = new Map<string, AbortController>();
  const refused = new Set<string>();
  const starting = new Set<string>();
  let scanning: Promise<Run[]> | null = null;
  let ticking: Promise<Run[]> | null = null;

  const need = (id: string): Run => {
    const run = deps.runs.get(id);
    if (!run) throw new RunError('unknown-run', { id });
    return run;
  };

  // ---- telling the person -----------------------------------------------------------------------------------------------------------

  function tell(prior: Run | null, run: Run): void {
    // A run that was made for another's request has ended: the run that waits on it can go on.
    if (run.status === 'done' && prior?.status !== 'done') for (const l of run.links ?? []) if (l.role === 'origin' && l.run) trackLink(settleLinked(l.run).then(() => undefined));
    // The label a stage sets on the tracker goes out when the run enters it.
    if (prior && prior.stage !== run.stage && deps.publisher) {
      const flow = flowFor(run);
      const entered = flow.find((s) => s.id === run.stage);
      const previous = flow.find((s) => s.id === prior.stage) ?? null;
      if (entered && (entered.trackerStatus || previous?.trackerStatus)) {
        // A work stage's own agent speaks for it; a gate, a wait or an end has none, so its label waits for a "yes".
        const autonomous = entered.type === 'work' && !!entered.agent && entered.autonomous;
        publish(run.id, (p) => p.stageEntered(run.id, { stage: entered, previous, autonomous }));
      }
    }
    // A question that goes to another agent first starts walking its chain; the person is told only when it reaches them.
    if (run.status === 'question' && run.question?.kind === 'agent' && run.question.holder) startChain(run.id);
    const before = prior?.status ?? null;
    if (before === run.status || (run.status === 'question' && run.question?.holder)) return;
    notify(run);
  }

  function notify(run: Run): void {
    if (!deps.notify || !deps.config().notifications) return;
    const key = ({ gate: 'gate', question: 'question', failed: 'failed', 'to-start': 'toStart', 'to-accept': 'toAccept', done: 'done' } as Record<string, string>)[run.status];
    if (!key) return;
    const params = { ref: run.issue.ref, title: run.issue.title, stage: flowFor(run).find((s) => s.id === run.stage)?.label ?? run.stage };
    const onClick: AppEvent = { type: 'open', screen: { name: 'run', id: run.id } };
    deps.notify({ title: t(`main.runner.notice.${key}.title`, params), body: t(`main.runner.notice.${key}.body`, params), onClick });
  }

  // Every change of a run goes through here: saved with its messages, the person told when it now waits for them, and the next stage started when it can.
  function move(id: string, change: (run: Run, flow: FlowStage[], at: string) => Transition): Run {
    const before = need(id);
    const run = moveRun(d, id, (r) => change(r, flowFor(r), now()));
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
    const work = drive(id)
      .catch((e) => console.error('[runner]', id, e instanceof Error ? e.message : e))
      .finally(() => {
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
      result = await executeStage(exec, run, flowFor(run), abort);
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
    tell(run, moveRun(d, run.id, (r) => stageFailed(r, detail, now())));
  }

  // What an attempt means for the run: a question pauses it, findings send it back, anything else is the stage done.
  function settle(run: Run, r: StageRun): void {
    const flow = flowFor(run);
    const { agent, stage: flowStage } = pickAgent(deps.config(), run, flow);
    const by = agent.id;
    const stage = run.stage;
    const out = r.output;
    const refs = r.written.map((path) => ({ path }));
    const post = (text: string) => deps.forum.append(runThreadId(run.id), { kind: 'post', author: { type: 'agent', id: by }, text, refs, stage, public: true });
    const apply = (change: (x: Run) => Transition): void => {
      tell(run, moveRun(d, run.id, change));
    };
    // The stage's result goes to the tracker after the run has moved on: a comment, a review, and, at the end of the stage that changes code, the push.
    const autonomous = run.stages.find((s) => s.stage === stage)?.autonomous ?? false;
    const ended = (round?: number): void => publish(run.id, (p) => p.stageEnded(run.id, { stage: flowStage, agent, kind: r.kind, output: out, round, autonomous }));

    if (out.reporterQuestion) {
      if (out.summary) post(out.summary);
      apply((x) => askReporter(x, { by, text: out.reporterQuestion }, now()));
      publish(run.id, (p) => p.asked(run.id, { stage: flowStage, agent, question: out.reporterQuestion, autonomous }));
      return;
    }
    if (out.question) {
      if (out.summary) post(out.summary);
      // The question goes to the agent the asker turns to; a decision only the person can take goes to them at once. What reaches the person is also asked on the issue.
      const holder = out.needsPerson ? null : askTarget(deps.config(), agent);
      apply((x) => ask(x, { by, text: out.question, holder }, now()));
      if (!holder) publish(run.id, (p) => p.asked(run.id, { stage: flowStage, agent, question: out.question, autonomous }));
      return;
    }
    if (run.routing && flow[0]?.id === stage) {
      routeFrontDoor(run, { agent, out, written: r.written, autonomous });
      ended();
      return;
    }
    if (r.kind === 'review') {
      const recorded = moveRun(d, run.id, (x) => recordReview(x, { stage, by, verdict: out.verdict ?? 'approved', summary: out.summary, findings: out.findings, head: r.head }, now()));
      const text = findingsText(out.summary, out.findings);
      if (out.verdict === 'changes') {
        apply((x) => reviewReturn(x, flow, { by, findings: text, handoff: text }, now()));
        ended(recorded.reviews.length);
        return;
      }
      apply((x) => stageDone(x, flow, { summary: text, handoff: out.handoff, artifacts: r.written }, now()));
      ended(recorded.reviews.length);
      return;
    }
    if (r.kind === 'qa') {
      moveRun(d, run.id, (x) => recordQa(x, { stage, by, summary: out.summary, scenarios: out.scenarios, head: r.head }, now()));
      const failed = out.scenarios.some((s) => s.result === 'fail');
      const back = flow.find((s) => s.id === flowStage.returnsTo);
      if (failed && back && back.type === 'work') {
        const text = failuresText(out.summary, out.scenarios);
        post(text);
        apply((x) => handBack(x, flow, { by, toStage: back.id, text, countRound: true }, now()));
        ended();
        return;
      }
    }
    apply((x) => stageDone(x, flow, { summary: out.summary, handoff: out.handoff, artifacts: r.written }, now()));
    ended();
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
  async function start(raw: string, repoId?: string, force?: LinkedStart): Promise<Run> {
    const { ref } = refOf(raw);
    if (starting.has(ref)) throw new RunError('duplicate', { issue: ref });
    starting.add(ref);
    try {
      return await create(raw, repoId, force);
    } finally {
      starting.delete(ref);
    }
  }

  async function create(raw: string, repoId?: string, force?: LinkedStart): Promise<Run> {
    const config = deps.config();
    if (!isFlowCycle(config.devCycle.stages)) throw new RunnerError('not-agent-flow');
    const env = deps.env();
    if (!env.issues.project) throw new RunnerError('no-issue-project');
    const { iid, ref } = refOf(raw);
    if (deps.runs.activeFor(ref)) throw new RunError('duplicate', { issue: ref });
    const flow = flowNow();
    // The refusal the first transition would give, before anything is created on disk, and then what the flow check says stops a run.
    assertStartable(flow);
    const broken = flowErrors({ stages: config.devCycle.stages, team: config.agents.team }, { asFlow: true });
    if (broken.length) throw new RunError('invalid-flow', { detail: broken.slice(0, 3).map((i) => flowIssueText(i)).join(' ') });

    const squadBroken = squadErrors({ squads: squadsOf(config), team: config.agents.team, stages: config.devCycle.stages, flows: config.devCycle.flows }, { checkSharedFlow: true });
    if (squadBroken.length) throw new RunError('invalid-flow', { detail: squadBroken.slice(0, 3).map((i) => squadIssueText(i)).join(' ') });

    const { issue, comments } = await deps.issues.get(iid);
    if (issue.state === 'closed') throw new RunnerError('issue-closed', { ref });
    // The squads that can take work, and what the issue says about which one is its: its labels, and the files its text mentions.
    const routable = squadsOf(config).filter((q) => membersOf(config, q.id).length);
    const text = [issue.title, issue.body, ...comments.filter((c) => !c.system).map((c) => c.body)].join('\n');
    // A run another squad's request makes goes to that squad, in the repository it owns: nothing is routed.
    if (force && !routable.some((q) => q.id === force.squad)) throw new RunError('unknown-squad', { squad: force.squad.slice(0, 48) });
    const owned = force ? (squadOf(config, force.squad)?.scope.repos ?? []).filter((r) => env.repos.some((x) => x.id === r)) : [];
    const repo = await repoFor(env.issues.project, repoId ?? (force ? owned[0] : routable.length ? repoOfSquad(routable, issue.labels, text, env) : undefined));
    const routed: { kind: 'matched'; squad: string; rule: ScopeRule | 'request' } | ReturnType<typeof routeIssue> | null = force ? { kind: 'matched', squad: force.squad, rule: 'request' } : routable.length ? routeIssue(routable, { repo: repo.id, labels: issue.labels, text }) : null;
    if (routable.length) ensureSquadChannels(deps.forum, squadsOf(config), config.language);
    // The flow the run starts with: its squad's when the scope rules picked one, the workspace's otherwise (the front door then proposes the squad).
    let startFlow = flow;
    let squad: { id: string; name: string; rule: ScopeRule | 'request' } | null = null;
    if (routed?.kind === 'matched') {
      const view = squadView(config, routed.squad);
      startFlow = flowOf(view, view.devCycle.stages);
      assertStartable(startFlow);
      squad = { id: routed.squad, name: cycleText(squadOf(config, routed.squad)?.name ?? routed.squad, config.language), rule: routed.rule };
    }
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
        { id: deps.newId?.() ?? newRunId(Date.now(), Math.random().toString(36).slice(2, 6).padEnd(4, '0')), issue: { ref, iid, title: issue.title, url: issue.webUrl || null }, repo: repo.id, branch, worktree: dest, cycleFolder: folder, cycleId: config.devCycle.templateId, base: made.baseSha, squad, origin: force?.origin ?? null, routing: routed?.kind === 'ambiguous' ? { candidates: routed.candidates, why: routed.why } : null },
        startFlow,
        now(),
      );
      run = beginRun(d, started);
    } catch (e) {
      await discard(repo.path, dest, branch);
      throw e;
    }
    tell(null, run);
    // The label of the squad goes onto an issue the squad's own request created already: it was born with it.
    if (squad && !force) labelSquad(run, squad.id);
    pump(run.id);
    return run;
  }

  // The repository of an issue the caller did not name, when the project has several: the one the squad that labels or paths pick owns, if it owns exactly one.
  function repoOfSquad(squads: SquadDef[], labels: string[], text: string, env: RunnerEnv): string | undefined {
    const own = env.repos.filter((r) => r.projectPath === env.issues.project);
    if (own.length < 2) return undefined;
    const routed = routeIssue(squads, { repo: null, labels, text });
    if (routed.kind !== 'matched') return undefined;
    const mine = (squads.find((q) => q.id === routed.squad)?.scope.repos ?? []).filter((id) => own.some((r) => r.id === id));
    return mine.length === 1 ? mine[0] : undefined;
  }

  // The label of a squad goes onto the issue when a run starts in it, under the autonomy of the squad's liaison (a proposal when it does not run by itself).
  function labelSquad(run: Run, squadId: string): void {
    const config = deps.config();
    const q = squadOf(config, squadId);
    if (!q?.label?.trim() || !deps.publisher) return;
    const liaison = config.agents.team.find((a) => a.id === q.liaison);
    publish(run.id, (p) => p.squadRouted(run.id, { squad: q.id, label: q.label as string, by: liaison?.id ?? 'app', autonomous: !!liaison && autonomousOf(config, liaison) }));
  }

  // The front door ended on a run whose squad is not decided: the agent's proposal decides it when the agent runs by itself; otherwise the person chooses.
  function routeFrontDoor(run: Run, e: { agent: AgentDef; out: StageOutput; written: string[]; autonomous: boolean }): void {
    const config = deps.config();
    const routing = run.routing as NonNullable<Run['routing']>;
    const result = { by: e.agent.id, summary: e.out.summary, handoff: e.out.handoff, artifacts: e.written };
    const proposed = routing.candidates.includes(e.out.squad) ? e.out.squad : null;
    if (proposed && e.autonomous) {
      const view = squadView(config, proposed);
      const flow = flowOf(view, view.devCycle.stages);
      const name = cycleText(squadOf(config, proposed)?.name ?? proposed, config.language);
      tell(run, moveRun(d, run.id, (x) => routeSquad(x, { squad: proposed, name, flow, by: e.agent.id, reason: e.out.squadReason, how: 'agent', result }, now())));
      labelSquad(run, proposed);
      return;
    }
    tell(run, moveRun(d, run.id, (x) => askSquad(x, { ...result, proposal: proposed ? { squad: proposed, reason: e.out.squadReason } : null }, now())));
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
      const before = need(id);
      const flow = flowFor(before);
      const gateStage = flow.find((s) => s.id === before.stage);
      // Whether the decision goes to the tracker by itself follows the agent whose work it judged, as that agent's stage stood when the person decided.
      const judged = gateStage ? (flow.find((s) => s.id === gateStage.returnsTo) ?? null) : null;
      const autonomous = judged ? (before.stages.find((s) => s.stage === judged.id)?.autonomous ?? false) : false;
      const decided = (run: Run): Run => {
        if (gateStage?.type === 'gate') publish(id, (p) => p.gateDecided(id, { stage: gateStage, action, reason, autonomous }));
        return run;
      };
      if (action === 'approve') return decided(move(id, (r, f, at) => gateApprove(r, f, at, reason)));
      if (action === 'reject') return decided(move(id, (r, f, at) => gateReject(r, f, reason, at)));
      if (action === 'skip') return decided(move(id, (r, f, at) => gateSkip(r, f, reason, at)));
      throw new RunnerError('bad-action', { action: String(action).slice(0, 20) });
    },
    answer: (id, text) => move(id, (r, f, at) => answerMove(r, f, text, at)),
    retry: (id) => move(id, (r, f, at) => retryMove(r, f, at)),
    cancel(id) {
      const run = move(id, (r, _f, at) => cancelMove(r, 'person', at));
      aborts.get(id)?.abort();
      chainAborts.get(id)?.abort();
      return run;
    },
    async undoPost(id, key) {
      const run = need(id);
      const rec = run.comments[key];
      if (!deps.publisher || !rec || rec.status !== 'published' || rec.noteId === null || key === 'pr') throw new RunnerError('nothing-to-undo', { key: key.slice(0, 48) });
      return deps.publisher.undo(id, key);
    },
    skipWait: (id, reason) => move(id, (r, f, at) => waitSkip(r, f, reason, at)),
    migrateFlow(id) {
      const config = deps.config();
      // The flow a run moves to is its squad's (the workspace's when it has none).
      const view = squadView(config, need(id).squad);
      const broken = flowErrors({ stages: view.devCycle.stages, team: view.agents.team }, { asFlow: true });
      if (broken.length) throw new RunError('invalid-flow', { detail: broken.slice(0, 3).map((i) => flowIssueText(i)).join(' ') });
      const flow = flowOf(view, view.devCycle.stages);
      return move(id, (r, _f, at) => migrateFlowMove(r, flow, at));
    },
    setSquad(id, squadId) {
      const run = need(id);
      if (!run.routing || run.status !== 'question' || run.question?.kind !== 'squad') throw new RunError('not-routing');
      const config = deps.config();
      const q = squadId === null ? null : squadOf(config, squadId);
      if (squadId !== null && !q) throw new RunError('unknown-squad', { squad: squadId.slice(0, 48) });
      const view = squadView(config, squadId);
      const flow = flowOf(view, view.devCycle.stages);
      assertStartable(flow);
      const name = q ? cycleText(q.name, config.language) : t('main.runs.squad.none');
      const moved = move(id, (r, _f, at) => routeSquad(r, { squad: squadId, name, flow, by: 'person', reason: '', how: 'person' }, at));
      if (squadId) labelSquad(moved, squadId);
      return moved;
    },
    removeSquad(squadId, confirm) {
      if (!squadOf(deps.config(), squadId)) throw new RunError('unknown-squad', { squad: squadId.slice(0, 48) });
      const affected = deps.runs.list().filter((r) => r.squad === squadId && !isTerminal(r));
      if (!confirm) return { removed: false, runs: affected.map((r) => r.id) };
      deps.updateConfig((c) => removeSquadConfig(c, squadId));
      for (const r of affected) move(r.id, (x, _f, at) => leaveSquad(x, at));
      return { removed: true, runs: affected.map((r) => r.id) };
    },
    setSquadAutonomous(squadId, on) {
      if (!squadOf(deps.config(), squadId)) throw new RunError('unknown-squad', { squad: squadId.slice(0, 48) });
      return deps.updateConfig((c) => updateSquad(c, squadId, { autonomy: on }));
    },
    setAutonomous(agentId, on) {
      if (!deps.config().agents.team.some((a) => a.id === agentId)) throw new RunnerError('unknown-agent', { agent: agentId.slice(0, 48) });
      return deps.updateConfig((c) => updateAgent(c, agentId, { autonomous: on }));
    },
    answerPost(thread, text) {
      const id = thread.startsWith('run-') ? thread.slice(4) : '';
      const run = id ? deps.runs.get(id) : null;
      if (!run || run.status !== 'question' || run.question?.kind === 'squad' || !text.trim()) return null;
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
    tick: () => (ticking ??= lookForEvents().finally(() => (ticking = null))),
    actionDone(action, responses) {
      const id = String(action.unit?.runId ?? '');
      if (!id || !deps.runs.get(id)) return;
      // The issue another squad's request waited to create was approved: the run of that squad starts on it.
      if (action.unit?.purpose === 'request-issue') {
        const made = createdIssueOf(responses[0]);
        trackLink((made ? linkedIssueCreated(id, String(action.unit.key), made.iid) : linkRefused(id, String(action.unit.key), t('main.runner.comment.noId'))).then(() => undefined));
        return;
      }
      publish(id, (p) => p.actionDone(action, responses));
    },
    async flush() {
      for (const run of deps.runs.list()) {
        if (run.status !== 'cancelled' && Object.values(run.comments).some((c) => c.status === 'draft' && c.target === 'mr')) publish(run.id, (p) => p.flushReviews(run.id));
      }
      await api.idle();
    },
    resume() {
      for (const run of deps.runs.list().reverse()) {
        if (run.status !== 'cancelled' && Object.values(run.comments).some((c) => c.status === 'draft' && c.target === 'mr')) publish(run.id, (p) => p.flushReviews(run.id));
        if (isTerminal(run)) continue;
        try {
          if (run.status === 'question' && run.question?.holder) startChain(run.id);
          if (run.status === 'working') moveRun(d, run.id, (r) => resumeAfterRestart(r, flowFor(r), now()));
          pump(run.id);
        } catch (e) {
          console.error('[runner] could not resume', run.id, e instanceof Error ? e.message : e);
        }
      }
    },
    async idle() {
      for (let i = 0; i < 50; i++) {
        const all = [...inflight.values(), ...mentions.values(), ...chains.values(), ...publishing.values(), ...linkWork.values(), ...(scanning ? [scanning] : []), ...(ticking ? [ticking] : [])];
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

  // ---- agents talk before they ask the person ----------------------------------------------------------------------------------------

  function startChain(id: string): void {
    if (chains.has(id)) return;
    // Started on the next turn, so the map holds it before the walk makes its first move.
    const work = Promise.resolve()
      .then(() => walkChain(id))
      .catch((e) => console.error('[runner] question chain', id, e instanceof Error ? e.message : e))
      .finally(() => {
        chains.delete(id);
        chainAborts.delete(id);
      });
    chains.set(id, work);
  }

  // The question reaches the person: it is a public record (and asked on the issue under the asker's autonomy), and the person is told.
  function reachPerson(id: string): void {
    const run = need(id);
    const q = run.question;
    if (!q || q.kind !== 'agent') return;
    const flowStage = flowFor(run).find((s) => s.id === q.stage);
    const agent = deps.config().agents.team.find((a) => a.id === q.by);
    if (flowStage && agent) {
      const autonomous = run.stages.find((s) => s.stage === q.stage)?.autonomous ?? false;
      publish(id, (p) => p.asked(id, { stage: flowStage, agent, question: q.text, autonomous }));
    }
    notify(run);
  }

  // Up to the person, with what happened said in the thread: every hop is a message, and so is the one that forced the question up.
  function handUp(id: string, from: string, why: 'hops' | 'gone' | 'failed', detail = ''): void {
    const run = need(id);
    deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: `runner.chain.${why}`, params: { agent: from, detail, hops: MAX_QUESTION_HOPS }, stage: run.stage });
    move(id, (r, _f, at) => passQuestion(r, { from, to: null, text: '', reason: '' }, at));
    reachPerson(id);
  }

  async function walkChain(id: string): Promise<void> {
    for (let step = 0; step <= MAX_QUESTION_HOPS + 1; step++) {
      const run = deps.runs.get(id);
      const q = run?.question;
      if (!run || run.status !== 'question' || !q || q.kind !== 'agent' || !q.holder) return;
      const config = deps.config();
      const holder = config.agents.team.find((a) => a.id === q.holder);
      if (!holder) return handUp(id, q.holder, 'gone');
      if ((q.hops ?? 0) >= MAX_QUESTION_HOPS) return handUp(id, holder.id, 'hops');

      const env = deps.env();
      const cwd = existsSync(run.worktree) ? run.worktree : env.fallbackCwd;
      // The liaison of a squad may answer with a request to another squad's liaison, when there is one to receive it.
      const own = squadOf(config, holder.squad);
      const others = squadsOf(config).filter((o) => o.id !== own?.id && o.liaison && config.agents.team.some((a) => a.id === o.liaison && a.squad === o.id));
      const liaison = own && own.liaison === holder.id && others.length ? { squad: own, others } : undefined;
      let answer: ReturnType<typeof readChain> = null;
      let failure = '';
      try {
        const call = chainCall({ run, holder, asker: q.by, question: q.text, config, thread: deps.forum.read(runThreadId(id), 0, 2000)?.messages ?? [], files: existsSync(run.worktree) ? readFolder(run.worktree, run.cycleFolder) : [], cwd, liaison });
        const abort = new AbortController();
        chainAborts.set(id, abort);
        const r = await withLimit(withActivityContext(`run:${id}`, () => deps.engine(call, [])), abort, deps.timeoutMs ?? config.runner.stageTimeoutMs);
        answer = readChain(r.data);
        if (!answer) failure = 'empty-answer';
      } catch (e) {
        failure = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
      }
      // The person (or a cancel) may have answered while the agent thought: then what it said is not used.
      const now = deps.runs.get(id)?.question;
      if (deps.runs.get(id)?.status !== 'question' || !now || now.askedAt !== q.askedAt || now.holder !== q.holder || (now.hops ?? 0) !== (q.hops ?? 0)) return;
      if (!answer) return handUp(id, holder.id, 'failed', failure);
      if (answer.verdict === 'request') return handleRequest(id, holder, q, answer.request, !!liaison);

      if (answer.verdict === 'answer' && answer.text) {
        move(id, (r, _f, at) => answerByAgent(r, { by: holder.id, text: answer.text }, at));
        return;
      }
      // Pass on to whoever the holder turns to (the person when it turns to no one); a decision only the person can take goes to them straight.
      const next = answer.verdict === 'pass' ? askTarget(config, holder) : null;
      move(id, (r, _f, at) => passQuestion(r, { from: holder.id, to: next, text: answer.verdict === 'pass' ? answer.text : '', reason: answer.reason }, at));
      if (next === null) return reachPerson(id);
    }
  }

  // ---- requests between squads ------------------------------------------------------------------------------------------------------

  const linkWork = new Set<Promise<void>>();
  const trackLink = (work: Promise<void>): void => {
    const p: Promise<void> = work
      .catch((e) => console.error('[runner] linked runs', e instanceof Error ? e.message : e))
      .finally(() => void linkWork.delete(p));
    linkWork.add(p);
  };

  const squadName = (config: WorkspaceConfig, q: SquadDef): string => cycleText(q.name || q.id, config.language);

  // What the liaison of a squad reads when a request reaches it: the repository its squad owns, else the run's worktree.
  const squadCwd = (to: SquadDef, run: Run): string => {
    const env = deps.env();
    return env.repos.find((r) => to.scope.repos.includes(r.id) && existsSync(r.path))?.path ?? (existsSync(run.worktree) ? run.worktree : env.fallbackCwd);
  };

  // The liaison of a squad made a request to the liaison of another, in the squads channel; that one reads it (only reads) and answers, declines, turns it into an
  // issue of its squad or hands it to the person. What it says goes back down the chain: the asker's question is answered with it.
  async function handleRequest(id: string, holder: AgentDef, q: PendingQuestion, request: ChainRequest | null, offered: boolean): Promise<void> {
    const config = deps.config();
    const run = need(id);
    const from = squadOf(config, holder.squad);
    const to = request ? squadOf(config, request.squad) : null;
    const target = to?.liaison ? config.agents.team.find((a) => a.id === to.liaison && a.squad === to.id) : undefined;
    if (!offered || !request || !from || from.liaison !== holder.id || !to || to.id === from.id || !target) return handUp(id, holder.id, 'failed', t('main.runner.request.invalid'));
    ensureSquadChannels(deps.forum, squadsOf(config), config.language);
    const toName = squadName(config, to);
    const [sent] = deps.forum.append(SQUADS_CHANNEL, { kind: 'request', author: { type: 'agent', id: holder.id }, to: target.id, text: request.text, params: { from: from.id, squad: to.id, kind: request.kind, run: id, ref: run.issue.ref }, public: false });
    deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: 'runner.request.sent', params: { agent: holder.id, squad: toName, kind: request.kind }, stage: run.stage });
    const reply = (draft: Partial<ForumDraft>) => deps.forum.append(SQUADS_CHANNEL, { kind: 'answer', author: { type: 'agent', id: target.id }, to: holder.id, replyTo: sent.seq, public: false, ...draft });

    let answer: RequestAnswer | null = null;
    let failure = '';
    try {
      const call = requestCall({ run, holder: target, asker: holder.id, from, to, kind: request.kind, text: request.text, config, thread: deps.forum.read(SQUADS_CHANNEL, 0, 2000)?.messages ?? [], cwd: squadCwd(to, run) });
      const abort = new AbortController();
      chainAborts.set(id, abort);
      const r = await withLimit(withActivityContext(`run:${id}`, () => deps.engine(call, [])), abort, deps.timeoutMs ?? config.runner.stageTimeoutMs);
      answer = readRequestAnswer(r.data);
      if (!answer) failure = 'empty-answer';
    } catch (e) {
      failure = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    // The person (or a cancel) may have answered while the other liaison thought: then what it said is not used (the request stays in the channel as it was).
    const now = deps.runs.get(id)?.question;
    if (deps.runs.get(id)?.status !== 'question' || !now || now.askedAt !== q.askedAt || now.holder !== q.holder || (now.hops ?? 0) !== (q.hops ?? 0)) return;
    if (!answer) {
      reply({ author: { type: 'app' }, to: null, code: 'runner.request.failed', params: { agent: target.id, reason: failure } });
      return handUp(id, holder.id, 'failed', t('main.runner.request.failedDetail', { squad: toName, reason: failure }));
    }

    if (answer.verdict === 'answer') {
      reply({ text: answer.text });
      move(id, (r, _f, at) => answerByAgent(r, { by: holder.id, text: t('main.runner.request.answerText', { squad: toName, agent: target.id, text: answer.text }) }, at));
      return;
    }
    if (answer.verdict === 'decline') {
      const reason = answer.reason || '—';
      reply({ code: 'runner.request.declined', params: { reason } });
      move(id, (r, _f, at) => answerByAgent(r, { by: holder.id, text: t('main.runner.request.declinedText', { squad: toName, agent: target.id, reason }) }, at));
      return;
    }
    if (answer.verdict === 'needs-person') {
      const reason = answer.reason || '—';
      reply({ code: 'runner.request.handedUp', params: { reason } });
      move(id, (r, _f, at) => passQuestion(r, { from: holder.id, to: null, text: `${q.text}\n\n${t('main.runner.request.needsPersonText', { squad: toName, reason })}`, reason: '' }, at));
      return reachPerson(id);
    }

    // The request becomes an issue of the other squad. The asker's run waits for it (the question is answered with "asked, waiting"), and the issue is created on
    // the tracker under the autonomy of the liaison that took the request: by itself, or as a proposal that waits for a "yes".
    reply({ code: 'runner.request.willIssue', params: { title: answer.title }, text: answer.text });
    const key = `req-${(run.links ?? []).length + 1}`;
    const body = `${answer.text}\n\n${t('main.runner.request.issueOrigin', { squad: squadName(config, from), ref: run.issue.ref })}`;
    move(id, (r, _f, at) => waitLinked(r, { by: holder.id, text: t('main.runner.request.waitingText', { squad: toName, title: answer.title }), link: { key, kind: request.kind, squad: to.id, run: null, issue: null, title: answer.title, status: 'proposed' } }, at));
    const made: IssueMade = deps.publisher ? await deps.publisher.requestIssue(id, { key, squad: toName, title: answer.title, body, label: to.label, by: target.id, autonomous: autonomousOf(config, target) }) : { status: 'no-host', reason: '' };
    await afterIssue(id, key, made);
  }

  async function afterIssue(id: string, key: string, made: IssueMade): Promise<void> {
    if (made.status === 'proposed') return;
    if (made.status === 'created') return linkedIssueCreated(id, key, made.iid);
    return linkRefused(id, key, made.reason);
  }

  // The issue exists: the run of the other squad starts on it, linked to the run that asked, and each thread says so.
  async function linkedIssueCreated(id: string, key: string, iid: number): Promise<void> {
    const origin = deps.runs.get(id);
    const link = origin?.links?.find((l) => l.key === key);
    if (!origin || !link || link.status !== 'proposed' || !link.squad) return;
    const config = deps.config();
    const to = squadOf(config, link.squad);
    try {
      const made = await start(String(iid), undefined, { squad: link.squad, origin: { run: id, issue: origin.issue.ref, squad: origin.squad ?? null, kind: link.kind, key, title: link.title } });
      moveRun(d, id, (r) => linkUpdate(r, key, { run: made.id, issue: made.issue.ref, status: 'open' }, now()));
      const params = { issue: made.issue.ref, run: made.id, squad: to ? squadName(config, to) : link.squad, origin: origin.issue.ref };
      deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: 'runner.request.linked', params, stage: origin.stage });
      deps.forum.append(SQUADS_CHANNEL, { kind: 'system', author: { type: 'app' }, code: 'runner.request.linkedChannel', params });
    } catch (e) {
      await linkRefused(id, key, redact(e instanceof Error ? e.message : String(e)).slice(0, 300));
    }
  }

  // The issue will not exist (a refusal, a failure, the person's "no"): the link says so and the stage that waited for it goes on, told.
  async function linkRefused(id: string, key: string, reason: string): Promise<void> {
    const run = deps.runs.get(id);
    const link = run?.links?.find((l) => l.key === key);
    if (!run || !link || link.status === 'refused') return;
    moveRun(d, id, (r) => linkUpdate(r, key, { status: 'refused' }, now()));
    await settleLinked(id, reason);
  }

  async function issueClosed(ref: string): Promise<boolean> {
    try {
      return (await deps.issues.get(refOf(ref).iid)).issue.state === 'closed';
    } catch {
      return false;
    }
  }

  // A run that waits on `linked-done` goes on when every run it asked for has ended (or its issue was closed); a request that will not become an issue counts as
  // over, and the stage is told. Returns whether the run went on.
  async function settleLinked(id: string, why = ''): Promise<boolean> {
    const run = deps.runs.get(id);
    if (!run || run.status !== 'waiting' || run.wait?.kind !== 'linked-done') return false;
    const links = (run.links ?? []).filter((l) => l.role === 'requested');
    // A wait stage with nothing requested has nothing to wait for; an agent that asked has its request.
    if (!links.length && run.wait.by) return false;
    const ended: { link: RunLink; how: 'done' | 'refused' }[] = [];
    for (const l of links) {
      if (l.status === 'refused') ended.push({ link: l, how: 'refused' });
      else if (l.status === 'done') ended.push({ link: l, how: 'done' });
      else if (l.status === 'proposed' || !l.run) return false;
      else if (deps.runs.get(l.run)?.status === 'done' || (l.issue && (await issueClosed(l.issue)))) ended.push({ link: l, how: 'done' });
      else return false;
    }
    // The person may have moved the run while the host was being asked.
    if (deps.runs.get(id)?.rev !== run.rev) return false;
    for (const e of ended) if (e.link.status === 'open') moveRun(d, id, (r) => linkUpdate(r, e.link.key, { status: 'done' }, now()));
    const lines = ended.map((e) => (e.how === 'done' ? t('main.runner.linked.done', { ref: e.link.issue ?? e.link.title }) : t('main.runner.linked.refused', { title: e.link.title, reason: why || '—' })));
    move(id, (r, f, at) => waitDone(r, f, { reply: lines.join('\n'), from: 'app' }, at));
    return true;
  }

  // ---- what a waiting run waits for -------------------------------------------------------------------------------------------------

  // Every waiting run is looked at once per tick: the code host says whether its event happened, and the run goes on from where it waits.
  async function lookForEvents(): Promise<Run[]> {
    const sent: Run[] = [];
    for (const run of deps.runs.list().filter((r) => r.status === 'waiting')) {
      const w = run.wait;
      if (!w) continue;
      let over: { over: boolean; reply?: string } = { over: false };
      if (w.kind === 'linked-done') {
        // The runner knows its own runs: the stage goes on when the runs it asked for have ended (or their issues were closed).
        if (await settleLinked(run.id)) {
          const moved = deps.runs.get(run.id);
          if (moved) sent.push(moved);
        }
        continue;
      }
      if (w.kind === 'time') over = { over: Date.parse(w.since) + (w.minutes ?? 0) * 60_000 <= (deps.now?.() ?? new Date()).getTime() };
      else if (deps.publisher) over = await deps.publisher.waitOver(run.id);
      // The person may have moved the run while the host was being asked.
      if (!over.over || deps.runs.get(run.id)?.rev !== run.rev) continue;
      try {
        sent.push(move(run.id, (r, f, at) => waitDone(r, f, { reply: over.reply }, at)));
      } catch (e) {
        console.error('[runner] could not send on a waiting run', run.id, e instanceof Error ? e.message : e);
      }
    }
    return sent;
  }

  // ---- runs the app starts by itself ------------------------------------------------------------------------------------------------

  async function scanIssues(): Promise<Run[]> {
    const config = deps.config();
    if (!config.runner.enabled || !isFlowCycle(config.devCycle.stages) || !deps.issues.ready()) return [];
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
