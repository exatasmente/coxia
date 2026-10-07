import { offersViewImage } from '../sandbox/tool';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { squadOf, squadsOf, turnTarget } from '../../shared/config/squads';
import { autonomyOf, choiceOn, flowKeyOf } from '../../shared/config/autonomy';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import type { AttachmentRef } from '../../shared/attachments';
import { type ForumMessage, runThreadId } from '../../shared/forum';
import { type ModelRole } from '../../shared/settings';
import { t } from '../../shared/i18n';
import { type CommandDecision, type UsageReport, type FlowStage, type OutputKind, type Run, type StageOutput, backEvidence, outputKindOf, outputSchema, priorityStageOf, pushesAt, readOutput } from '../../shared/runs';
import { withActivityContext } from '../activity';
import { type AgentCall, extraReadRoots } from '../agents';
import { MaxTurnsError, ProviderBudgetError, type ReadConfinement } from '../engine/contract';
import { writableLabels } from '../../shared/priority';
import type { ForumStore } from '../forum-core';
import { MEMORY_FILE, ensureMemory, readFolder, readMemory, tidyArtifact, writeArtifact, writeMemory } from './cycleFolder';
import { MEMORY_MAX, applyFacts, factsOfThread, memoryOver, normalizeMemory } from './memory';
import { type Identity, branchDiff, branchStat, changedOutside, commitAll, commitFallback, commitIdentity, commitMessage, commitSummary, declaredCommands, headSha } from './git';
import { type CommandResult, type CommandRunner, notRunReport, runCommand, runCommands } from './commands';
import { ensureDependencies } from './dependencies';
import { recordWrite } from '../auditoria';
import { type ExecResult, type SandboxService, type SandboxSession, SandboxError } from '../sandbox';
import { evidenceToolsOf } from '../evidence/handlers';
import { copyToCycleFolder } from '../evidence/store';
import { evidencePlacementOf, type EvidenceRecord } from '../../shared/evidence';
import { redact, redactCode, redactDoc } from '../errorlog-core';
import { type Denial, confinedHooks, readConfinedHooks } from './hooks';
import { type CommentAsk, type ResumeWhy, type StageInput, type StageResume, stagePrompt, systemText } from './prompt';
import { type StageInbox, inboxOf, openInbox } from './inbox';
import { type RunnerTools, runnerTools } from './tools';
import { callRefusal, countOpen, openedIn, runConversation, resetOpened } from './conversation';
import { releaseSection, releaseStateOf } from './release';
import { prepareDocsFolder } from './docs';
import { runDocsAsk } from '../harness/deliver';
import { scanHarness } from '../harness/scan';
import { behindOf } from '../harness/stale';
import { STAMP_SUMMARY, finalizeHarness, stampHarness } from '../harness/finalize';
import { HARNESS_DIR, HARNESS_OWN } from '../../shared/harness/format';
import { crMarkOf } from '../../shared/i18n/terms';
import { primaryIntegration } from '../../shared/cycles/terms';

// One attempt at one stage: build what the agent reads, run it, write the documents it returned into the cycle folder and commit what it did.
// The agent never writes the documents nor commits: the app does both, so an agent that only reads can still produce its stage's documents, and
// the commits carry the workspace's identity. What the attempt means for the run (done, a question, findings) is the service's to apply.

export const STAGE_ERROR_CODES = ['no-stage', 'unknown-agent', 'worktree-gone', 'timeout', 'too-long', 'turns', 'empty-answer', 'missing-artifacts', 'no-identity', 'cancelled', 'no-sandbox', 'budget', 'docs-folder-unsafe'] as const;
export type StageErrorCode = (typeof STAGE_ERROR_CODES)[number];

export class StageError extends Error {
  constructor(
    readonly code: StageErrorCode,
    params: Record<string, string | number> = {},
  ) {
    super(t(`main.runner.error.${code}`, params));
    this.name = 'StageError';
    this.params = params;
  }

  /** What built the message: the runner reads the provider of a budget refusal out of here. */
  readonly params: Record<string, string | number>;
}

/** Runs one agent call; `commands` are what an agent that writes may execute. The real one is `runAgent` of agents.ts. */
export type StageEngine = (call: AgentCall, commands: string[]) => Promise<{ data: unknown; partial?: true }>;

export interface ExecutorDeps {
  engine: StageEngine;
  /** What the plugins that are on tell the agents; absent: nothing. */
  pluginNotes?(): { name: string; note: string }[];
  config(): WorkspaceConfig;
  forum: ForumStore;
  /** The identity of a repository, when the workspace names none: its own `.git/config` by default (`repoIdentity`), never the global one. */
  identity?: (wt: string) => Promise<Identity | null>;
  /** Runs the commands QA is given the results of (the real one by default). */
  commandRunner?: CommandRunner;
  /** Makes the sandbox of an agent set to `shell: sandbox`. Without one, a stage of such an agent fails: it never runs its commands unsandboxed. */
  sandbox?: SandboxService;
  /**
   * Asks the person whether an agent set to `shell: host` may run a command, and resolves with the answer; the signal ends the question with the stage. Without it no
   * host command runs: each one is refused.
   */
  askCommand?: (ask: { run: string; stage: string; agent: string; command: string }, signal: AbortSignal) => Promise<{ decision: CommandDecision; note?: string }>;
  /** Replaces `runner.stageIdleMs` and `runner.stageMaxMs` (tests). */
  timeoutMs?: number;
  /** Replaces one limit or the other (tests). */
  limits?: Partial<Limits>;
  /** What the `ReleaseAction` tool of a release run's agent calls: one step of the release, answered in text for the model. Without it the agent gets no such tool. */
  release?: (runId: string, input: unknown, who: { by: string; autonomous: boolean; stage: string; attempt: number }) => Promise<string>;
  /**
   * Records a piece of evidence a stage kept and publishes it in the run's conversation; without it the evidence tools are not offered (a test that does not want them).
   * The publisher and the run store are the service's, not the executor's.
   */
  keepEvidence?: (runId: string, record: EvidenceRecord) => ForumMessage | null;
  /** Updates a piece of evidence already recorded (the copy that went into the cycle folder): the run's record changes, nothing is published again. */
  updateEvidence?: (runId: string, record: EvidenceRecord) => void;
  /** The workspace's data folder: where a run's evidence is stored. */
  dataDir: () => string;
}

