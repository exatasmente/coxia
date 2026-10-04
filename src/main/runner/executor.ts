import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { squadOf, squadsOf, turnTarget } from '../../shared/config/squads';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { type CommandDecision, type UsageReport, type FlowStage, type OutputKind, type Run, type StageOutput, backEvidence, outputKindOf, outputSchema, priorityStageOf, pushStageOf, readOutput } from '../../shared/runs';
import { withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { MaxTurnsError } from '../engine/contract';
import { writableLabels } from '../../shared/priority';
import type { ForumStore } from '../forum-core';
import { MEMORY_FILE, ensureMemory, readFolder, readMemory, tidyArtifact, writeArtifact, writeMemory } from './cycleFolder';
import { MEMORY_MAX, applyFacts, factsOfThread, memoryOver, normalizeMemory } from './memory';
import { type Identity, branchDiff, branchStat, changedOutside, commitAll, commitFallback, commitIdentity, commitMessage, commitSummary, declaredCommands, headSha } from './git';
import { type CommandResult, type CommandRunner, notRunReport, runCommand, runCommands } from './commands';
import { ensureDependencies } from './dependencies';
import { recordWrite } from '../auditoria';
import { type ExecResult, type SandboxService, type SandboxSession, SandboxError } from '../sandbox';
import { redact } from '../errorlog-core';
import { type Denial, confinedHooks } from './hooks';
import { type CommentAsk, type StageInput, stagePrompt, systemText } from './prompt';
import { releaseSection, releaseStateOf } from './release';
import { crMarkOf } from '../../shared/i18n/terms';
import { primaryIntegration } from '../../shared/cycles/terms';

// One attempt at one stage: build what the agent reads, run it, write the documents it returned into the cycle folder and commit what it did.
// The agent never writes the documents nor commits: the app does both, so an agent that only reads can still produce its stage's documents, and
// the commits carry the workspace's identity. What the attempt means for the run (done, a question, findings) is the service's to apply.

export const STAGE_ERROR_CODES = ['no-stage', 'unknown-agent', 'worktree-gone', 'timeout', 'too-long', 'turns', 'empty-answer', 'missing-artifacts', 'no-identity', 'cancelled', 'no-sandbox'] as const;
export type StageErrorCode = (typeof STAGE_ERROR_CODES)[number];

export class StageError extends Error {
  constructor(
    readonly code: StageErrorCode,
    params: Record<string, string | number> = {},
  ) {
    super(t(`main.runner.error.${code}`, params));
    this.name = 'StageError';
  }
}

/** Runs one agent call; `commands` are what an agent that writes may execute. The real one is `runAgent` of agents.ts. */
export type StageEngine = (call: AgentCall, commands: string[]) => Promise<{ data: unknown }>;

export interface ExecutorDeps {
  engine: StageEngine;
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

/** The person's answer to the last question this agent asked in this stage, until the agent reports again. */
export function pendingAnswer(thread: ForumMessage[], agent: string, stage: string): { question: string; text: string; by: string } | null {
  const asked = [...thread].reverse().find((m) => m.kind === 'question' && m.author.type === 'agent' && m.author.id === agent && m.stage === stage);
  if (!asked) return null;
  const answered = thread.find((m) => m.kind === 'answer' && m.seq > asked.seq);
  if (!answered) return null;
  const reported = thread.some((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === agent && m.seq > answered.seq);
  return reported ? null : { question: asked.text, text: answered.text, by: answered.author.type === 'agent' ? answered.author.id : t(answered.author.type === 'app' ? 'main.runner.author.app' : 'main.runner.author.person') };
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
  try {
    if (host) return await d.sandbox.openHost({ worktree: run.worktree, reader: !writes, config: config.runner.sandbox, onExec: report, approve: hostApproval(d, run, stage, agent, signal, clock), signal });
    return await d.sandbox.open({ worktree: run.worktree, reader: !writes, config: config.runner.sandbox, onExec: report, onProxy, onNote, signal });
  } catch (e) {
    if (e instanceof SandboxError) throw new StageError('no-sandbox', { agent: agent.id, reason: e.message });
    throw e;
  }
}

/** What a host session needs from its stage: the watchdog, once it exists (a command waiting for the person stops its clocks), and the commands already allowed. */
export interface StageClock {
  pause(): () => void;
  /** The workspace's own commands the app runs before QA: the person listed them, so they run without asking, as on `allowlist`. */
  allowed: Set<string>;
}

/**
 * Every command of an agent set to `shell: host` waits for the person: "once" lets that one run, "stage" every one until the stage ends, "deny" refuses it (with
 * the person's note for the agent). The stage's clocks stand still meanwhile, so a person who answers later does not fail the stage.
 */
function hostApproval(d: ExecutorDeps, run: Run, stage: FlowStage, agent: AgentDef, signal: AbortSignal, clock: StageClock): (command: string) => Promise<{ ok: boolean; note?: string }> {
  let trusted = false;
  return async (command) => {
    if (trusted || clock.allowed.has(command)) return { ok: true };
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
 */
export async function executeStage(d: ExecutorDeps, run: Run, flow: FlowStage[], abort: AbortController, usage?: (u: UsageReport) => void): Promise<StageRun> {
  const config = d.config();
  const { agent, stage, kind } = pickAgent(config, run, flow);
  if (!existsSync(run.worktree)) throw new StageError('worktree-gone');
  const writes = agent.permission === 'worktree';
  // What a stage that runs commands needs from the clone (an agent's `npm test`, the commands the app runs before QA): a worktree made earlier gets it here too. It comes
  // before the sandbox is made, because the sandbox shares the folders those links point to.
  if (writes || kind === 'qa') await ensureDependencies(d, run, stage.id);
  // The watchdog is made with the agent call, after the session: until then a pause has nothing to stop.
  const clock: StageClock & { watch?: Watchdog } = { pause: () => clock.watch?.pause() ?? (() => undefined), allowed: new Set() };
  const session = agent.shell === 'sandbox' || agent.shell === 'host' ? await openStageSandbox(d, run, stage, agent, writes, abort.signal, clock) : null;
  try {
    return await runStage(d, run, flow, abort, usage, session, clock);
  } finally {
    // Whatever happened, nothing the stage started outlives it. Closing never throws, and a finished stage is not turned into a failed one by it.
    await session?.close().catch(() => undefined);
  }
}

async function runStage(d: ExecutorDeps, run: Run, flow: FlowStage[], abort: AbortController, usage: ((u: UsageReport) => void) | undefined, session: SandboxSession | null, clock?: { watch?: Watchdog; allowed: Set<string> }): Promise<StageRun> {
  const config = d.config();
  const { agent, stage, kind } = pickAgent(config, run, flow);
  const wt = run.worktree;
  const writes = agent.permission === 'worktree';
  // The commands of the workspace's list, exactly as written: only for an agent that writes and is set to them (an agent saved before `shell` existed is).
  const commands = writes && (agent.shell ?? 'allowlist') === 'allowlist' ? (config.runner.commands ?? (await declaredCommands(wt, run.base))) : [];
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
  const reporter = kind === 'work' && flow[0]?.id === stage.id;
  // A stage before development (intake, refinement) may propose the priority, from the levels the workspace can write to the tracker.
  // Only the stage that owns the priority proposes it; the earlier ones are told the levels and may suggest one in their documents.
  const levels = stage.kind === 'backlog' && kind === 'work' ? writableLabels(config.devCycle.priority.labels) : [];
  const owns = priorityStageOf(flow)?.id === stage.id;
  const priority = levels.length && owns ? levels : undefined;
  const priorityHint = levels.length && !owns ? levels : undefined;
  const pr = pushStageOf(config, flow)?.id === stage.id ? askOf('pr') : null;
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
    thread: thread.slice(-40),
    attempt,
    handoff: pendingHandoff(thread, agent.id),
    answer: pendingAnswer(thread, agent.id, stage.id),
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
    sandbox: session ? { network: config.runner.sandbox.network, reader: !writes, host: agent.shell === 'host' } : undefined,
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

  const call: AgentCall = {
    agent,
    prompt: stagePrompt(input),
    schema: outputSchema(kind, { comment: !!comment, pr: !!pr, reporter, priority: !!priority, ask: !!askTarget(config, agent), squads: routing?.squads.map((q) => q.id), evidence: !!session }),
    system: systemText(input),
    cwd: wt,
    confine: writes ? { root: wt, hooks: confinedHooks({ root: wt, commands, onDenied: denied }) } : undefined,
    exec: session ?? undefined,
    label: agent.id,
    maxTurns: writes ? config.runner.turns.write : config.runner.turns.read,
    abort,
    // The agent of a release run asks for the steps of the release through the app: the stage and the attempt say whose step it is, and its autonomy at the start decides what waits.
    release: run.subject && d.release ? (input) => (d.release as NonNullable<ExecutorDeps['release']>)(run.id, input, { by: agent.id, autonomous: run.stages.find((s) => s.stage === stage.id)?.autonomous ?? false, stage: stage.id, attempt }) : undefined,
  };
  const watch = watchdog(abort, limitsOf(config, d));
  if (clock) clock.watch = watch;
  call.beat = watch.beat;
  call.onUsage = usage;

  let data: unknown;
  try {
    data = (await watch.guard(withActivityContext(`run:${run.id}`, () => d.engine(call, commands)))).data;
  } catch (e) {
    if (e instanceof MaxTurnsError) throw new StageError('turns');
    throw e;
  } finally {
    // The sandbox ends before the app reads or commits anything of the worktree: no process of the stage can race it.
    await session?.close();
  }

  const output = readOutput(data, kind);
  // What QA claims to have executed is checked against what the stage's sandbox ran; with no sandbox every scenario was only read.
  // Only what the agent ran itself backs a claim: the app's own commands before QA are context, not the agent's evidence.
  if (kind === 'qa') output.scenarios = backEvidence(output.scenarios, (session?.log ?? []).map((e) => ({ n: e.n, exitCode: e.exitCode, timedOut: e.timedOut, by: e.n <= (ran?.length ?? 0) ? ('app' as const) : ('agent' as const) })), !!session);
  // Everything that ran in the stage's sandbox, in order: the app's own commands before QA, then the agent's.
  const ranInSandbox: CommandResult[] | undefined = session ? session.log.filter((e) => !e.refused).map((e) => ({ command: clipText(redact(e.command.replace(/\s+/g, ' ')), 300), exitCode: e.exitCode, timedOut: e.timedOut, output: e.output, ms: e.ms, n: e.n, by: e.n <= (ran?.length ?? 0) ? ('app' as const) : ('agent' as const) })) : undefined;
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
  if (output.question || output.reporterQuestion) return { kind, output, written, commit: null, head: looked, ...(ranInSandbox ? { commands: ranInSandbox } : ran ? { commands: ran } : {}) };

  // A stage that concludes rewrites the memory: normalized to the file's shape, masked, and with the conversation's markers reapplied so nothing the person said is lost.
  // A stage that pauses writes nothing: what it decided is not lost either, since the conversation carries it back in through `factsOfThread`.
  if (output.memory) {
    if (writeMemory(wt, run.cycleFolder, applyFacts(normalizeMemory(redact(output.memory)), facts)) && !written.includes(MEMORY_FILE)) written.push(MEMORY_FILE);
  }

  const missing = stage.artifacts.filter((n) => !written.includes(n) && !existsSync(join(wt, run.cycleFolder, n)));
  if (missing.length) throw new StageError('missing-artifacts', { names: missing.join(', ') });

  const identity = await commitIdentity(config.runner.identity, wt, d.identity);
  if (!identity) throw new StageError('no-identity');
  // A pass of an agent that writes that changed no code is a pass of documents: what the agent said it fixed is not in the diff, and the commit does not claim it.
  const noCodeChange = writes && !(await changedOutside(wt, run.cycleFolder));
  if (noCodeChange) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.noCodeChange', params: { agent: agent.id }, stage: stage.id });
  // A stage that only writes documents never takes the agent's description for its commit: that describes code, and there is none.
  const code = writes && !noCodeChange;
  const fallback = commitFallback(stage.label, code);
  const commit = await commitAll(wt, commitMessage(config.runner.commitMessage, code ? commitSummary(output.commit, fallback) : fallback, run.issue.iid), identity);
  return { kind, output, written, commit, head: writes ? await headSha(wt) : looked, ...(noCodeChange ? { noCodeChange } : {}), ...(ranInSandbox ? { commands: ranInSandbox } : ran ? { commands: ran } : {}) };
}

