import { unconfinedOf } from '../../shared/unconfined';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome } from '../../shared/config/paths';
import type { AgentDef, IssueProjectConfig, SquadDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumDraft, type ForumMessage, MAX_MENTIONS, SQUADS_CHANNEL, mentionableIds, parseMentions, runThreadId } from '../../shared/forum';
import { runKey } from '../../shared/browser';
import { ATTACHMENT_KINDS, type AttachmentRef } from '../../shared/attachments';
import { createTranslator, t } from '../../shared/i18n';
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
  memoryEdited,
  newRunId,
  passQuestion,
  producerOf,
  defaultSendBackTarget,
  sendBackTo,
  prRecorded,
  prRetryAnswered,
  recordQa,
  recordEvidence,
  deleteEvidence,
  recordReview,
  recordProcedures,
  recordUsage,
  addReport,
  emptyUsage,
  hasUsage,
  findingLine,
  limitText,
  scenarioLine,
  notesText,
  scenarioBlocks,
  resumeAfterRestart,
  retry as retryMove,
  routeIssue,
  routeSquad,
  returnStage as returnMove,
  reviewReturn,
  stageDone,
  stageFailed,
  stageWaitingOnBudget,
  stageWaitingOnPlugin,
  pluginWaitDone,
  squadErrors,
  squadIssueText,
  startRun,
  startStage as startMove,
  waitDone,
  waitLinked,
  waitSkip,
  COMMAND_DECISIONS,
  type CommandDecision,
  type PendingCommand,
} from '../../shared/runs';
import type { AppEvent } from '../../shared/types';
import type { PluginEvent } from '../../shared/plugins/events';
import { autonomousOf, docsFlowOf, effectiveTeam, membersOf, releaseFlowOf, removeSquad as removeSquadConfig, runKindFlowOf, squadOf, squadView, squadsOf, updateSquad } from '../../shared/config/squads';
import { autonomyOf, choiceOn, flowKeyOf, type EffectiveAutonomy } from '../../shared/config/autonomy';
import { type RunAgentCommands, countCommands, groupCommands } from '../../shared/runCommands';
import { RELEASE_FROM, RELEASE_VERSION } from '../../shared/release';
import { cycleText } from '../../shared/cycles/text';
import { ensureSquadChannels } from '../forum-channels';
import { updateAgent, workingTeam } from '../../shared/config/team';
import { beginCallActivity, type RunActivity, withActivityContext } from '../activity';
import { type AgentCall, secretPath } from '../agents';
import { findClone, git } from '../conflictGit';
import { ensureDependencies } from './dependencies';
import { redact } from '../errorlog-core';
import type { ResolvedRepo } from '../config-resolve';
import type { ForumStore } from '../forum-core';
import { type RunStore } from '../runs-core';
import { beginRun, moveRun } from '../runs-forum';
import type { Notice } from '../scheduler';
import type { ReleaseAction } from '../../shared/types';
import type { VcsComment, VcsIssue } from '../vcs/types';
import { CYCLES_DIR, MEMORY_FILE, cycleFolderOf, issueRecord, readArtifact, readFolder, slugOf, writeIssueRecord, writeMemory } from './cycleFolder';
import { branchStateOf, releaseRecord, releaseRef, releaseTitle } from './release';
import { DOCS_RUN_FOLDER, dayStamp, docsBranch, docsRecord, docsRef, docsTitle, ensureRunIgnore } from './docs';
import { crMarkOf } from '../../shared/i18n/terms';
import { prompt } from '../cyclePrompts';
import { primaryIntegration } from '../../shared/cycles/terms';
import { reasonText, type SandboxService } from '../sandbox';
import type { ScreenHub } from '../screen/hub';
import type { ScreenAsks } from '../browser/asks';
import type { RecordingOutcome } from '../screen/recorder';
import type { ScreenSessions } from '../browser/sessions';
import type { HandoffService } from '../screen/handoff';
import { type EvidenceRecord, type EvidenceView, evidenceViewOf } from '../../shared/evidence';
import { dropEvidence, readEvidence } from '../evidence/store';
import { type ExecutorDeps, type StageClock, type StageEngine, type StageRun, StageError, askTarget, executeStage, keepScreenRecording, limitsOf, openStageSandbox, pickAgent, readConfinement, watchdog } from './executor';
import { type ActivityFront, createSharedMemory, sortedFronts } from './activities';
import { inboxOf } from './inbox';
import { type Identity, WorktreeError, commitAll, commitIdentity, commitMessage, createWorktree, workBase } from './git';
import { type CommandRunner, outcomeOf } from './commands';
import { type BudgetProbeFn, type WaitingProvider, probeStateOf } from './budget';
import { type ChainRequest, chainCall, readChain } from './chain';
import { type RequestAnswer, readRequestAnswer, requestCall } from './request';
import { answerMentions } from '../mentions/answer';
import type { MemoryPort } from '../memory/port';
import { memoryOn } from '../../shared/memory';
import type { ProceduresPort } from '../procedures/port';
import type { ProcedureOffers } from '../procedures/offers';
import { runDocsAsk, stageOfRun } from '../harness/deliver';
import type { MentionPlace } from '../mentions/place';
import { proposeMention } from '../mentions/propose';
import type { IssueMade, Publisher } from './publish';

// The runner: it takes an issue through the agent cycle. A run is started (a branch, a worktree, the cycle folder with the issue in it), and then every
// stage whose agent runs by itself is executed one after the other until the run reaches a gate, a question, a failure or its end; a stage whose agent waits
// for the person waits (to-start, to-accept). Everything goes through the run store and the forum (moveRun), so a restart resumes where the run was.
// Nothing here writes to the code host: the issue is only read, and what the agents do stays in the worktree.

export const RUNNER_ERROR_CODES = ['bad-version', 'no-release-flow', 'no-docs-flow', 'bad-docs-mode', 'nothing-to-undo', 'not-agent-flow', 'bad-ref', 'no-issue-project', 'issue-closed', 'repo-ambiguous', 'no-clone', 'no-identity', 'unknown-agent', 'bad-action', 'branch-exists', 'dest-exists', 'not-worktree', 'no-sandbox', 'no-command', 'no-host', 'worktree-gone', 'memory-busy', 'docs-folder-unsafe'] as const;
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
  /** Open issues of the project carrying `label` that have no assignee; the manual-start list of the runs screen. */
  unassigned(label: string): Promise<VcsIssue[]>;
  /** The code host can be read right now. */
  ready(): boolean;
}

/** A run that another squad's request makes: the squad it goes to, and the run that asked. */
export interface LinkedStart {
  squad: string;
  origin: NonNullable<Parameters<typeof startRun>[0]['origin']>;
}

/**
 * The files a person attached to the message that resumes a stage. A run file never holds them, so the turn that recorded the answer keeps them by the
 * thread and the stage it resumed, until the attempt that reads them starts.
 */
const carriedByStage = new Map<string, AttachmentRef[]>();

const carriedKey = (runId: string, stage: string): string => `${runId}:${stage}`;

/** What a stage's first turn was handed: the files of the answer it resumed, and the key they were kept under. */
function takeCarried(runId: string, stage: string): AttachmentRef[] | undefined {
  const key = carriedKey(runId, stage);
  const refs = carriedByStage.get(key);
  carriedByStage.delete(key);
  return refs;
}

/** The files a person attached, as the runner takes them from a caller: only what holds its own shape, so a hand-made call cannot smuggle anything in. */
function cleanAttachments(list: readonly AttachmentRef[] | undefined): AttachmentRef[] {
  return (list ?? [])
    .filter((a) => !!a && typeof a.id === 'string' && /^[a-f0-9]{8,32}$/.test(a.id) && (ATTACHMENT_KINDS as readonly string[]).includes(a.kind) && a.kind !== 'video' && typeof a.name === 'string')
    .map((a) => ({ id: a.id, name: a.name.slice(0, 200), kind: a.kind, bytes: Number(a.bytes) || 0 }))
    .slice(0, 50);
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
  /** Runs the commands QA is given the results of; the real one by default (tests give a fake). */
  commandRunner?: CommandRunner;
  /** Makes the sandboxes of the agents set to `shell: sandbox`. Without it a run whose team has such an agent is refused. */
  sandbox?: SandboxService;
  /** The live screens of the stages that have a virtual display; without it no stage opens one and no run carries `screen`. */
  screens?: ScreenHub;
  /** The screens of the agents that have one (the app's browser) and the questions they ask the person; without them no stage gets a browser. */
  sessions?: ScreenSessions;
  asks?: ScreenAsks;
  /** The hand-off of an agent's screen to the person (#178); without it no agent is offered the tool. */
  handoff?: HandoffService | null;
  /** Makes one small call to a provider to find out whether its key has budget again. Without it the runs that hit the refusal keep waiting. */
  probeBudget?: BudgetProbeFn;
  /** Replaces `runner.stageIdleMs` and `runner.stageMaxMs` (tests). */
  timeoutMs?: number;
  /** Replaces one limit or the other (tests). */
  limits?: Partial<{ idleMs: number; maxMs: number }>;
  /**
   * Told when an event of the fixed catalog happens (a stage was entered or finished, a gate was decided, a run finished), so the plugins that
   * observe it are called. Optional: without it the runner runs exactly as before. What it hands over is material for the plugins, and a plugin
   * that fails is not the runner's to know.
   */
  pluginEvent?(event: PluginEvent, context: { run: Run }): void | Promise<void>;
  /**
   * A request of a plugin of this run waits for the person (a network or a write it was not allowed): the runner does not start a stage of the run
   * meanwhile, and the run waits with the reason. Optional: without it nothing is held.
   */
  pluginHold?(runId: string): { plugin: string; need: string } | null;
  /** The person goes on without answering the plugin requests that hold the run: they stay in Actions, and no longer hold it. */
  pluginRelease?(runId: string): void;
  /** What the plugins that are on tell the agents, added to every stage's context; absent: nothing. */
  pluginNotes?(): { name: string; note: string }[];
  /** The workspace's learned procedures: stages, the agents they call and the answers in a run's thread get their list and tools from here. Absent: none. */
  procedures?: ProceduresPort;
  /** The shared memory (#215): stages, the agents they call and the answers in a run's thread get their index and tools from here. Absent: none. */
  memoryPort?: MemoryPort;
  /** Where the offers to keep a procedure are held: a stage and an answer in a run's thread raise them after their last turn (#187). Absent: no last turn. */
  offers?: ProcedureOffers;
  /** For a test: the limit of the last turn, in ms. */
  procedureTurnMs?: number;
}