export interface StageRun {
  kind: OutputKind;
  output: StageOutput;
  /** The documents written into the cycle folder. */
  written: string[];
  /** The commit this attempt made; null when nothing changed. */
  commit: string | null;
  /** What the app ran in the worktree before a QA pass, in order. */
  commands?: CommandResult[];
  /** An agent that changes files ended the pass with no change outside the cycle folder. */
  noCodeChange?: boolean;
  /** The branch's commit the agent looked at, before the app committed what the attempt produced: what a review or a QA pass is about. */
  head: string | null;
  /** The evidence kept during this attempt, in the order it was kept. */
  keptEvidence?: EvidenceRecord[];
}

export interface Picked {
  agent: AgentDef;
  stage: FlowStage;
  kind: OutputKind;
}

/**
 * The agent a question of `agent` goes to first: the one it turns to, when that is another agent of the team; for a member of a squad that turns to the
 * person, its liaison (`turnTarget`).
 */
export const askTarget = (config: WorkspaceConfig, agent: AgentDef): string | null => turnTarget(config, agent);

export function pickAgent(config: WorkspaceConfig, run: Run, flow: FlowStage[]): Picked {
  const stage = flow.find((s) => s.id === run.stage);
  if (!stage || !stage.agent) throw new StageError('no-stage', { stage: run.stage });
  const agent = config.agents.team.find((a) => a.id === stage.agent);
  if (!agent) throw new StageError('unknown-agent', { agent: stage.agent });
  return { agent, stage, kind: outputKindOf(stage.kind) };
}

/** The last note another stage left for `agent` that it has not answered with a post since. */
export function pendingHandoff(thread: ForumMessage[], agent: string): { from: string; text: string } | null {
  const lastPost = Math.max(0, ...thread.filter((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === agent).map((m) => m.seq));
  const note = [...thread].reverse().find((m) => m.kind === 'handoff' && m.to === agent && m.seq > lastPost);
  return note ? { from: note.author.type === 'agent' ? note.author.id : note.author.type, text: note.text } : null;
}

/**
 * Why the current attempt at `stageId` runs again, read from the history entry that led to its last start: null for a stage that started in the flow's
 * order (its first attempt, or a later one reached by moving forward).
 */
export function resumeWhy(run: Run, stageId: string): ResumeWhy | null {
  const h = run.history;
  const start = h.findLastIndex((e) => e.type === 'stage-started' && e.stage === stageId);
  for (let n = start - 1; n >= 0; n--) {
    const type = h[n].type;
    if (type === 'sent-back') return 'sent-back';
    if (type === 'handback' || type === 'stage-returned' || type === 'gate-rejected') return 'returned';
    if (type === 'retried') return 'retried';
    if (type === 'interrupted') return 'restarted';
    if (type === 'stage-done' || type === 'stage-started' || type === 'started') return null;
  }
  return null;
}

/** What a stage that runs again is told about the earlier attempts: its documents already in the folder, the evidence it kept and its last report. */
export function stageResume(run: Run, stage: FlowStage, agent: string, thread: ForumMessage[], wt: string): StageResume | null {
  const why = resumeWhy(run, stage.id);
  if (!why) return null;
  const report = [...thread].reverse().find((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === agent && m.stage === stage.id);
  return {
    why,
    done: stage.artifacts.filter((name) => existsSync(join(wt, run.cycleFolder, name))),
    evidence: Object.values(run.evidence ?? {})
      .filter((e) => e.stage === stage.id)
      .map((e) => ({ id: e.id, title: e.title })),
    previous: report?.text.trim() || null,
  };
}

/** The person's answer to the last question this agent asked in this stage, until the agent reports again. */
export function pendingAnswer(thread: ForumMessage[], agent: string, stage: string): { question: string; text: string; by: string; attachments: AttachmentRef[] } | null {
  const asked = [...thread].reverse().find((m) => m.kind === 'question' && m.author.type === 'agent' && m.author.id === agent && m.stage === stage);
  if (!asked) return null;
  const answered = thread.find((m) => m.kind === 'answer' && m.seq > asked.seq);
  if (!answered) return null;
  const reported = thread.some((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === agent && m.seq > answered.seq);
  return reported ? null : { question: asked.text, text: answered.text, by: answered.author.type === 'agent' ? answered.author.id : t(answered.author.type === 'app' ? 'main.runner.author.app' : 'main.runner.author.person'), attachments: answered.attachments ?? [] };
}

/**
 * The files a stage's agent may open: the ones the answer message names, and, for the turn that just resumed the stage, the ones the move that recorded the
 * answer carried (the run file does not keep them). The workspace option turns the files off for agents; the message keeps showing them to the person.
 */
function attachmentsFor(config: WorkspaceConfig, thread: string, answer: { attachments: AttachmentRef[] } | null, carried: readonly AttachmentRef[] | undefined): { thread: string; refs: AttachmentRef[] } | undefined {
  if (config.attachments?.agents === false) return undefined;
  const refs = carried?.length ? [...carried] : (answer?.attachments ?? []);
  return refs.length ? { thread, refs } : undefined;
}

/** How long an agent may be silent, and how long a call may take in all. */
export interface Limits {
  idleMs: number;
  maxMs: number;
}

const minutes = (ms: number): number => Math.max(1, Math.round(ms / 60_000));

/** The limits of the workspace; what the deps give (tests) replaces them: `timeoutMs` both, `limits` one by one. */
export const limitsOf = (config: WorkspaceConfig, over: { timeoutMs?: number; limits?: Partial<Limits> } = {}): Limits => ({
  idleMs: over.limits?.idleMs ?? over.timeoutMs ?? config.runner.stageIdleMs,
  maxMs: over.limits?.maxMs ?? over.timeoutMs ?? config.runner.stageMaxMs,
});

export interface Watchdog {
  /** The agent showed a sign of life (a model event): the idle limit starts again. */
  beat(): void;
  /** Resolves with `work`, or rejects when the agent was silent for the idle limit, the call ran past its cap, or the call was cancelled. */
  guard<T>(work: Promise<T>): Promise<T>;
  /** Stops both clocks while the agent waits for the person (a command to allow); the function it returns starts them again, the cap with what was left of it. */
  pause(): () => void;
}

/**
 * Watches one agent call: the idle limit counts from the last `beat` (a call that keeps working never trips it) and the cap from the start, and both stop the
 * agent. Cancelling from outside makes the run stop waiting for an agent that may not notice.
 */
export function watchdog(abort: AbortController, limits: Limits): Watchdog {
  let idle: NodeJS.Timeout | undefined;
  let cap: NodeJS.Timeout | undefined;
  let fail: ((e: StageError) => void) | null = null;
  let capLeft = limits.maxMs;
  let capFrom = 0;
  let paused = 0;
  const stop = (e: StageError): void => {
    fail?.(e);
    abort.abort();
  };
  const arm = (): void => {
    clearTimeout(idle);
    idle = setTimeout(() => stop(new StageError('timeout', { minutes: minutes(limits.idleMs) })), limits.idleMs);
  };
  const armCap = (): void => {
    clearTimeout(cap);
    capFrom = Date.now();
    cap = setTimeout(() => stop(new StageError('too-long', { minutes: minutes(limits.maxMs) })), capLeft);
  };
  return {
    beat: () => {
      if (fail && !paused) arm();
    },
    pause: () => {
      if (!fail) return () => undefined;
      if (paused++ === 0) {
        clearTimeout(idle);
        clearTimeout(cap);
        capLeft = Math.max(0, capLeft - (Date.now() - capFrom));
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        if (--paused === 0 && fail) {
          arm();
          armCap();
        }
      };
    },
    async guard<T>(work: Promise<T>): Promise<T> {
      work.catch(() => undefined);
      const late = new Promise<never>((_, reject) => {
        fail = reject;
        capLeft = limits.maxMs;
        arm();
        armCap();
        abort.signal.addEventListener('abort', () => reject(new StageError('cancelled')));
      });
      try {
        return await Promise.race([work, late]);
      } finally {
        clearTimeout(idle);
        clearTimeout(cap);
        fail = null;
      }
    },
  };
}

/** The old shape, for a caller with one number: that long of silence, and that long in all. */
export const withLimit = <T>(work: Promise<T>, abort: AbortController, ms: number): Promise<T> => watchdog(abort, { idleMs: ms, maxMs: ms }).guard(work);

/** The commands the app runs before QA, through the stage's sandbox: the same result shape as when the app runs them itself. */
export const sessionRunner = (session: SandboxSession): CommandRunner => async (_cwd, command) => {
  const r = await session.exec(command);
  return { command, exitCode: r.exitCode, timedOut: r.timedOut, output: r.output, ms: r.ms };
};

const clipText = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What the thread says about a command of a sandbox: how it ended. */
const endedAs = (r: ExecResult): string => (r.refused ? t(`main.runner.exec.refused.${r.refused}`) : r.timedOut ? t('main.runner.exec.timeout') : r.exitCode === null ? t('main.runner.exec.notRun') : t('main.runner.exec.exit', { code: r.exitCode }));

/**
 * Makes the sandbox of the stage (or, for an agent set to `shell: host`, the session that runs its commands on this computer once the person allows each one), and tells
 * the thread, the audit log and (through the session) the live activity about every command that runs in it. A machine that cannot make a sandbox fails the stage: an
 * agent set to run commands in one never runs them without.
 */
export async function openStageSandbox(d: ExecutorDeps, run: Run, stage: FlowStage, agent: AgentDef, writes: boolean, signal: AbortSignal, clock: StageClock): Promise<SandboxSession> {
  const host = agent.shell === 'host';
  const config = d.config();
  const threadId = runThreadId(run.id);
  if (!d.sandbox) throw new StageError('no-sandbox', { agent: agent.id, reason: t('main.sandbox.reason.platform') });
  const report = (r: ExecResult, mode: 'run' | 'refused'): void => {
    try {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: host ? 'runner.exec.host' : 'runner.exec', params: { agent: agent.id, n: r.n, command: clipText(redact(r.command.replace(/\s+/g, ' ')), 300), result: endedAs(r), ms: Math.round(r.ms / 100) / 10, tail: clipText(r.output, 600) || '—' }, stage: stage.id });
      if (mode === 'run') {
        recordWrite({
          kind: 'exec',
          issue: run.issue.iid,
          target: redact(clipText(r.command, 300)),
          via: host ? 'host' : 'sandbox',
          fields: { agent: agent.id, run: run.id, stage: stage.id, n: String(r.n), ms: String(r.ms), timedOut: String(r.timedOut) },
          ok: r.exitCode === 0,
          code: r.exitCode,
          result: r.output.slice(-300),
          origin: { actionId: '', kind: 'run-exec', key: `${run.id}:${stage.id}`, summary: null },
          by: agent.id,
        });
      }
    } catch (e) {
      console.error('[runner] could not record a command', e instanceof Error ? e.message : e);
    }
  };
  const onProxy = (p: { host: string; port: number; allowed: boolean; why?: string }): void => {
    try {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.proxy', params: { agent: agent.id, host: p.host || '—', port: p.port, result: p.allowed ? t('main.runner.proxy.allowed') : t(`main.runner.proxy.refused.${p.why}`) }, stage: stage.id });
    } catch (e) {
      console.error('[runner] could not record a request of the proxy', e instanceof Error ? e.message : e);
    }
  };
  const onNote = (note: { code: 'runner.sandbox.repoFolder' | 'runner.sandbox.depsOutside'; params: Record<string, string> }): void => {
    try {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: note.code, params: { agent: agent.id, ...note.params }, stage: stage.id });
    } catch (e) {
      console.error('[runner] could not record a note', e instanceof Error ? e.message : e);
    }
  };
  const appendGui = (code: string, params: Record<string, string>): void => {
    try {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code, params: { agent: agent.id, ...params }, stage: stage.id });
    } catch (e) {
      console.error('[runner] could not record a note', e instanceof Error ? e.message : e);
    }
  };
  try {
    // Only the stage that produces the QA output asks for a display; the browsers folder, when the person set one, comes with every sandbox and every host session.
    const display = outputKindOf(stage.kind) === 'qa';
    const session = host
      ? await d.sandbox.openHost({ worktree: run.worktree, reader: !writes, config: config.runner.sandbox, onExec: report, approve: hostApproval(d, run, stage, agent, signal, clock), signal, display })
      : await d.sandbox.open({ worktree: run.worktree, reader: !writes, config: config.runner.sandbox, onExec: report, onProxy, onNote, signal, display });
    const gui = session.gui;
    // What the person switched on and the stage does not have is said once, at its start; the stage goes on and its prompt says the same.
    if (gui?.browsersGone) appendGui('runner.sandbox.noBrowsers', { path: gui.browsersGone });
    if (gui?.display === 'missing' || gui?.display === 'failed') appendGui(gui.display === 'missing' ? 'runner.sandbox.noDisplay' : 'runner.sandbox.displayFailed', {});
    return session;
  } catch (e) {
    if (e instanceof SandboxError) throw new StageError('no-sandbox', { agent: agent.id, reason: e.message });
    throw e;
  }
}