export type GateAction = 'approve' | 'reject' | 'skip';

export interface Runner {
  list(): Run[];
  get(id: string): Run | null;
  /** The evidence a run kept, oldest first: what the run screen lists under the stage. Null when there is no such run. */
  evidence(runId: string): EvidenceView[] | null;
  /** The bytes of one piece of evidence; null when the run or the file is not there. */
  evidenceBytes(runId: string, id: string): { bytes: Uint8Array; record: EvidenceRecord } | null;
  /** The person removes one piece of evidence (never an agent): the file goes and the run's record with it. */
  removeEvidence(runId: string, id: string): boolean;
  /**
   * Keeps the recording of the screen of an agent called in the run's thread as a piece of the run's evidence, as a stage's recording is. `not` when the run is gone or the
   * recording could not be kept (the thread then says why).
   */
  keepCallRecording(runId: string, agent: string, outcome: RecordingOutcome | null): 'kept' | 'not';
  start(ref: string, repoId?: string): Promise<Run>;
  /**
   * Starts the run of a release: its subject is a version, not an issue. The worktree is the run's own (the cycle documents live there); the release steps run in the
   * repository's checkout, through the door of Actions. The tracking issue is made (or adopted) and the branch opened (or asked to be) by the publisher.
   */
  startRelease(version: string, from?: string, repoId?: string): Promise<Run>;
  /**
   * Starts the run that drafts (`create`) or brings up to date (`update`) the repository's root AGENTS.md: it has no issue and writes only that file
   * worktree, and ends in a push and a pull request that wait for the person's "sim" like every other.
   */
  startDocs(repoId: string, mode: 'create' | 'update'): Promise<Run>;
  /**
   * What `startDocs` asks before it changes anything that does not depend on the docs flow: the mode, a run already going for the repository, the repository itself and the
   * identity of the commits. Throws what `startDocs` would; the window calls it before the docs template is applied, so a start that cannot happen leaves the configuration as it was.
   */
  checkDocs(repoId: string, mode: string): Promise<void>;
  startStage(id: string): Run;
  accept(id: string, note?: string): Run;
  returnStage(id: string, note: string): Run;
  gate(id: string, action: GateAction, reason?: string): Run;
  answer(id: string, text: string, attachments?: AttachmentRef[]): Run;
  retry(id: string): Run;
  /** The person chose the base and asked for the pull request again (a `pr-retry` question was open): it is opened audited, and the run resumes on it. */
  retryPr(id: string, base: string): Promise<Run>;
  cancel(id: string): Run;
  /** The person's answer to the command an agent set to `shell: host` waits to run; `commandId` must be the one waiting, so a late click never answers a newer one. */
  command(id: string, commandId: string, decision: CommandDecision, note?: string): Run;
  /** Proposes deleting a comment the runner posted by itself, as an action that waits for a "yes" (and is audited when it runs); the run keeps the record as removed. */
  undoPost(id: string, key: string): Promise<{ proposed: boolean; reason?: 'refused' | 'nothing' | 'no-host' }>;
  /** The person does not wait any longer for the event of a waiting run. A reason is required. */
  skipWait(id: string, reason: string): Run;
  /** A plugin request of the run was answered: `note` goes to its conversation, and a run held by plugin requests goes on when none is left. */
  pluginSettled(id: string, note: { code: string; params: Record<string, string> } | null): void;
  /**
   * The person sends the run back to an earlier work stage of its flow, from a wait, a gate, a stage that waits to start or to be accepted, a failure, a question
   * or the end (which reopens the run). `stageId` empty: the default of `defaultSendBackTarget`. The note is the person's handoff to that stage's agent, with what
   * the review and QA left open; it may be empty when something is open.
   */
  sendBack(id: string, stageId: string, note: string): Run;
  /** The run follows the current flow of the cycle from now on, when its stage still exists there. */
  migrateFlow(id: string): Run;
  /**
   * The person corrected the cycle memory on the run screen. The app writes and commits their version with the workspace's identity; refused while a stage is
   * working in the worktree, so the person never races an agent for the file. Returns the text as it was written (masked), or null when the run has no worktree.
   */
  editMemory(id: string, text: string): Promise<{ text: string; clipped: boolean } | null>;
  /** The record of the activities of the workspace, oldest first: what the runs screen shows and what a call reads, without a model call. */
  activities(): ActivityFront[];
  /** The person corrected one activity's front: masked, capped, marked as theirs and kept for the next projection. Null when that activity is unknown. */
  correctActivity(ref: string, text: string): ActivityFront | null;
  /** The person decides the squad of a run that waits for it (the scope rules could not pick one and the front door does not run by itself); null: go on with no squad. */
  setSquad(id: string, squad: string | null): Run;
  /** Removes a squad from the workspace. Its active runs go on with no squad, but only after the person confirms: without `confirm` nothing changes and the runs are listed. */
  removeSquad(squad: string, confirm: boolean): { removed: boolean; runs: string[] };
  setAutonomous(agentId: string, on: boolean): WorkspaceConfig;
  /** The switch of a whole squad: off holds every member (each agent's own switch applies when it is on). Takes effect at the next stage start or publication. */
  setSquadAutonomous(squad: string, on: boolean): WorkspaceConfig;
  /** A person's post in a run's thread that answers the run's pending question: the answer is recorded and the stage goes on. Null when the post answers nothing. */
  answerPost(thread: string, text: string, attachments?: AttachmentRef[]): ForumMessage | null;
  /** Reacts to a message of the forum: a person's `@agent` in a run's thread has that agent answer, read only. */
  onMessage(message: ForumMessage): void;
  /** Starts runs for the issues that ask for one, up to the configured number at a time. */
  scan(): Promise<Run[]>;
  /** Looks for what each waiting run waits for (a merged pull request, a reply, a label, the time) and sends on the runs whose event happened. */
  tick(): Promise<Run[]>;
  /** A proposal of the runner was carried out in Actions (a comment, a review, the push, the pull request): the run goes on from there. */
  actionDone(action: ReleaseAction, responses: unknown[]): void;
  /** The person's "sim" on a proposal of the runner was refused before anything ran (a release step whose earlier step is not done): the thread says why. */
  actionRefused(action: ReleaseAction, reason: string): void;
  /** Posts the reviews that waited for their pull request, for the runs whose pull request exists by now. Resolves when those are posted, not when the stages that are working end. */
  flush(): Promise<void>;
  /** What the scheduler's job does every few minutes: scan, tick and flush, one sweep at a time (a call while one is going gets that sweep's promise). It never waits for a stage to end. */
  sweep(): Promise<void>;
  /** After a restart: a run that was in the middle of a stage starts that stage over, and every run that can go on does. */
  resume(): void;
  /** Resolves when nothing is running: stages, mentions and what they started. */
  idle(): Promise<void>;
}

const MAX_STEPS = 200;
/** The most the person may paste as the memory from the run screen: the same ceiling the screen reads back, so nothing is written that could not be shown. */
const MEMORY_EDIT_MAX = 200_000;
/** A release run that ended is watched this long for the stable version to be published (and its tracking issue closed). */
const RELEASE_WATCH_DAYS = 30;
const iso = (d: Date): string => d.toISOString();