/**
 * A message an agent posts with `SendMessage`, while its stage goes on: it is written in the run's conversation as a post of that agent, and — when it names
 * another agent of the team that is working a stage — it enters that agent's stage as the next step's message, exactly as a message of the person would. It
 * never reaches the code host and never ends the stage. `false` when the stage is already finishing: the message did not reach anyone and the mailbox wrote why.
 */
function sendFromStage(d: ExecutorDeps, run: Run, stage: FlowStage, agent: AgentDef, inbox: StageInbox, to: string, text: string): boolean {
  const threadId = runThreadId(run.id);
  try {
    d.forum.append(threadId, {
      kind: 'post',
      author: { type: 'agent', id: agent.id },
      text,
      stage: stage.id,
      public: false,
      ...(to && to !== 'todos' ? { mentions: [to] } : {}),
    });
  } catch (e) {
    console.error('[runner] could not record an agent message', run.id, e instanceof Error ? e.message : e);
  }
  if (inbox.isClosing) return false;
  // Another agent that is working hears it as a message of its stage; everyone else reads it in the conversation.
  for (const id of to === 'todos' ? d.config().agents.team.map((a) => a.id) : [to]) {
    if (!id || id === agent.id) continue;
    const target = inboxOf(run.id);
    const other = target && target.agent === id ? target : null;
    other?.post(text);
  }
  return true;
}

/** What a host session needs from its stage: the watchdog, once it exists (a command waiting for the person stops its clocks), and the commands already allowed. */export interface StageClock {
  pause(): () => void;
  /**
   * The stage's idle clock starts again as if the agent had just shown a sign of life. A command that waits for the person stops both clocks (`pause`), but the
   * wait itself may have to hand the agent something (a message while it works): that counts as the agent hearing from outside, so the idle limit is not left
   * running with the time the person took to answer.
   */
  beat(): void;
  /** The workspace's own commands the app runs before QA: the person listed them, so they run without asking, as on `allowlist`. */
  allowed: Set<string>;
}

/**
 * Every command of an agent set to `shell: host` waits for the person: "once" lets that one run, "stage" every one until the stage ends, "deny" refuses it (with
 * the person's note for the agent). The stage's clocks stand still meanwhile, so a person who answers later does not fail the stage.
 */
function hostApproval(d: ExecutorDeps, run: Run, stage: FlowStage, agent: AgentDef, signal: AbortSignal, clock: StageClock): (command: string) => Promise<{ ok: boolean; note?: string }> {
  let trusted = false;
  // The autonomy block of the run may let every command of a `shell: host` agent through; it is read when the stage opens its session, so a change applies from the next stage.
  const auto = choiceOn(autonomyOf(d.config(), flowKeyOf(run.squad)), 'hostCommands');
  // The command that ran under the autonomy is said as such, so the person keeps the mark that an agent had the machine's own shell without being asked.
  let spotted = false;
  const noteAuto = (command: string): void => {
    if (spotted) return;
    spotted = true;
    try {
      d.forum.append(runThreadId(run.id), { kind: 'system', author: { type: 'app' }, code: 'runner.command.autonomy', params: { agent: agent.id, n: 1, command: clipText(redact(command.replace(/\s+/g, ' ')), 300) }, stage: stage.id });
    } catch (e) {
      console.error('[runner] could not record an autonomous command', e instanceof Error ? e.message : e);
    }
  };
  return async (command) => {
    if (auto || trusted || clock.allowed.has(command)) {
      if (auto && !trusted) noteAuto(command);
      return { ok: true };
    }
    if (!d.askCommand || signal.aborted) return { ok: false };
    const resume = clock.pause();
    try {
      const answer = await d.askCommand({ run: run.id, stage: stage.id, agent: agent.id, command }, signal);
      if (answer.decision === 'stage') trusted = true;
      return { ok: answer.decision !== 'deny', note: answer.note };
    } finally {
      resume();
    }
  };
}

/**
 * @param usage Told what every model call of the attempt used, as it happens: a stage that fails or is stopped part-way has used it all the same.
 * @param carried The files the message that resumes the stage carries (the person's answer): the run file does not keep them, so they come from the turn that recorded the move.
 */
export async function executeStage(d: ExecutorDeps, run: Run, flow: FlowStage[], abort: AbortController, usage?: (u: UsageReport) => void, carried?: readonly AttachmentRef[]): Promise<StageRun> {
  const config = d.config();
  const { agent, stage, kind } = pickAgent(config, run, flow);
  if (!existsSync(run.worktree)) throw new StageError('worktree-gone');
  const writes = agent.permission === 'worktree';
  // A documentation run's agent writes only in `.coxia/`, and only if that is a real folder of the worktree: a link committed in its place would take every write away.
  if (writes && run.docs && !(await prepareDocsFolder(run.worktree))) throw new StageError('docs-folder-unsafe');
  // What a stage that runs commands needs from the clone (an agent's `npm test`, the commands the app runs before QA): a worktree made earlier gets it here too. It comes
  // before the sandbox is made, because the sandbox shares the folders those links point to.
  // A documentation run reads and writes text: it runs no code, so it needs none of the repository's dependencies.
  if ((writes || kind === 'qa') && !run.docs) await ensureDependencies(d, run, stage.id);
  // The watchdog is made with the agent call, after the session: until then a pause has nothing to stop.
  const clock: StageClock & { watch?: Watchdog } = { pause: () => clock.watch?.pause() ?? (() => undefined), beat: () => clock.watch?.beat(), allowed: new Set() };
  // A documentation run's agent gets no command door at all, whatever its `shell` says: the shell tool does not pass the guard that keeps its writes inside `.coxia/`.
  const session = !run.docs && (agent.shell === 'sandbox' || agent.shell === 'host') ? await openStageSandbox(d, run, stage, agent, writes, abort.signal, clock) : null;
  try {
    return await runStage(d, run, flow, abort, usage, carried, session, clock);
  } finally {
    // Whatever happened, nothing the stage started outlives it. Closing never throws, and a finished stage is not turned into a failed one by it.
    await session?.close().catch(() => undefined);
  }
}

/**
 * The confinement of a reading agent of a run: the run's worktree and the documentation folders the config lists outside it. `undefined` when there is no
 * worktree to be confined to (a call outside a run, or a stage whose worktree is gone): inventing a root would close the read over a folder that is not the run's.
 */
export function readConfinement(root: string, role: ModelRole, onDenied?: (denial: Denial) => void): ReadConfinement | undefined {
  if (!existsSync(root)) return undefined;
  const roots = extraReadRoots(root, role);
  return { root, roots, hooks: readConfinedHooks({ root, roots, onDenied }) };
}