export function createRunner(deps: RunnerDeps): Runner {
  const now = (): string => iso(deps.now?.() ?? new Date());
  const flowNow = (): FlowStage[] => flowOf(squadView(deps.config(), null));
  // A run follows the flow it started with (a copy it carries), with the agents as they are now.
  const flowFor = (run: Run): FlowStage[] => flowOfRun(run, deps.config());
  // The record of the activities of the workspace, written where the app keeps its own files (never in a worktree): every move of a run keeps its front.
  const activities = createSharedMemory(deps.env().dataDir, () => deps.now?.() ?? new Date());
  const d = { runs: deps.runs, forum: deps.forum, activities };
  /**
   * Records a piece of evidence a stage kept and publishes it, at once, in the run's conversation, as a message of the agent that carries the file: the person sees
   * it live, and the run keeps the record (`Run.evidence`) so the stage and the scenarios can list and cite it. Returns the message, or null when the run is gone.
   */
  function keepEvidence(runId: string, record: EvidenceRecord): ForumMessage | null {
    const nowIso = now();
    let done: Run;
    try {
      done = moveRun(d, runId, (r) => recordEvidence(r, record, nowIso));
    } catch (e) {
      console.error('[runner] could not record a piece of evidence', e instanceof Error ? e.message : e);
      return null;
    }
    void done;
    const media = evidenceViewOf(record).media;
    // The app's own recording of the screen is the app's: its post is authored by the app, internal (the stage's tracker comment is linked to the latest public
    // message of the stage, which a recording must never become) and carries the video for the player.
    const own = !!record.recording;
    const messages = deps.forum.append(runThreadId(runId), {
      kind: 'post',
      author: own ? { type: 'app' } : { type: 'agent', id: record.by },
      code: own ? 'runner.evidence.recorded' : 'runner.evidence.kept',
      params: { title: record.title, kind: record.kind, description: record.description, id: record.id, ...(own ? { agent: record.by } : {}) },
      evidence: [{ id: record.id, name: record.name, media, bytes: record.bytes }],
      stage: record.stage,
      public: !own,
    });
    return messages[0] ?? null;
  }

  /** Updates a piece of evidence already recorded (the copy that went into the cycle folder): the run's record changes; nothing is published again. */
  function updateEvidence(runId: string, record: EvidenceRecord): void {
    try {
      moveRun(d, runId, (r) => recordEvidence(r, record, now()));
    } catch (e) {
      console.error('[runner] could not update a piece of evidence', e instanceof Error ? e.message : e);
    }
  }

  const exec: ExecutorDeps = { pluginNotes: deps.pluginNotes, engine: deps.engine, config: deps.config, forum: deps.forum, identity: deps.identity, timeoutMs: deps.timeoutMs, limits: deps.limits, commandRunner: deps.commandRunner, sandbox: deps.sandbox, screens: deps.screens, sessions: deps.sessions, asks: deps.asks, handoff: deps.handoff, askCommand: (ask, signal) => askCommand(ask, signal), release: deps.publisher ? (runId, input, who) => (deps.publisher as Publisher).releaseStep(runId, input, who) : undefined, dataDir: () => deps.env().dataDir, keepEvidence: keepEvidence, updateEvidence: updateEvidence, sharedMemory: (run, narrow) => sharedTextOf(run.issue.ref, [], [], narrow), procedures: deps.procedures, memoryPort: deps.memoryPort, offers: deps.offers, procedureTurnMs: deps.procedureTurnMs, procedureUses: (runId, stage, uses) => void moveRun(d, runId, (r) => recordProcedures(r, stage, uses, now())) };

  /** The record of the activities as a call reads it: the front named whole, the others in short. Never a model call, never the file. */
  function sharedTextOf(ref: string, agents: readonly string[] = [], refs: readonly string[] = [], narrow = false): string {
    // A call that has the shared memory gets only what it is about or named here; the other activities are lines of its index (divergences 1, 2 and 7).
    return activities.render(deps.runs, { ref, refs: [...refs], agents: [...agents], ...(narrow ? { onlyNamed: true } : {}) }, deps.config().language);
  }

  /** What a message of a run's thread names: the agents called on, and the activity references it writes. */
  const callsOfMention = (message: ForumMessage): string[] => parseMentions(message.text, deps.config().agents.team.map((a) => a.id));

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
  // The `@` calls that were accepted and not yet finished, and how many of them each run has going: a second call of a run is opened as waiting.
  const calls = new Map<string, { activity: RunActivity; queued: boolean }>();
  const liveCalls = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();
  const chainAborts = new Map<string, AbortController>();
  // The command each run's working stage waits for the person to allow (`shell: host`): one at a time, since a stage runs one command at a time. Never saved: it
  // lives as long as the stage that asked, and a stage that ends (or the app that closes) takes it along as a refusal.
  const commands = new Map<string, { pending: PendingCommand; answer: (a: { decision: CommandDecision; note?: string }) => void }>();
  const withCommand = (run: Run | null): Run | null => {
    const c = run ? commands.get(run.id) : undefined;
    return run && c ? { ...run, command: c.pending } : run;
  };
  // The live screen of the working stage's display, handed out like the command: never written to the run's file.
  const withScreen = (run: Run | null): Run | null => {
    const live = run ? deps.screens?.state(runKey(run.id)) : null;
    return run && live ? { ...run, screen: live } : run;
  };

  // A stage and an agent named in the thread may both want a command at once: the person answers one at a time, in the order they asked.
  const asking = new Map<string, Promise<unknown>>();
  function askCommand(ask: { run: string; stage: string; agent: string; command: string }, signal: AbortSignal): Promise<{ decision: CommandDecision; note?: string }> {
    const next = (asking.get(ask.run) ?? Promise.resolve()).then(() => (signal.aborted ? { decision: 'deny' as const } : askNow(ask, signal)));
    const held = next.catch(() => undefined);
    asking.set(ask.run, held);
    void held.then(() => {
      if (asking.get(ask.run) === held) asking.delete(ask.run);
    });
    return next;
  }

  function askNow(ask: { run: string; stage: string; agent: string; command: string }, signal: AbortSignal): Promise<{ decision: CommandDecision; note?: string }> {
    return new Promise((resolve) => {
      const pending: PendingCommand = { id: deps.newId?.() ?? randomUUID(), stage: ask.stage, agent: ask.agent, command: ask.command, since: now() };
      const finish = (a: { decision: CommandDecision; note?: string }): void => {
        if (commands.get(ask.run)?.pending.id !== pending.id) return;
        commands.delete(ask.run);
        signal.removeEventListener('abort', stopped);
        resolve(a);
      };
      const stopped = (): void => finish({ decision: 'deny' });
      commands.set(ask.run, { pending, answer: finish });
      signal.addEventListener('abort', stopped, { once: true });
      // The thread is what the screens follow: this message brings the question to the run's screen and to the list of what waits for the person.
      deps.forum.append(runThreadId(ask.run), { kind: 'system', author: { type: 'app' }, code: 'runner.command.ask', params: { agent: ask.agent, command: redact(ask.command.replace(/\s+/g, ' ')).slice(0, 300) }, stage: ask.stage });
      const run = deps.runs.get(ask.run);
      if (run && deps.notify && deps.config().notifications) {
        const params = { ref: run.issue.ref, title: run.issue.title, agent: ask.agent };
        deps.notify({ title: t('main.runner.notice.command.title', params), body: t('main.runner.notice.command.body', params), onClick: { type: 'open', screen: { name: 'run', id: run.id } } });
      }
    });
  }
  const refused = new Set<string>();
  const starting = new Set<string>();
  let scanning: Promise<Run[]> | null = null;
  let ticking: Promise<Run[]> | null = null;
  let sweeping: Promise<void> | null = null;
  // The providers whose key ran out of budget: while one is here, nothing new starts on it, and the sweep probes it (one call, not one per run).
  const budget = new Map<string, WaitingProvider>();

  const need = (id: string): Run => {
    const run = deps.runs.get(id);
    if (!run) throw new RunError('unknown-run', { id });
    return run;
  };

  // An event of the fixed catalog happened: the plugins that observe it are called through the same door the app already uses for everything else.
  // A plugin that fails, that is off or whose declaration was refused is the plugin service's to leave out, and a call that throws is said in the log
  // and the run goes on. What reaches back into the run is only a request the person has to answer (pluginHold).
  async function pluginDone(event: PluginEvent, run: Run): Promise<void> {
    if (!deps.pluginEvent) return;
    try {
      await deps.pluginEvent(event, { run });
    } catch (e) {
      console.error('[runner] could not tell the plugins', run.id, e instanceof Error ? e.message : e);
    }
  }

  // ---- telling the person -----------------------------------------------------------------------------------------------------------

  /** Whether this move is where the run ended: done, cancelled or failed, and it was not there before (so the closing list is posted once). */
  const reachedEnd = (prior: Run | null, run: Run): boolean => isTerminal(run) || (run.status === 'failed' && prior?.status !== 'failed');

  /**
   * The one message the run's thread carries when it ends: the commands each agent ran, by agent and by stage, built from the `runner.exec` and `runner.exec.host`
   * messages the run already wrote. Nothing new is recorded anywhere else by it, and nothing of it goes to the code host.
   */
  function postRunCommands(id: string): void {
    try {
      const thread = runThreadId(id);
      const messages = deps.forum.read(thread, 0, 5000)?.messages ?? [];
      if (messages.some((m) => m.code === 'runner.commands.list')) return;
      const groups: RunAgentCommands[] = groupCommands(messages);
      const total = countCommands(groups);
      if (!total) return;
      const runs = deps.runs.get(id);
      if (!runs) return;
      const lang = deps.config().language;
      const tr = createTranslator(lang);
      const text = groups
        .map((g) => [tr('main.runner.commands.agent', { agent: g.agent, count: g.stages.reduce((k, s) => k + s.commands.length, 0) }), ...g.stages.flatMap((s) => [tr('main.runner.commands.stage', { stage: cycleText(s.stage, lang) }), ...s.commands.map((c) => `· ${tr('main.runner.commands.line', { n: c.n, command: c.command, where: tr(`main.runner.commands.where.${c.via}`), result: c.result, ms: Math.round(c.ms / 100) / 10 })}`)])].join('\n'))
        .join('\n\n');
      deps.forum.append(thread, { kind: 'system', author: { type: 'app' }, code: 'runner.commands.list', params: { count: total, text }, stage: runs.stage });
    } catch (e) {
      console.error('[runner] could not post the commands of the run', id, e instanceof Error ? e.message : e);
    }
  }

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
    // A run entered a stage: the plugins that observe `stage-entered` are called. A run that ends or is cancelled is said once, on the way in.
    if (!prior || prior.stage !== run.stage) void pluginDone('stage-entered', run);
    if (isTerminal(run) && (!prior || !isTerminal(prior))) void pluginDone('run-finished', run);
    // The run reached its end (done, cancelled or failed): the app posts the list of the commands each agent ran, once, as the run's own record.
    if (reachedEnd(prior, run)) postRunCommands(run.id);
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
    const params = { ref: run.issue.ref, title: run.issue.title, stage: cycleText(flowFor(run).find((s) => s.id === run.stage)?.label ?? run.stage, deps.config().language) };
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
    // A provider whose key ran out of budget holds every run that would keep working on it: nothing new starts until a call goes through again.
    const paused = deps.runs.get(id)?.status === 'waiting' && deps.runs.get(id)?.wait?.kind === 'budget';
    if (paused || budget.size) return;
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
      // A plugin of the run asked the person for something: the stage does not start until every request is answered (pluginSettled lets it go).
      const hold = deps.pluginHold?.(id) ?? null;
      if (hold) {
        tell(run, moveRun(d, id, (r) => stageWaitingOnPlugin(r, hold, now())));
        return;
      }
      await step(run);
      // The step moved the run. A run sitting at a gate with the autonomy block's "gates" choice on is approved by the app itself and goes on; the reason says where
      // the decision came from. `pump` already deferred the run while this drive ran (`inflight`), so the gate is looked at here, once, before the loop starts it again.
      if (autoGate(id)) continue;
      // A step that moved nothing (a stage the person has to start, a failure, a question) leaves the run where it is: there is nothing more to drive.
      if (deps.runs.get(id)?.rev === run.rev) return;
    }
  }

  /** The reason recorded on a gate the app approved by itself: in the app's words, saying what decided it and where that decision came from. */
  function autonomyReason(a: EffectiveAutonomy): string {
    const origin = a.from === 'flow' ? t('main.runner.gate.autonomy.flow', { flow: a.flow === '' ? t('main.runner.gate.autonomy.main') : (a.flow ?? '') }) : t('main.runner.gate.autonomy.workspace');
    return t('main.runner.gate.autonomy', { origin });
  }

  /** Approves a gate the run is sitting on, when the autonomy block decides gates by themselves. True when it approved one. */
  function autoGate(id: string): boolean {
    const run = deps.runs.get(id);
    if (!run || run.status !== 'gate') return false;
    const a = autonomyOf(deps.config(), flowKeyOf(run.squad));
    if (!(a.cycle && a.gates)) return false;
    try {
      gateBy(id, 'approve', autonomyReason(a), 'app');
      return true;
    } catch (e) {
      console.error('[runner] could not approve a gate by itself', id, e instanceof Error ? e.message : e);
      return false;
    }
  }

  async function step(run: Run): Promise<void> {
    const abort = new AbortController();
    aborts.set(run.id, abort);
    let result: StageRun | null = null;
    let failure: unknown = null;
    let used = emptyUsage();
    try {
      result = await executeStage(exec, run, flowFor(run), abort, (u) => void (used = addReport(used, u)), takeCarried(run.id, run.stage));
    } catch (e) {
      failure = e;
    } finally {
      aborts.delete(run.id);
    }
    // What the model calls used is kept whatever became of the stage: a failed, stopped or cancelled attempt cost it all the same.
    if (hasUsage(used)) {
      try {
        moveRun(d, run.id, (r) => recordUsage(r, run.stage, used, now()));
      } catch (e) {
        console.error('[runner] could not record usage', run.id, e instanceof Error ? e.message : e);
      }
    }
    // The person may have cancelled while the agent worked: what it did is kept in the worktree, and the run stays as the person left it.
    const current = deps.runs.get(run.id);
    if (!current || current.status !== 'working' || current.stage !== run.stage) return;
    try {
      if (failure) fail(current, failure);
      else if (result) await settle(current, result);
    } catch (e) {
      if (e instanceof RunError && (e.code === 'wrong-state' || e.code === 'not-active')) return;
      fail(deps.runs.get(run.id) ?? current, e);
    }
  }

  function fail(run: Run, e: unknown): void {
    if (deps.runs.get(run.id)?.status !== 'working') return;
    // A refusal by budget is a wait, not a failure: the run keeps its place, no retry is offered, and the sweep probes the provider instead of the runs.
    if (e instanceof StageError && e.code === 'budget') {
      const provider = String(e.params.provider ?? '');
      const reason = e.message;
      budget.set(provider, { engine: String(e.params.engine ?? ''), reason, since: now() });
      tell(run, moveRun(d, run.id, (r) => stageWaitingOnBudget(r, { provider, engine: String(e.params.engine ?? ''), detail: reason }, now())));
      return;
    }
    const detail = redact(e instanceof Error ? e.message : String(e)).slice(0, 500);
    if (!(e instanceof StageError)) console.error('[runner]', run.id, run.stage, detail);
    tell(run, moveRun(d, run.id, (r) => stageFailed(r, detail, now())));
  }

  // What an attempt means for the run: a question pauses it, findings send it back, anything else is the stage done.
  // What an attempt means for the run: a question pauses it, findings send it back, anything else is the stage done. Asynchronous because the plugins
  // that observe the end of a stage run before the run moves on; everything else in it is the same work it was.
  async function settle(run: Run, r: StageRun): Promise<void> {
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
    // The stage concluded (it did not pause with a question): the plugins that observe `stage-finished` are called before the run moves on, so one
    // that adds a document finds the cycle folder as the stage left it. This one is waited for: a plugin runs inside a sandbox, and a stage of a run
    // must not have two of them at once over the same worktree.
    await pluginDone('stage-finished', run);
    if (run.routing && flow[0]?.id === stage) {
      routeFrontDoor(run, { agent, out, written: r.written, autonomous });
      ended();
      return;
    }
    // A pull request linked from outside (the person may have opened it by hand) is resolved and recorded now, so the guard that holds the pr-merged wait
    // sees it when the flow enters the stage that waits: nothing is forced, without one the wait refuses and the run fails closed.
    const ensureNextPr = async (): Promise<void> => {
      if (!deps.publisher) return;
      const from = flow.find((s) => s.id === stage);
      const next = from?.next ? flow.find((s) => s.id === from.next) ?? null : null;
      if (!next || next.type !== 'wait' || next.waitsFor?.kind !== 'pr-merged') return;
      try {
        await deps.publisher.ensurePr(run.id);
      } catch (e) {
        console.error('[runner] could not look for a linked pull request', run.id, e instanceof Error ? e.message : e);
      }
    };
    if (r.kind === 'review') {
      const recorded = moveRun(d, run.id, (x) => recordReview(x, { stage, by, verdict: out.verdict ?? 'approved', summary: out.summary, findings: out.findings, head: r.head }, now()));
      const text = findingsText(out.summary, out.findings);
      if (out.verdict === 'changes') {
        apply((x) => reviewReturn(x, flow, { by, findings: text, handoff: text, limit: limitOf(recorded, flow, flowStage) }, now()));
        ended(recorded.reviews.length);
        return;
      }
      await ensureNextPr();
      apply((x) => stageDone(x, flow, { summary: text, handoff: out.handoff, artifacts: r.written }, now()));
      ended(recorded.reviews.length);
      return;
    }
    if (r.kind === 'qa') {
      moveRun(d, run.id, (x) => recordQa(x, { stage, by, summary: out.summary, scenarios: out.scenarios, head: r.head, ...(r.commands ? { commands: r.commands.map((c) => ({ command: c.command, exitCode: c.exitCode, timedOut: c.timedOut, ...(c.n !== undefined ? { n: c.n } : {}), ...(c.by ? { by: c.by } : {}), ...(outcomeOf(c) === 'not-run' && !c.timedOut ? { notRun: true } : {}) })) } : {}) }, now()));
      // Only a failure that blocks sends the work back; what QA noted without blocking is reported with its result.
      const failed = out.scenarios.some(scenarioBlocks);
      const back = flow.find((s) => s.id === flowStage.returnsTo);
      if (failed && back && back.type === 'work') {
        const text = failuresText(out.summary, out.scenarios);
        post(text);
        apply((x) => handBack(x, flow, { by, toStage: back.id, text, countRound: true, limit: limitOf(deps.runs.get(run.id) ?? run, flow, flowStage) }, now()));
        ended();
        return;
      }
    }
    const notes = r.kind === 'qa' ? notesText(out.scenarios) : '';
    await ensureNextPr();
    apply((x) => stageDone(x, flow, { summary: [out.summary, notes].filter(Boolean).join('\n\n'), handoff: out.handoff, artifacts: r.written }, now()));
    ended();
  }

  // What the person is asked when a stage has sent the work back as many times as it may: the earlier round's asks, what the producer did since and what the
  // latest round still finds, from the records of the rounds.
  function limitOf(run: Run, flow: FlowStage[], stage: FlowStage): string {
    const config = deps.config();
    const producer = flow.find((s) => s.id === stage.returnsTo);
    const mine = stage.kind === 'qa' ? run.qa.filter((q) => q.stage === stage.id) : run.reviews.filter((r) => r.stage === stage.id);
    const items = (rec: (typeof mine)[number] | undefined): string[] => (!rec ? [] : 'findings' in rec ? rec.findings.filter((f) => f.severity === 'blocking').map(findingLine) : rec.scenarios.filter(scenarioBlocks).map((s) => scenarioLine(s)));
    const posts = deps.forum.read(runThreadId(run.id), 0, 2000)?.messages ?? [];
    const did = [...posts].reverse().find((m) => m.kind === 'post' && m.author.type === 'agent' && !!producer && m.stage === producer.id);
    return limitText({ stage: cycleText(stage.label, config.language), rounds: (run.returns[stage.id] ?? 0) + 1, asked: items(mine.at(-2)), did: did?.text ?? '', open: items(mine.at(-1)) });
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
    // An agent set to run commands in a sandbox on a computer that cannot make one: said now, before a worktree exists, not when its stage is reached.
    const sandboxed = workingTeam(config.agents.team).filter((a) => a.shell === 'sandbox' && a.stages.length);
    if (sandboxed.length) {
      const st = deps.sandbox ? await deps.sandbox.status() : null;
      if (!st?.available) throw new RunnerError('no-sandbox', { agent: sandboxed.map((a) => a.id).join(', '), reason: st ? reasonText(st) : t('main.sandbox.reason.platform') });
    }
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
    const identity = await commitIdentity(config.runner.identity, repo.path, deps.identity);
    if (!identity) throw new RunnerError('no-identity', { repo: repo.id });

    const slug = slugOf(issue.title);
    const branch = `cycle/${iid}-${slug}`;
    const dest = join(config.runner.worktreesDir ? expandHome(config.runner.worktreesDir, env.home) : join(env.dataDir, 'worktrees'), repo.id, `${iid}-${slug}`);
    const folder = cycleFolderOf(iid, issue.title);

    // Everything the start needs is known: the activity is recorded before the worktree and the run exist, so a start interrupted here leaves a trace of it.
    activities.ensure({ ref, iid, title: issue.title, url: issue.webUrl || null }, now());
    // The branch and the folder are the issue's, so a run of it that ended without cleaning up is taken over: refusing it would block the issue forever.
    const made = await createWorktree({ clone: repo.path, dest, branch, base: await workBase(repo.path), takeOverLeftover: true }).catch((e) => {
      throw e instanceof WorktreeError ? new RunnerError(e.code, { detail: e.detail }) : e;
    });
    let run: Run;
    try {
      writeIssueRecord(dest, folder, issueRecord(issue, comments, ref));
      // i18n-ignore-next-line: the subject of a commit in the repository's history: English, like the rest of its commits
      await commitAll(dest, commitMessage(config.runner.commitMessage, 'add the issue record', iid), identity);
      const started = startRun(
        { id: deps.newId?.() ?? newRunId(Date.now(), Math.random().toString(36).slice(2, 6).padEnd(4, '0')), issue: { ref, iid, title: issue.title, url: issue.webUrl || null }, repo: repo.id, branch, worktree: dest, cycleFolder: folder, cycleId: config.devCycle.templateId, base: made.baseSha, baseBranch: made.base, squad, origin: force?.origin ?? null, routing: routed?.kind === 'ambiguous' ? { candidates: routed.candidates, why: routed.why } : null },
        startFlow,
        now(),
      );
      run = beginRun(d, started);
    } catch (e) {
      await discard(repo.path, dest, branch);
      throw e;
    }
    tell(null, run);
    await ensureDependencies(exec, run, null, repo.path);
    // The label of the squad goes onto an issue the squad's own request created already: it was born with it.
    if (squad && !force) labelSquad(run, squad.id);
    pump(run.id);
    return run;
  }

  // ---- the run of a release ---------------------------------------------------------------------------------------------------------

  async function startRelease(version: string, from: string | undefined, repoId?: string): Promise<Run> {
    if (!RELEASE_VERSION.test(version)) throw new RunnerError('bad-version', { version: String(version).slice(0, 40) });
    if (from !== undefined && from !== '' && !RELEASE_FROM.test(from)) throw new RunnerError('bad-version', { version: String(from).slice(0, 40) });
    const ref = releaseRef(version);
    if (starting.has(ref)) throw new RunError('duplicate', { issue: ref });
    starting.add(ref);
    try {
      return await createRelease(version, from || null, repoId);
    } finally {
      starting.delete(ref);
    }
  }

  async function createRelease(version: string, from: string | null, repoId?: string): Promise<Run> {
    const config = deps.config();
    const ref = releaseRef(version);
    if (deps.runs.activeFor(ref)) throw new RunError('duplicate', { issue: ref });
    const stages = releaseFlowOf(config);
    if (!stages?.length) throw new RunnerError('no-release-flow');
    const flow = flowOf({ agents: { team: effectiveTeam(config) }, devCycle: { stages } }, stages);
    assertStartable(flow);
    const broken = flowErrors({ stages, team: config.agents.team }, { asFlow: true });
    if (broken.length) throw new RunError('invalid-flow', { detail: broken.slice(0, 3).map((i) => flowIssueText(i)).join(' ') });
    const env = deps.env();
    if (!env.issues.project) throw new RunnerError('no-issue-project');
    const repo = await repoFor(env.issues.project, repoId);
    const identity = await commitIdentity(config.runner.identity, repo.path, deps.identity);
    if (!identity) throw new RunnerError('no-identity', { repo: repo.id });

    const branch = `cycle/release-${version}`;
    const dest = join(config.runner.worktreesDir ? expandHome(config.runner.worktreesDir, env.home) : join(env.dataDir, 'worktrees'), repo.id, `release-${version}`);
    const folder = `${CYCLES_DIR}/release-${version}`;
    // What the clone says of the release branch decides whether the run asks for it to be opened.
    const has = async (r: string): Promise<boolean> => (await git(repo.path, ['show-ref', '--verify', '--quiet', r], { fail: false })).code === 0;
    const state = branchStateOf(await has(`refs/heads/release/${version}`), await has(`refs/remotes/origin/release/${version}`));
    const read = deps.publisher
      ? await deps.publisher.releaseBrief({ version, repo: repo.id, branch: state, from })
      : { brief: { version, from, branch: state, activities: [], milestone: [], read: false }, text: releaseRecord({ version, from, branch: state, activities: [], milestone: [], read: false }, config.language, () => null, crMarkOf(primaryIntegration(config)?.kind ?? null)) };

    // The branch and the folder are the version's, so a release that ended without cleaning up is taken over: refusing it would block that version forever.
    const made = await createWorktree({ clone: repo.path, dest, branch, takeOverLeftover: true }).catch((e) => {
      throw e instanceof WorktreeError ? new RunnerError(e.code, { detail: e.detail }) : e;
    });
    let run: Run;
    try {
      writeIssueRecord(dest, folder, read.text);
      // i18n-ignore-next-line: the subject of a commit in the repository's history: English, like the rest of its commits
      await commitAll(dest, commitMessage(config.runner.commitMessage, 'add the release record', 0), identity);
      const started = startRun(
        {
          id: deps.newId?.() ?? newRunId(Date.now(), Math.random().toString(36).slice(2, 6).padEnd(4, '0')),
          issue: { ref, iid: 0, title: releaseTitle(version), url: null },
          repo: repo.id,
          branch,
          worktree: dest,
          cycleFolder: folder,
          cycleId: 'release-flow',
          base: made.baseSha,
          subject: { kind: 'release', version, from, tracking: null, activities: read.brief.activities },
        },
        flow,
        now(),
      );
      run = beginRun(d, started);
    } catch (e) {
      await discard(repo.path, dest, branch);
      throw e;
    }
    tell(null, run);
    // The tracking issue and the branch come before anything the stages say: the publisher does them in order, one thing at a time for the run.
    publish(run.id, (p) => p.releaseStarted(run.id, { branchExists: state !== 'none' }));
    pump(run.id);
    return run;
  }

  // ---- the run of the documentation of a repository ---------------------------------------------------------------------------------

  async function startDocs(repoId: string, mode: 'create' | 'update'): Promise<Run> {
    if (mode !== 'create' && mode !== 'update') throw new RunnerError('bad-docs-mode', { mode: String(mode).slice(0, 20) });
    const ref = docsRef(String(repoId));
    if (starting.has(ref)) throw new RunError('duplicate', { issue: ref });
    starting.add(ref);
    try {
      return await createDocs(String(repoId), mode);
    } finally {
      starting.delete(ref);
    }
  }

  // The questions of a documentation start that the docs flow does not enter into: the same ones, in the same order, whether the flow is there or not.
  async function checkDocs(repoId: string, mode: string): Promise<void> {
    if (starting.has(docsRef(String(repoId)))) throw new RunError('duplicate', { issue: docsRef(String(repoId)) });
    await docsPrecheck(String(repoId), mode);
  }

  async function docsPrecheck(repoId: string, mode: string): Promise<{ repo: { id: string; path: string }; identity: Identity }> {
    if (mode !== 'create' && mode !== 'update') throw new RunnerError('bad-docs-mode', { mode: String(mode).slice(0, 20) });
    const ref = docsRef(repoId);
    if (deps.runs.activeFor(ref)) throw new RunError('duplicate', { issue: ref });
    const env = deps.env();
    // The repository is named, so no issue project is asked for; one the workspace does not have has no checkout to make a worktree from.
    if (!env.repos.some((r) => r.id === repoId)) throw new RunnerError('no-clone', { repo: repoId.slice(0, 48) });
    const repo = await repoFor(repoId, repoId);
    const identity = await commitIdentity(deps.config().runner.identity, repo.path, deps.identity);
    if (!identity) throw new RunnerError('no-identity', { repo: repo.id });
    return { repo, identity };
  }

  async function createDocs(repoId: string, mode: 'create' | 'update'): Promise<Run> {
    const config = deps.config();
    const ref = docsRef(repoId);
    if (deps.runs.activeFor(ref)) throw new RunError('duplicate', { issue: ref });
    const stages = docsFlowOf(config);
    if (!stages?.length) throw new RunnerError('no-docs-flow');
    const flow = flowOf({ agents: { team: effectiveTeam(config) }, devCycle: { stages } }, stages);
    assertStartable(flow);
    const broken = flowErrors({ stages, team: config.agents.team }, { asFlow: true });
    if (broken.length) throw new RunError('invalid-flow', { detail: broken.slice(0, 3).map((i) => flowIssueText(i)).join(' ') });
    const { repo, identity } = await docsPrecheck(repoId, mode);
    const env = deps.env();

    const today = deps.now?.() ?? new Date();
    const day = dayStamp(today);
    const branch = docsBranch(repo.id, today);
    const dest = join(config.runner.worktreesDir ? expandHome(config.runner.worktreesDir, env.home) : join(env.dataDir, 'worktrees'), repo.id, `docs-${day}`);
    const made = await createWorktree({ clone: repo.path, dest, branch, base: await workBase(repo.path) }).catch((e) => {
      throw e instanceof WorktreeError ? new RunnerError(e.code, { detail: e.detail }) : e;
    });
    let run: Run;
    try {
      // AGENTS.md is read before the run changes it. The run's private state stays under the ignored `.coxia/.run` folder.
      const record = await docsRecord(dest, { ref, title: docsTitle(repo.id), mode });
      // A non-directory `.coxia` path or a non-regular AGENTS.md could redirect writes outside the worktree.
      if (!(await ensureRunIgnore(dest))) throw new RunnerError('docs-folder-unsafe');
      try {
        writeIssueRecord(dest, DOCS_RUN_FOLDER, record);
      } catch {
        throw new RunnerError('docs-folder-unsafe');
      }
      // i18n-ignore-next-line: the subject of a commit in the repository's history: English, like the rest of its commits
      await commitAll(dest, commitMessage(config.runner.commitMessage, 'ignore the folder of the documentation run', 0), identity);
      const started = startRun(
        {
          id: deps.newId?.() ?? newRunId(Date.now(), Math.random().toString(36).slice(2, 6).padEnd(4, '0')),
          issue: { ref, iid: 0, title: docsTitle(repo.id), url: null },
          repo: repo.id,
          branch,
          worktree: dest,
          cycleFolder: DOCS_RUN_FOLDER,
          cycleId: 'docs-flow',
          base: made.baseSha,
          baseBranch: made.base,
          docs: { mode },
        },
        flow,
        now(),
      );
      run = beginRun(d, started);
    } catch (e) {
      await discard(repo.path, dest, branch);
      throw e;
    }
    tell(null, run);
    // No `ensureDependencies`: the draft reads and writes text and runs nothing of the repository.
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

  /** Decides a gate of a run. `by` says who decided: the person, or the app under the autonomy block (an automatic approval, recorded as such). */
  function gateBy(id: string, action: GateAction, reason: string, by: 'person' | 'app'): Run {
    const before = need(id);
    const flow = flowFor(before);
    const gateStage = flow.find((s) => s.id === before.stage);
    // Whether the decision goes to the tracker by itself follows the agent whose work it judged, as that agent's stage stood when the decision was taken.
    const judged = gateStage ? (flow.find((s) => s.id === gateStage.returnsTo) ?? null) : null;
    const autonomous = judged ? (before.stages.find((s) => s.stage === judged.id)?.autonomous ?? false) : false;
    const decided = (run: Run): Run => {
      if (gateStage?.type === 'gate') publish(id, (p) => p.gateDecided(id, { stage: gateStage, action, reason, autonomous }));
      // A gate was decided: the plugins that observe `gate-decided` are called, whatever the decision was.
      if (gateStage?.type === 'gate') void pluginDone('gate-decided', run);
      return run;
    };
    // Accepting the plan freezes the heads of the pull requests it was written for: inside the transition of the gate itself (`gateApprove`, `gateSkip`).
    if (action === 'approve') return decided(move(id, (r, f, at) => gateApprove(r, f, at, reason, by)));
    if (action === 'reject') return decided(move(id, (r, f, at) => gateReject(r, f, reason, at)));
    if (action === 'skip') return decided(move(id, (r, f, at) => gateSkip(r, f, reason, at)));
    throw new RunnerError('bad-action', { action: String(action).slice(0, 20) });
  }

  const api: Runner = {
    list: () => deps.runs.list().map((r) => withScreen(withCommand(r)) as Run),
    get: (id) => withScreen(withCommand(deps.runs.get(id))),
    evidence: (runId) => {
      const run = deps.runs.get(runId);
      if (!run) return null;
      return Object.values(run.evidence ?? {})
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
        .map(evidenceViewOf);
    },
    evidenceBytes: (runId, id) => {
      const run = deps.runs.get(runId);
      const record = run?.evidence?.[id];
      if (!run || !record) return null;
      const bytes = readEvidence(deps.env().dataDir, run.id, record);
      return bytes ? { bytes, record } : null;
    },
    keepCallRecording: (runId, agent, outcome) => {
      const run = deps.runs.get(runId);
      return run ? keepScreenRecording(exec, run, { id: run.stage ?? '' }, { id: agent }, outcome) : 'not';
    },
    removeEvidence: (runId, id) => {
      const run = deps.runs.get(runId);
      const record = run?.evidence?.[id];
      if (!run || !record) return false;
      dropEvidence(deps.env().dataDir, run.id, record);
      moveRun(d, run.id, (r) => deleteEvidence(r, id, now()));
      return true;
    },
    start,
    startRelease,
    startDocs,
    checkDocs,
    startStage: (id) => move(id, (r, f, at) => startMove(r, f, at)),
    accept: (id, note = '') => move(id, (r, f, at) => acceptStage(r, f, at, note)),
    returnStage: (id, note) => move(id, (r, f, at) => returnMove(r, f, note, at)),
    gate(id, action, reason = '') {
      return gateBy(id, action, reason, 'person');
    },
    retry: (id) => move(id, (r, f, at) => retryMove(r, f, at)),
    async retryPr(id, base) {
      const before = need(id);
      if (before.status !== 'question' || before.question?.kind !== 'pr-retry') throw new RunError('wrong-state', { status: before.status });
      const branch = String(base ?? '').trim();
      if (!branch) throw new RunError('empty-reason');
      if (!deps.publisher) throw new RunnerError('no-host');
      // The write goes through the publishing queue like every other of the run, and the run is pumped on only after it came back: nothing of the resumed
      // flow then asks for a pull request while it is not on the host yet, and one or the other is never out of order.
      publish(id, (p) => p.retryPr(id, branch));
      const queued = publishing.get(id);
      if (queued) await queued;
      pump(id);
      return need(id);
    },
    cancel(id) {
      const run = move(id, (r, _f, at) => cancelMove(r, 'person', at));
      aborts.get(id)?.abort();
      chainAborts.get(id)?.abort();
      return run;
    },
    command(id, commandId, decision, note = '') {
      const waiting = commands.get(id);
      if (!waiting || waiting.pending.id !== commandId) throw new RunnerError('no-command');
      if (!COMMAND_DECISIONS.includes(decision)) throw new RunnerError('bad-action', { action: String(decision).slice(0, 20) });
      const said = note.trim().slice(0, 500);
      deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: `runner.command.${decision}`, params: { agent: waiting.pending.agent, note: said || '—' }, stage: waiting.pending.stage });
      waiting.answer({ decision, note: said || undefined });
      return need(id);
    },
    async undoPost(id, key) {
      const run = need(id);
      const rec = run.comments[key];
      if (!deps.publisher || !rec || rec.status !== 'published' || rec.noteId === null || key === 'pr') throw new RunnerError('nothing-to-undo', { key: key.slice(0, 48) });
      return deps.publisher.undo(id, key);
    },
    activities: () => sortedFronts(activities.read(deps.runs, deps.config().language)).reverse(),
    correctActivity: (ref, text) => activities.correct(ref, text, deps.runs, deps.config().language),
    async editMemory(id, text) {
      const run = need(id);
      // The agent has the worktree: a write now would race it for the file, and the stage's own commit is what carries the memory.
      if (inflight.has(id) || run.status === 'working') throw new RunnerError('memory-busy');
      if (!existsSync(run.worktree)) throw new RunnerError('worktree-gone');
      const config = deps.config();
      const identity = await commitIdentity(config.runner.identity, run.worktree, deps.identity);
      if (!identity) throw new RunnerError('no-identity');
      // The person's own words, masked like every other document; the path guard is `writeMemory`'s.
      writeMemory(run.worktree, run.cycleFolder, redact(text).slice(0, MEMORY_EDIT_MAX));
      // i18n-ignore-next-line: the subject of a commit in the repository's history: English, like the rest of its commits
      await commitAll(run.worktree, commitMessage(config.runner.commitMessage, 'update the cycle memory', run.issue.iid), identity);
      move(id, (r, _f, at) => memoryEdited(r, at));
      return readArtifact(run.worktree, run.cycleFolder, MEMORY_FILE);
    },
    skipWait: (id, reason) => {
      // Going on without answering a plugin: its requests stay in Actions, and they no longer hold this run (a new request would). The reason is
      // checked first, so a refused skip never lets the requests go.
      if (!reason.trim()) throw new RunError('empty-reason');
      if (deps.runs.get(id)?.wait?.kind === 'plugin') deps.pluginRelease?.(id);
      return move(id, (r, f, at) => waitSkip(r, f, reason, at));
    },
    pluginSettled(id, note) {
      const run = deps.runs.get(id);
      if (!run) return;
      if (note) deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: note.code, params: note.params, stage: run.stage, public: false });
      if (run.status === 'waiting' && run.wait?.kind === 'plugin' && !deps.pluginHold?.(id)) move(id, (r, _f, at) => pluginWaitDone(r, at));
    },
    sendBack(id, stageId, note) {
      const before = need(id);
      // A reopened run is an active one again: it cannot be while another run of the issue is going.
      if (before.status === 'done' && deps.runs.activeFor(before.issue.ref)) throw new RunError('duplicate', { issue: before.issue.ref });
      const flow = flowFor(before);
      const writers = new Set(deps.config().agents.team.filter((a) => a.permission === 'worktree').map((a) => a.id));
      const target = stageId.trim() || defaultSendBackTarget(flow, before.stage, (a) => writers.has(a))?.id;
      if (!target) throw new RunError('unknown-stage', { stage: '' });
      const run = move(id, (r, f, at) => sendBackTo(r, f, { toStage: target, note }, at));
      // A question that was going from agent to agent is not answered any more.
      chainAborts.get(id)?.abort();
      return run;
    },
    migrateFlow(id) {
      const config = deps.config();
      // The flow a run moves to is its squad's (the workspace's when it has none), a release run's is the release flow and a documentation run's the docs flow.
      const target = need(id);
      const own = runKindFlowOf(config, target);
      if (target.subject && !own) throw new RunnerError('no-release-flow');
      if (target.docs && !own) throw new RunnerError('no-docs-flow');
      const view = own ? { agents: { team: effectiveTeam(config) }, devCycle: { stages: own } } : squadView(config, target.squad);
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
      // A draft is not on the team that runs: it cannot be switched to autonomous.
      if (!workingTeam(deps.config().agents.team).some((a) => a.id === agentId)) throw new RunnerError('unknown-agent', { agent: agentId.slice(0, 48) });
      return deps.updateConfig((c) => updateAgent(c, agentId, { autonomous: on }));
    },
    answer(id, text, attachments) {
      // The files ride to the stage that resumes: the move hangs them on the message it records, and this turn keeps them for the attempt that reads them.
      const files = cleanAttachments(attachments);
      const carried = files.length ? { 0: files } : undefined;
      const stage = deps.runs.get(id)?.stage ?? '';
      if (carried) carriedByStage.set(carriedKey(id, stage), files);
      try {
        return move(id, (r, f, at) => ({ ...answerMove(r, f, text, at, files), ...(carried ? { attachments: carried } : {}) }));
      } catch (e) {
        carriedByStage.delete(carriedKey(id, stage));
        throw e;
      }
    },
    answerPost(thread, text, attachments) {
      const id = thread.startsWith('run-') ? thread.slice(4) : '';
      const run = id ? deps.runs.get(id) : null;
      if (!run || run.status !== 'question' || run.question?.kind === 'squad' || run.question?.kind === 'pr-retry' || !text.trim()) return null;
      // Naming an agent asks that agent something; it is not the answer to the question that waits.
      if (parseMentions(text, mentionableIds(deps.config().agents.team, thread)).length) return null;
      // The files the message carries ride on the answer the runner writes, so the message shows them and the retention sees them as referenced.
      api.answer(run.id, text, attachments ?? []);
      const last = deps.forum.read(thread, 0, 2000)?.messages ?? [];
      return [...last].filter((m) => m.kind === 'answer').at(-1) ?? null;
    },
    onMessage(message) {
      if (message.author.type !== 'person' || message.kind !== 'post' || !message.mentions.length || !message.thread.startsWith('run-')) return;
      const runId = message.thread.slice(4);
      const run = deps.runs.get(runId);
      if (!run) return;
      // The agent working the stage is reached inside the stage: the message queues for its next step and the stage does not restart. Every other agent named
      // keeps today's behaviour (a call in parallel, read-only), and a run that is not working has no stage to reach.
      const text = (message.text ?? '').trim();
      const working = workingAgent(run);
      const inbox = working ? inboxOf(runId) : null;
      // Naming the agent that works queues one message for it; the other mentions of the same message keep today's call. A mention repeated for the same agent
      // keeps one call per mention, as today: only the occurrences that went to the queue are left out of the parallel call.
      let toStage = 0;
      if (inbox && working && text) {
        for (const id of message.mentions.slice(0, MAX_MENTIONS)) {
          if (id !== working || toStage >= 1) continue;
          const queued = inbox.post(text, message.waitsForAnswer);
          // The agent is told that the record of the activities moved only when the message really entered the session: a message handed back in the closing line keeps the person's words.
          if (queued) inbox.post(`\n${memoryOn(deps.config()) ? prompt('runner.section.sharedMovedMemory') : prompt('runner.section.sharedMoved')}`, false);
          toStage++;
          // The mailbox writes the closing line itself when the stage is already finishing; here only a message that went in is announced.
          if (queued) deps.forum.append(message.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.message.waiting', params: { agent: id, text: text.slice(0, 600) }, stage: run.stage });
        }
      }
      const call = toStage ? message.mentions.slice(toStage, MAX_MENTIONS) : message.mentions.slice(0, MAX_MENTIONS);
      if (!call.length) return;
      const rest = { ...message, mentions: call };
      // Each agent named gets its call line at once, before the queue: the person sees who was called and who waits its turn.
      try {
        openCalls(runId, run, rest);
      } catch (e) {
        console.error('[runner] could not open the mention calls', runId, e instanceof Error ? e.message : e);
      }
      const prior = mentions.get(runId) ?? Promise.resolve();
      // One answer at a time per run: the thread reads in order.
      const next = prior.then(() => answerMention(runId, rest)).catch(() => undefined);
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
      // Every write an answer proposed goes through the mentions module's own path: the runner keeps nothing of it.
      publish(id, (p) => p.actionDone(action, responses));
    },
    actionRefused(action, reason) {
      const id = String(action.unit?.runId ?? '');
      if (id && deps.runs.get(id)) publish(id, (p) => p.actionRefused(action, reason));
    },
    async flush() {
      // Only what this call queued is awaited: the stages that are working, the questions and the mentions go on by themselves and are not its business, so a run
      // that is slow does not hold back the waits the same sweep has to look at.
      const queued: Promise<void>[] = [];
      for (const run of deps.runs.list()) {
        if (run.status === 'cancelled' || !Object.values(run.comments).some((c) => c.status === 'draft' && c.target === 'mr')) continue;
        publish(run.id, (p) => p.flushReviews(run.id));
        const work = publishing.get(run.id);
        if (work) queued.push(work);
      }
      await Promise.allSettled(queued);
    },
    sweep: () =>
      (sweeping ??= (async () => {
        // The three looks are independent: one that fails (the host is down) does not keep the others from happening; the first failure is still told to the caller.
        let first: unknown = null;
        for (const look of [api.scan, api.tick, api.flush]) {
          try {
            await look();
          } catch (e) {
            first ??= e;
          }
        }
        if (first !== null) throw first;
      })().finally(() => (sweeping = null))),
    resume() {
      // The app that just opened remembers no provider from before: the runs that were waiting on one are read back from their `wait`, and the sweep probes them.
      for (const run of deps.runs.list()) {
        if (run.status === 'waiting' && run.wait?.kind === 'budget' && run.wait.provider) {
          budget.set(run.wait.provider, { engine: '', reason: run.wait.detail ?? '', since: run.wait.since });
        }
      }
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

  const callKey = (runId: string, message: number, agent: string): string => `${runId}:${message}:${agent}`;

  /** The agent working the stage of a run right now; null when the run is not working a stage. */
  function workingAgent(run: Run): string | null {
    if (run.status !== 'working') return null;
    const stage = flowFor(run).find((s) => s.id === run.stage);
    return stage?.agent ?? null;
  }

  // Every agent named in the message gets its call as soon as the message is accepted, before the queue: the line exists while it waits its turn.
  function openCalls(runId: string, run: { worktree: string }, message: ForumMessage): void {
    const team = deps.config().agents.team;
    const cwd = existsSync(run.worktree) ? run.worktree : deps.env().fallbackCwd;
    for (const id of message.mentions.slice(0, MAX_MENTIONS)) {
      if (!team.some((a) => a.id === id) || calls.has(callKey(runId, message.seq, id))) continue;
      const queued = (liveCalls.get(runId) ?? 0) > 0;
      const activity = beginCallActivity(id, { jobId: `run:${runId}`, call: { agent: id, thread: message.thread, message: message.seq }, isSecretPath: (p) => secretPath(p, cwd) });
      activity.status(queued ? 'queued' : 'started');
      calls.set(callKey(runId, message.seq, id), { activity, queued });
      liveCalls.set(runId, (liveCalls.get(runId) ?? 0) + 1);
    }
  }

  /** The call is over (it answered or it failed): the line goes with it, and the next one of the run may begin. */
  function releaseCall(runId: string, message: number, agent: string): void {
    if (!calls.delete(callKey(runId, message, agent))) return;
    const left = (liveCalls.get(runId) ?? 1) - 1;
    if (left > 0) liveCalls.set(runId, left);
    else liveCalls.delete(runId);
  }

  // The agent answers in the thread without ever writing to the run: whatever its own permission is, a mention never gets it Edit or Write. An agent set to run
  // commands runs them over a throwaway copy of the code (with the person's yes per command on `host`), and one that reads the code host may propose an issue,
  // which waits in Actions. The loop is the mentions core; the run is one of its places, with the worktree, the flow stage and the publisher of a run.
  async function answerMention(runId: string, message: ForumMessage): Promise<void> {
    const run = deps.runs.get(runId);
    if (!run) {
      // The run went away while the call waited: its line would wait forever.
      for (const id of message.mentions.slice(0, MAX_MENTIONS)) {
        calls.get(callKey(runId, message.seq, id))?.activity.status('failed');
        releaseCall(runId, message.seq, id);
      }
      return;
    }
    const place: MentionPlace = { thread: runThreadId(runId), kind: 'run', run, repos: [] };
    await answerMentions(place, message, {
      forum: deps.forum,
      config: deps.config,
      engine: deps.engine,
      sandbox: exec.sandbox,
      env: deps.env,
      screens: () => (deps.sessions && deps.asks ? { sessions: deps.sessions, asks: deps.asks, handoff: deps.handoff } : null),
      openSession: async (p, def, cwd, stage, signal, watch, wants) => {
        const r = p.run;
        if (!r || !stage) return null;
        const flowStage = flowFor(r).find((s) => s.id === stage);
        if (!flowStage || !existsSync(r.worktree)) return null;
        const clock: StageClock = { pause: watch.pause, beat: watch.beat, allowed: new Set() };
        return openStageSandbox(exec, r, flowStage, { ...def, permission: 'read' }, false, signal, clock, false, wants?.display === true, { held: wants?.held, mask: wants?.mask });
      },
      // The line each agent got when the message was accepted goes on in the answer, and the next call of the run may begin when this one ends.
      callOf: (id) => calls.get(callKey(runId, message.seq, id)) ?? null,
      release: (id) => releaseCall(runId, message.seq, id),
      // A mention on a provider whose key has no budget does not spend a call: the thread says why, and the mention is left for when the provider answers again.
      held: (def) => {
        const provider = deps.config().llm.roles[def.model.role ?? 'deep']?.provider ?? '';
        return provider && budget.has(provider) ? { provider, reason: budget.get(provider)?.reason ?? '—' } : null;
      },
      // Every write an answer proposes, a run's thread included, goes through the mentions module's own path: the same door of Actions, no publisher in between.
      propose: proposeMention,
      // What the answer is told of the activities: its own front whole, and whatever else the message named.
      memory: (_place, msg, narrow) => sharedTextOf(run.issue.ref, callsOfMention(msg), [], narrow),
      procedures: deps.procedures,
      memoryPort: deps.memoryPort,
      // What the message names, for the ranking of the memory's list.
      named: (_p, msg) => ({ refs: [], agents: callsOfMention(msg) }),
      offers: deps.offers,
      // An agent named in a run's thread reads only inside that run's worktree; a refusal is told in the thread, like a stage's.
      readRoot: (p, def, _cwd) => {
        const r = p.run;
        if (!r || !existsSync(r.worktree)) return undefined;
        return readConfinement(r.worktree, def.model.role ?? 'deep', (den) => {
          deps.forum.append(runThreadId(r.id), { kind: 'system', author: { type: 'app' }, code: 'runner.denied', params: { agent: def.id, tool: den.tool, target: den.target || '—', reason: t(`main.runner.denied.${den.code}`) }, stage: r.stage });
        }, unconfinedOf(deps.config().runner));
      },
    });
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
      const others = squadsOf(config).filter((o) => o.id !== own?.id && o.liaison && workingTeam(config.agents.team).some((a) => a.id === o.liaison && a.squad === o.id));
      const liaison = own && own.liaison === holder.id && others.length ? { squad: own, others } : undefined;
      let answer: ReturnType<typeof readChain> = null;
      let failure = '';
      let partial = false;
      try {
        const call = chainCall({ run, holder, asker: q.by, question: q.text, config, thread: deps.forum.read(runThreadId(id), 0, 2000)?.messages ?? [], files: existsSync(run.worktree) ? readFolder(run.worktree, run.cycleFolder) : [], cwd, liaison });
        // The agent that answers reads what the stage's agent reads of the repository's documentation, at the stage the run is at.
        call.docs = existsSync(run.worktree)
          ? await runDocsAsk({ wt: run.worktree, base: run.base, cycleFolder: run.cycleFolder, stage: stageOfRun(run, config), texts: readFolder(run.worktree, run.cycleFolder).map((f) => f.text) })
          : { repos: [], stage: stageOfRun(run, config), paths: [] };
        // The agent that answers a question only reads: what it reads stays in the run's worktree, and a refusal is told in the run's thread.
        call.readRoot = readConfinement(run.worktree, holder.model.role ?? 'deep', (den) => {
          deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: 'runner.denied', params: { agent: holder.id, tool: den.tool, target: den.target || '—', reason: t(`main.runner.denied.${den.code}`) }, stage: run.stage });
        }, unconfinedOf(config.runner));
        const abort = new AbortController();
        chainAborts.set(id, abort);
        const watch = watchdog(abort, limitsOf(config, deps));
        call.beat = watch.beat;
        const r = await watch.guard(withActivityContext(`run:${id}`, () => deps.engine(call, [])));
        answer = readChain(r.data);
        partial = !!r.partial;
        if (!answer) failure = 'empty-answer';
      } catch (e) {
        failure = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
      }
      // The person (or a cancel) may have answered while the agent thought: then what it said is not used.
      const now = deps.runs.get(id)?.question;
      if (deps.runs.get(id)?.status !== 'question' || !now || now.askedAt !== q.askedAt || now.holder !== q.holder || (now.hops ?? 0) !== (q.hops ?? 0)) return;
      if (!answer) return handUp(id, holder.id, 'failed', failure);
      if (partial) deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: 'runner.partial', params: { agent: holder.id }, stage: run.stage });
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
    const target = to?.liaison ? workingTeam(config.agents.team).find((a) => a.id === to.liaison && a.squad === to.id) : undefined;
    if (!offered || !request || !from || from.liaison !== holder.id || !to || to.id === from.id || !target) return handUp(id, holder.id, 'failed', t('main.runner.request.invalid'));
    ensureSquadChannels(deps.forum, squadsOf(config), config.language);
    const toName = squadName(config, to);
    const [sent] = deps.forum.append(SQUADS_CHANNEL, { kind: 'request', author: { type: 'agent', id: holder.id }, to: target.id, text: request.text, params: { from: from.id, squad: to.id, kind: request.kind, run: id, ref: run.issue.ref }, public: false });
    deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: 'runner.request.sent', params: { agent: holder.id, squad: toName, kind: request.kind }, stage: run.stage });
    const reply = (draft: Partial<ForumDraft>) => deps.forum.append(SQUADS_CHANNEL, { kind: 'answer', author: { type: 'agent', id: target.id }, to: holder.id, replyTo: sent.seq, public: false, ...draft });

    let answer: RequestAnswer | null = null;
    let failure = '';
    let partial = false;
    try {
      const call = requestCall({ run, holder: target, asker: holder.id, from, to, kind: request.kind, text: request.text, config, thread: deps.forum.read(SQUADS_CHANNEL, 0, 2000)?.messages ?? [], cwd: squadCwd(to, run) });
      // The liaison that receives the request reads the documentation of its own squad's repository (the run's worktree when it has no repository of its own).
      call.docs = call.cwd === run.worktree
        ? await runDocsAsk({ wt: run.worktree, base: run.base, cycleFolder: run.cycleFolder, stage: stageOfRun(run, config), texts: readFolder(run.worktree, run.cycleFolder).map((f) => f.text) })
        : { repos: [call.cwd], stage: stageOfRun(run, config), paths: [] };
      const abort = new AbortController();
      chainAborts.set(id, abort);
      const watch = watchdog(abort, limitsOf(config, deps));
        call.beat = watch.beat;
        const r = await watch.guard(withActivityContext(`run:${id}`, () => deps.engine(call, [])));
      answer = readRequestAnswer(r.data);
      partial = !!r.partial;
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

    if (partial) deps.forum.append(runThreadId(id), { kind: 'system', author: { type: 'app' }, code: 'runner.partial', params: { agent: target.id }, stage: run.stage });
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

  /**
   * Asks each provider whose key ran out of budget, with one small call, whether it answers again. A provider that answers sends every run waiting on
   * it on (`waitDone`), whatever their stage; a provider that refuses again, or that cannot be told (a 5xx, the network), leaves them waiting.
   */
  async function probeWaitingProviders(): Promise<Run[]> {
    const probe = deps.probeBudget;
    if (!probe || !budget.size) return [];
    const sent: Run[] = [];
    for (const [provider, state] of [...budget]) {
      let result: Awaited<ReturnType<BudgetProbeFn>>;
      try {
        result = await probe(provider);
      } catch (e) {
        result = probeStateOf(e);
      }
      if (result.state === 'out') {
        budget.set(provider, { ...state, reason: result.detail || state.reason });
        continue;
      }
      if (result.state === 'unknown') {
        console.error('[runner] could not tell whether the provider has budget', provider, result.detail);
        continue;
      }
      budget.delete(provider);
      for (const run of deps.runs.list()) {
        if (run.status !== 'waiting' || run.wait?.kind !== 'budget' || run.wait.provider !== provider) continue;
        try {
          sent.push(move(run.id, (r, f, at) => waitDone(r, f, { reply: '', from: 'app' }, at)));
        } catch (e) {
          console.error('[runner] could not send on a run waiting for a provider', run.id, e instanceof Error ? e.message : e);
        }
      }
    }
    return sent;
  }

  // Every waiting run is looked at once per tick: the code host says whether its event happened, and the run goes on from where it waits.
  async function lookForEvents(): Promise<Run[]> {
    const sent: Run[] = await probeWaitingProviders();
    for (const run of deps.runs.list().filter((r) => r.status === 'waiting')) {
      const w = run.wait;
      if (!w || w.kind === 'budget') continue;
      // A run held by a plugin request waits for the person's answer in Actions, never for the host: a comment on the issue is not that answer. When no
      // request of it is left (the app closed between the answer and the release, say), it goes on here.
      if (w.kind === 'plugin') {
        if (!deps.pluginHold?.(run.id)) {
          try {
            sent.push(move(run.id, (r, _f, at) => pluginWaitDone(r, at)));
          } catch (e) {
            console.error('[runner] could not let a run held by a plugin go', run.id, e instanceof Error ? e.message : e);
          }
        }
        continue;
      }
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
    // A release run is looked at on every sweep, whatever it is doing: its activities, the betas and the stable the host shows published, its tracking issue. One that
    // ended long ago and has nothing left to close is not looked at any more.
    const queued: Promise<void>[] = [];
    for (const run of deps.runs.list()) {
      if (!run.subject || run.status === 'cancelled' || run.subject.tracking?.closed || (isTerminal(run) && Date.parse(run.updatedAt) < (deps.now?.() ?? new Date()).getTime() - RELEASE_WATCH_DAYS * 86_400_000)) continue;
      publish(run.id, (p) => p.releaseTick(run.id));
      const work = publishing.get(run.id);
      if (work) queued.push(work);
    }
    await Promise.allSettled(queued);
    return sent;
  }

  // ---- runs the app starts by itself ------------------------------------------------------------------------------------------------

  async function scanIssues(): Promise<Run[]> {
    const config = deps.config();
    if (!config.runner.enabled || !isFlowCycle(config.devCycle.stages) || !deps.issues.ready()) return [];
    // A provider without budget holds the starts: without resolving each run's roles there is no way to tell whether it would use that provider, so nothing starts.
    if (budget.size) return [];
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