async function runStage(d: ExecutorDeps, run: Run, flow: FlowStage[], abort: AbortController, usage: ((u: UsageReport) => void) | undefined, carried: readonly AttachmentRef[] | undefined, session: SandboxSession | null, clock?: StageClock & { watch?: Watchdog }): Promise<StageRun> {
  const config = d.config();
  const { agent, stage, kind } = pickAgent(config, run, flow);
  const wt = run.worktree;
  const writes = agent.permission === 'worktree';
  // The commands of the workspace's list, exactly as written: only for an agent that writes and is set to them (an agent saved before `shell` existed is).
  // A documentation run's agent runs none, whatever its `shell` says (no sandbox or host session is opened for it either): it reads with Read, Glob and Grep and writes only `.coxia/`.
  const commands = writes && !run.docs && (agent.shell ?? 'allowlist') === 'allowlist' ? (config.runner.commands ?? (await declaredCommands(wt, run.base))) : [];
  const threadId = runThreadId(run.id);
  const thread = d.forum.read(threadId, 0, 2000)?.messages ?? [];
  const attempt = run.stages.find((s) => s.stage === stage.id)?.attempts ?? 1;
  const looked = await headSha(wt);
  // The memory is born with the run, and a run that predates it gets the skeleton at its next stage, before the folder is read.
  const born = ensureMemory(wt, run.cycleFolder);
  // The conversation feeds the memory here, once per message (the marker makes it idempotent), so what the person answered and what a stage handed over survive the
  // 40-message window of the prompt. Tracked by the run's own commits, like the documents.
  const facts = factsOfThread(thread);
  const kept = readMemory(wt, run.cycleFolder) ?? '';
  const memory = applyFacts(kept, facts);
  const memoryTouched = memory !== kept ? writeMemory(wt, run.cycleFolder, memory) : born;

  // The comment this stage leaves on the tracker, and the pull request description when this stage ends with the push: the agent is told the
  // sections of the cycle's templates and writes the text of each, so no second call is needed.
  const askOf = (key: string | null): CommentAsk | null => {
    const tpl = key ? config.devCycle.comments[key] : undefined;
    return tpl ? { sections: tpl.sections, technical: tpl.technicalDetail } : null;
  };
  const comment = askOf(stage.comment);
  // The first stage of a flow is where an issue comes in: the agent that works it may ask the person who reported it what is missing.
  // A documentation run has no issue and so no one who reported it.
  const reporter = kind === 'work' && flow[0]?.id === stage.id && !run.docs;
  // A stage before development (intake, refinement) may propose the priority, from the levels the workspace can write to the tracker.
  // Only the stage that owns the priority proposes it; the earlier ones are told the levels and may suggest one in their documents.
  const levels = stage.kind === 'backlog' && kind === 'work' ? writableLabels(config.devCycle.priority.labels) : [];
  const owns = priorityStageOf(flow)?.id === stage.id;
  const priority = levels.length && owns ? levels : undefined;
  const priorityHint = levels.length && !owns ? levels : undefined;
  // The description of a documentation run's pull request has its own template: it closes no issue and says what was left out of the import.
  const pr = pushesAt(config, flow, stage.id) ? askOf(run.docs ? 'docs-pr' : 'pr') : null;
  // The front door of a run whose squad is not decided proposes it: the squads it may name, and why the scope rules left it open.
  const candidates = run.routing && flow[0]?.id === stage.id ? squadsOf(config).filter((q) => run.routing?.candidates.includes(q.id)) : [];
  const routing = run.routing && candidates.length ? { squads: candidates, why: run.routing.why } : undefined;

  // QA is a reader: it cannot run anything, so the app runs what the workspace allows before it and gives it the results.
  const qaCommands = kind === 'qa' && !writes ? (config.runner.commands ?? (await declaredCommands(wt, run.base))) : null;
  for (const c of qaCommands ?? []) clock?.allowed.add(c);
  const ran: CommandResult[] | undefined = qaCommands ? await runCommands(qaCommands, wt, session ? sessionRunner(session) : (d.commandRunner ?? runCommand), abort.signal) : undefined;
  // Inside a sandbox every command already told the thread as it ran; the app's own run before QA is announced as one line.
  if (ran?.length && !session) {
    const list = ran.map((r) => `${r.command} (${r.timedOut ? 'timeout' : (r.exitCode ?? '—')})`).join(', ');
    d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.qa.commands', params: { list }, stage: stage.id });
    // A command the environment could not start is said in the thread as such, so the person sees it was not the code that failed.
    const missed = notRunReport(ran);
    if (missed) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.qa.notRun', params: { list: missed.list }, stage: stage.id });
  }

  // What a repository with documentation asks of a run that changes code (keep it true in the same change) and of its review (point at the rule the branch left behind).
  // A repository with no `.coxia/` asks nothing, and a documentation run is the one that writes it.
  const documented = (await scanHarness(wt).catch(() => null))?.entries.length ? !run.docs : false;
  const behind = documented && kind === 'review' ? await behindOf(wt, run.base, run.cycleFolder).catch(() => []) : [];

  const input: StageInput = {
    run,
    stage,
    agent,
    config,
    kind,
    writes,
    commands,
    files: readFolder(wt, run.cycleFolder, stage.reads ?? null),
    memory: { over: memoryOver(memory), max: MEMORY_MAX },
    docsKeep: documented && writes,
    behind,
    plugins: d.pluginNotes?.() ?? [],
    thread: thread.slice(-40),
    attempt,
    handoff: pendingHandoff(thread, agent.id),
    answer: pendingAnswer(thread, agent.id, stage.id),
    resume: stageResume(run, stage, agent.id, thread, wt),
    comment,
    pr,
    reporter,
    priority,
    priorityHint,
    routing,
    squad: squadOf(config, run.squad),
    turnsTo: askTarget(config, agent),
    earlier: kind === 'review' ? run.reviews.filter((r) => r.stage === stage.id).slice(-4) : undefined,
    commandResults: ran,
    numberedCommands: !!session,
    evidence: !!(session?.stageDir && d.keepEvidence),
    sandbox: session
      ? {
          network: config.runner.sandbox.network,
          reader: !writes,
          host: agent.shell === 'host',
          ...(session.gui ? { gui: session.gui, look: offersViewImage(session) && config.llm.providers.find((p) => p.id === config.llm.roles[agent.model.role ?? 'deep']?.provider)?.capabilities?.images !== false } : {}),
        }
      : undefined,
    diff: kind === 'review' ? { text: await branchDiff(wt, run.base, run.cycleFolder), stat: await branchStat(wt, run.base, run.cycleFolder), clipped: false } : null,
    // A release run says which version it is about, the state of its branch and what is aimed at it, as of the stage's start.
    release: run.subject ? releaseSection(run, await releaseStateOf(wt, run.subject.version), config.language, () => null, crMarkOf(primaryIntegration(config)?.kind ?? null)) : undefined,
  };

  // A refusal is told to the thread the moment it happens, so the person sees what the agent tried even when the stage goes on.
  const denied = (den: Denial): void => {
    try {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.denied', params: { agent: agent.id, tool: den.tool, target: den.target || '—', reason: t(`main.runner.denied.${den.code}`) }, stage: stage.id });
    } catch (e) {
      console.error('[runner] could not record a refusal', e instanceof Error ? e.message : e);
    }
  };

  // The evidence a stage keeps while it works: each one is recorded with the run and published in its conversation, and the ids are what the stage output cites.
  const keptIds: string[] = [];
  const keptRecords: EvidenceRecord[] = [];
  const evidence =
    session?.stageDir && d.keepEvidence
      ? evidenceToolsOf({
          dataDir: d.dataDir(),
          stageDir: session.stageDir,
          run,
          stage: stage.id,
          by: agent.id,
          onKept: (record) => {
            keptIds.push(record.id);
            keptRecords.push(record);
            try {
              d.keepEvidence?.(run.id, record);
            } catch (e) {
              console.error('[runner] could not publish a piece of evidence', e instanceof Error ? e.message : e);
            }
          },
          now: () => new Date().toISOString(),
        })
      : undefined;
  // The agent of a documentation run reads the whole worktree and changes only `.coxia/`, which `executeStage` made sure exists as a real folder (a path guard needs its root to).
  const writeRoot = writes && run.docs ? join(wt, HARNESS_DIR) : undefined;

  const call: AgentCall = {
    agent,
    prompt: stagePrompt(input),
    schema: outputSchema(kind, { comment: !!comment, pr: !!pr, reporter, priority: !!priority, ask: !!askTarget(config, agent), squads: routing?.squads.map((q) => q.id), evidence: !!session, keepsEvidence: !!evidence }),
    system: systemText(input),
    cwd: wt,
    // The documentation of the repository (`.coxia/`) for this stage: chosen by the stage, the agent and the files the work touches. Nothing is read from git when there is none.
    docs: await runDocsAsk({ wt, base: run.base, cycleFolder: run.cycleFolder, stage: { id: stage.id, kind: stage.kind }, texts: input.files.map((f) => f.text) }),
    confine: writes ? { root: wt, ...(writeRoot ? { writeRoot, writeReserved: HARNESS_OWN } : {}), hooks: confinedHooks({ root: wt, writeRoot, writeReserved: writeRoot ? HARNESS_OWN : undefined, commands, onDenied: denied }) } : undefined,
    readRoot: writes ? undefined : readConfinement(wt, agent.model.role ?? 'deep', denied),
    exec: session ?? undefined,
    evidence,
    label: agent.id,
    maxTurns: writes ? config.runner.turns.write : config.runner.turns.read,
    abort,
    // The files of the answer the stage waits for: the agent opens them with the read-only tool, scoped to the run's conversation. They come from the
    // message the answer recorded (a run file never holds them); when this turn is running the stage the answer just resumed, from the move that recorded it.
    attachments: attachmentsFor(config, threadId, input.answer, carried),
    // The agent of a release run asks for the steps of the release through the app: the stage and the attempt say whose step it is, and its autonomy at the start decides what waits.
    release: run.subject && d.release ? (input) => (d.release as NonNullable<ExecutorDeps['release']>)(run.id, input, { by: agent.id, autonomous: run.stages.find((s) => s.stage === stage.id)?.autonomous ?? false, stage: stage.id, attempt }) : undefined,
  };
  const watch = watchdog(abort, limitsOf(config, d));
  if (clock) clock.watch = watch;
  call.beat = watch.beat;
  call.onUsage = usage;
  // The mailbox of the stage: a message addressed to this agent while it works enters the session between two steps. It is opened with the attempt and closed
  // before the sandbox, so nothing the stage hands over outlives it.
  const inbox = openInbox(run.id, stage.id, agent.id, d.forum, () => new Date().toISOString());
  call.incoming = async (delivered) => {
    const message = inbox.take();
    if (message !== null) delivered(message);
    return message;
  };
  // The tools of a stage that talks while it works. `SendMessage` posts in the run's conversation, internal to the run and without ending the stage; a message to
  // another agent that is working enters that agent's stage, as a message of the person would. `CallAgent` opens a conversation with another agent of the team,
  // refused when the agent is not of the team, is already in the chain, or the attempt has opened its limit of conversations.
  const chain = [agent.id];
  const conversationOf = new Map<string, { thread: string; say: (text: string) => void }>();
  const teamIds = config.agents.team.map((a) => a.id);
  // Every command a called agent that writes ran in its session, as the run's list of commands under that agent.
  const conversationCommands: CommandResult[] = [];
  const toolset: RunnerTools = {
    team: { ids: teamIds, caller: agent.id },
    sendMessage: (to, text) => (sendFromStage(d, run, stage, agent, inbox, to, text) ? t('main.runner.tools.sent') : t('main.runner.tools.notInTime')),
    askConversation: async () => '',
    callAgent: async (to, topic, place) => {
      const open = conversationOf.get(to);
      if (open) {
        open.say(topic);
        return t('main.runner.tools.conversationOpened', { called: to, thread: open.thread });
      }
      const called = config.agents.team.find((a) => a.id === to);
      if (!called) return t('main.runner.tools.unknownAgent', { to, list: teamIds.join(', ') });
      const refusal = callRefusal({ called: to, chain, opened: openedIn(run.id, stage.id), perStage: config.runner.conversations.perStage });
      if (refusal) return t(refusal === 'cycle' ? 'main.runner.tools.callRefusedCycle' : 'main.runner.tools.callRefusedCap', { called: to, cap: config.runner.conversations.perStage });
      countOpen(run.id, stage.id);
      chain.push(to);
      const pending: string[] = [topic];
      let wake: (() => void) | null = null;
      const incoming = async (): Promise<string | null> => {
        for (;;) {
          const next = pending.shift();
          if (next !== undefined) return next;
          if (abort.signal.aborted || inbox.isClosing) return null;
          await new Promise<void>((resolve) => (wake = resolve));
        }
      };
      const entry = {
        thread: runThreadId(run.id),
        say: (text: string): void => {
          pending.push(text);
          const w = wake;
          wake = null;
          w?.();
        },
      };
      conversationOf.set(to, entry);
      const writes = called.permission === 'worktree';
      const conversation: Parameters<typeof runConversation>[0] = {
        run,
        stage,
        caller: agent,
        called,
        forum: d.forum,
        config: d.config,
        engine: d.engine,
        openSession: (def, wr, clock) => (d.sandbox ? openStageSandbox(d, run, stage, def, wr, abort.signal, clock) : Promise.resolve(null)),
        commands,
        onUsage: usage,
        // A called agent that writes changes the worktree: what it changed is committed with the calling stage before the stage commits its own work.
        commit: writes
          ? async (message) => {
              const identity = await commitIdentity(config.runner.identity, wt, d.identity);
              if (!identity) return null;
              return commitAll(wt, message, identity);
            }
          : undefined,
        abort,
        chain,
        place,
        title: t('main.runner.conversation.title', { caller: agent.id, called: to, ref: run.issue.ref }),
      };
      // A conversation with a writer is the only writer of the worktree while it runs: the stage waits for it (its answers still come as messages), so the two
      // never write together, and the called agent's commands join the run's list under its name. A reader's conversation runs beside the stage as before.
      if (writes) {
        const r = await runConversation(conversation, { fromCaller: incoming, answered: (text) => inbox.post(text) });
        conversationOf.set(to, { thread: r.thread, say: entry.say });
        for (const e of r.log ?? []) {
          conversationCommands.push({ command: clipText(redact(e.command.replace(/\s+/g, ' ')), 300), exitCode: e.exitCode, timedOut: e.timedOut, output: e.output, ms: e.ms, n: e.n, by: 'agent' });
        }
      } else {
        void runConversation(conversation, { fromCaller: incoming, answered: (text) => inbox.post(text) })
          .then((r) => {
            conversationOf.set(to, { thread: r.thread, say: entry.say });
          })
          .catch((e: unknown) => {
            console.error('[runner] the conversation failed', run.id, to, e instanceof Error ? e.message : e);
          });
      }
      return t('main.runner.tools.conversationOpened', { called: to, thread: entry.thread });
    },
  };
  call.runnerTools = runnerTools(toolset, 'run');
  // A stage that talks shows a sign of life beyond the model events: a message comes in, someone answers the command question — the stage is alive even while the
  // agent waits on the person. `beat` is what the idle clock of the stage reads, and without it the time the person took to answer kills a stage that is working.
  const beat = call.beat ?? ((): void => undefined);
  call.beat = () => {
    beat();
    clock?.beat();
  };

  let data: unknown;
  try {
    data = (await watch.guard(withActivityContext(`run:${run.id}`, () => d.engine(call, commands)))).data;
  } catch (e) {
    if (e instanceof MaxTurnsError) throw new StageError('turns');
    if (e instanceof ProviderBudgetError) throw new StageError('budget', { provider: e.provider, engine: e.engine, detail: e.detail });
    throw e;
  } finally {
    // The stage begins finishing: a message that arrives now is not handed over and comes back in the thread with the reason.
    inbox.closing();
    inbox.close();
    // The attempt is over: the cap of conversations starts again, so a stage returned and run again may talk once more.
    resetOpened(run.id, stage.id);
    // The sandbox ends before the app reads or commits anything of the worktree: no process of the stage can race it.
    await session?.close();
  }

  const output = readOutput(data, kind);
  // The evidence ids the stage cites are kept only when this stage really kept them (or, for a QA pass, cites them beside its scenarios): an unknown id is told
  // in the conversation and dropped, never taken as proof of anything.
  const known = new Set([...keptIds, ...Object.keys(run.evidence ?? {})]);
  const cited = output.evidence.filter((id) => known.has(id));
  const unknownEvidence = output.evidence.filter((id) => !known.has(id));
  output.evidence = cited;
  for (const id of unknownEvidence) {
    d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.evidence.unknown', params: { agent: agent.id, id }, stage: stage.id });
  }
  if (kind === 'qa') {
    output.scenarios = output.scenarios.map((s) => (s.evidenceIds ? { ...s, evidenceIds: s.evidenceIds.filter((id) => known.has(id)) } : s));
  }
  // What QA claims to have executed is checked against what the stage's sandbox ran; with no sandbox every scenario was only read.
  // Only what the agent ran itself backs a claim: the app's own commands before QA are context, not the agent's evidence.
  if (kind === 'qa') output.scenarios = backEvidence(output.scenarios, (session?.log ?? []).map((e) => ({ n: e.n, exitCode: e.exitCode, timedOut: e.timedOut, by: e.n <= (ran?.length ?? 0) ? ('app' as const) : ('agent' as const) })), !!session);
  // Everything that ran in the stage's sandbox, in order: the app's own commands before QA, then the agent's. A called agent that wrote ran in its own session over
  // the same worktree, and its commands join the list under its name.
  const ranInSandbox: CommandResult[] | undefined = session ? [...session.log.filter((e) => !e.refused).map((e) => ({ command: clipText(redact(e.command.replace(/\s+/g, ' ')), 300), exitCode: e.exitCode, timedOut: e.timedOut, output: e.output, ms: e.ms, n: e.n, by: e.n <= (ran?.length ?? 0) ? ('app' as const) : ('agent' as const) })), ...conversationCommands] : conversationCommands.length ? conversationCommands : undefined;
  if (!output.summary && !output.question && !output.reporterQuestion) throw new StageError('empty-answer');

  const written: string[] = [];
  if (memoryTouched) written.push(MEMORY_FILE);
  for (const a of output.artifacts) {
    if (!stage.artifacts.includes(a.name)) {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.artifactIgnored', params: { agent: agent.id, name: a.name }, stage: stage.id });
      continue;
    }
    writeArtifact(wt, run.cycleFolder, a.name, tidyArtifact(a.content, run.issue));
    written.push(a.name);
  }
  if (output.question || output.reporterQuestion) return { kind, output, written, commit: null, head: looked, ...(keptRecords.length ? { keptEvidence: keptRecords } : {}), ...(ranInSandbox ? { commands: ranInSandbox } : ran ? { commands: ran } : {}) };

  // A stage that concludes rewrites the memory: normalized to the file's shape, masked, and with the conversation's markers reapplied so nothing the person said is lost.
  // A stage that pauses writes nothing: what it decided is not lost either, since the conversation carries it back in through `factsOfThread`.
  if (output.memory) {
    if (writeMemory(wt, run.cycleFolder, applyFacts(normalizeMemory(redact(output.memory)), facts)) && !written.includes(MEMORY_FILE)) written.push(MEMORY_FILE);
  }

  const missing = stage.artifacts.filter((n) => !written.includes(n) && !existsSync(join(wt, run.cycleFolder, n)));
  if (missing.length) throw new StageError('missing-artifacts', { names: missing.join(', ') });

  // With "also in the cycle folder", a copy of each piece of evidence the stage kept goes into the cycle folder before the commit, which then takes it. The copy is
  // made by the app from the stored evidence (never by re-reading the stage's output), and it is the only way a piece of evidence reaches a commit.
  if (evidencePlacementOf(config.runner) === 'cycle' && keptRecords.length) {
    for (const record of keptRecords) {
      if (copyToCycleFolder(run, record, d.dataDir())) {
        record.inCycle = true;
        d.updateEvidence?.(run.id, record);
      }
    }
  }

  const identity = await commitIdentity(config.runner.identity, wt, d.identity);
  if (!identity) throw new StageError('no-identity');
  // A pass of an agent that writes that changed no code is a pass of documents: what the agent said it fixed is not in the diff, and the commit does not claim it.
  const noCodeChange = writes && !(await changedOutside(wt, run.cycleFolder));
  if (noCodeChange) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.noCodeChange', params: { agent: agent.id }, stage: stage.id });
  // A stage that only writes documents never takes the agent's description for its commit: that describes code, and there is none.
  const code = writes && !noCodeChange;
  // i18n-ignore-next-line: the subject of a commit in the repository's history; a stage of the documentation flow is not "the draft the documentation changes"
  const fallback = run.docs && code ? 'update the project documentation' : commitFallback(stage.label, code);
  // The documentation the pass wrote (`.coxia/`) is checked before it is committed, so a local path or a credential never gets into the history; what was rewritten is told.
  const docs = writes ? await finalizeHarness(wt, { redact: redactDoc, redactCode }) : null;
  if (docs && (docs.paths || docs.secrets)) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.docs.checked', params: { paths: docs.paths, secrets: docs.secrets, files: docs.rewritten.map((f) => t('main.runner.docs.checked.file', { file: f.file, paths: f.paths, secrets: f.secrets })).join('; ') }, stage: stage.id });
  if (docs?.skipped.length) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.docs.notAFile', params: { files: docs.skipped.join(', ') }, stage: stage.id });
  for (const bad of docs?.invalid ?? []) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.docs.invalidHeader', params: { file: bad.file, reason: bad.reason }, stage: stage.id });
  const commit = await commitAll(wt, commitMessage(config.runner.commitMessage, code ? commitSummary(output.commit, fallback) : fallback, run.issue.iid), identity);
  // The files of the documentation this commit holds get the commit and the day they were checked, in a commit of their own: the agent cannot write a commit that does not exist yet.
  if (commit && docs?.stamp.length && (await stampHarness(wt, docs.stamp, commit)).length) await commitAll(wt, commitMessage(config.runner.commitMessage, STAMP_SUMMARY, run.issue.iid), identity);
  return { kind, output, written, commit, head: writes ? await headSha(wt) : looked, ...(noCodeChange ? { noCodeChange } : {}), ...(keptRecords.length ? { keptEvidence: keptRecords } : {}), ...(ranInSandbox ? { commands: ranInSandbox } : ran ? { commands: ran } : {}) };
}

