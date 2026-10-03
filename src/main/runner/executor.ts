import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { squadOf, squadsOf, turnTarget } from '../../shared/config/squads';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { type UsageReport, type FlowStage, type OutputKind, type Run, type StageOutput, outputKindOf, outputSchema, priorityStageOf, pushStageOf, readOutput } from '../../shared/runs';
import { withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { MaxTurnsError } from '../engine/contract';
import { writableLabels } from '../../shared/priority';
import type { ForumStore } from '../forum-core';
import { ISSUE_FILE, readFolder, tidyArtifact, writeArtifact } from './cycleFolder';
import { type Identity, branchDiff, branchStat, changedOutside, commitAll, commitFallback, commitMessage, commitSummary, declaredCommands, headSha, repoIdentity } from './git';
import { type CommandResult, type CommandRunner, runCommand, runCommands } from './commands';
import { type Denial, confinedHooks } from './hooks';
import { type CommentAsk, type StageInput, stagePrompt, systemText } from './prompt';

// One attempt at one stage: build what the agent reads, run it, write the documents it returned into the cycle folder and commit what it did.
// The agent never writes the documents nor commits: the app does both, so an agent that only reads can still produce its stage's documents, and
// the commits carry the workspace's identity. What the attempt means for the run (done, a question, findings) is the service's to apply.

export const STAGE_ERROR_CODES = ['no-stage', 'unknown-agent', 'worktree-gone', 'timeout', 'too-long', 'turns', 'empty-answer', 'missing-artifacts', 'no-identity', 'cancelled'] as const;
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
  /** The identity of a repository, when the workspace names none. */
  identity?: (wt: string) => Promise<Identity | null>;
  /** Runs the commands QA is given the results of (the real one by default). */
  commandRunner?: CommandRunner;
  /** Replaces `runner.stageIdleMs` and `runner.stageMaxMs` (tests). */
  timeoutMs?: number;
  /** Replaces one limit or the other (tests). */
  limits?: Partial<Limits>;
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
}

/**
 * Watches one agent call: the idle limit counts from the last `beat` (a call that keeps working never trips it) and the cap from the start, and both stop the
 * agent. Cancelling from outside makes the run stop waiting for an agent that may not notice.
 */
export function watchdog(abort: AbortController, limits: Limits): Watchdog {
  let idle: NodeJS.Timeout | undefined;
  let cap: NodeJS.Timeout | undefined;
  let fail: ((e: StageError) => void) | null = null;
  const stop = (e: StageError): void => {
    fail?.(e);
    abort.abort();
  };
  const arm = (): void => {
    clearTimeout(idle);
    idle = setTimeout(() => stop(new StageError('timeout', { minutes: minutes(limits.idleMs) })), limits.idleMs);
  };
  return {
    beat: () => {
      if (fail) arm();
    },
    async guard<T>(work: Promise<T>): Promise<T> {
      work.catch(() => undefined);
      const late = new Promise<never>((_, reject) => {
        fail = reject;
        arm();
        cap = setTimeout(() => stop(new StageError('too-long', { minutes: minutes(limits.maxMs) })), limits.maxMs);
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

/**
 * @param usage Told what every model call of the attempt used, as it happens: a stage that fails or is stopped part-way has used it all the same.
 */
export async function executeStage(d: ExecutorDeps, run: Run, flow: FlowStage[], abort: AbortController, usage?: (u: UsageReport) => void): Promise<StageRun> {
  const config = d.config();
  const { agent, stage, kind } = pickAgent(config, run, flow);
  if (!existsSync(run.worktree)) throw new StageError('worktree-gone');
  const wt = run.worktree;
  const writes = agent.permission === 'worktree';
  const commands = writes ? (config.runner.commands ?? (await declaredCommands(wt, run.base))) : [];
  const threadId = runThreadId(run.id);
  const thread = d.forum.read(threadId, 0, 2000)?.messages ?? [];
  const attempt = run.stages.find((s) => s.stage === stage.id)?.attempts ?? 1;
  const looked = await headSha(wt);

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
  const ran: CommandResult[] | undefined = kind === 'qa' && !writes ? await runCommands(config.runner.commands ?? (await declaredCommands(wt, run.base)), wt, d.commandRunner ?? runCommand, abort.signal) : undefined;
  if (ran?.length) {
    const list = ran.map((r) => `${r.command} (${r.timedOut ? 'timeout' : (r.exitCode ?? '—')})`).join(', ');
    d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.qa.commands', params: { list }, stage: stage.id });
  }

  const input: StageInput = {
    run,
    stage,
    agent,
    config,
    kind,
    writes,
    commands,
    files: readFolder(wt, run.cycleFolder).filter((f) => !stage.reads || f.name === ISSUE_FILE || stage.reads.includes(f.name)),
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
    diff: kind === 'review' ? { text: await branchDiff(wt, run.base, run.cycleFolder), stat: await branchStat(wt, run.base, run.cycleFolder), clipped: false } : null,
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
    schema: outputSchema(kind, { comment: !!comment, pr: !!pr, reporter, priority: !!priority, ask: !!askTarget(config, agent), squads: routing?.squads.map((q) => q.id) }),
    system: systemText(input),
    cwd: wt,
    confine: writes ? { root: wt, hooks: confinedHooks({ root: wt, commands, onDenied: denied }) } : undefined,
    label: agent.id,
    maxTurns: writes ? config.runner.turns.write : config.runner.turns.read,
    abort,
  };
  const watch = watchdog(abort, limitsOf(config, d));
  call.beat = watch.beat;
  call.onUsage = usage;

  let data: unknown;
  try {
    data = (await watch.guard(withActivityContext(`run:${run.id}`, () => d.engine(call, commands)))).data;
  } catch (e) {
    if (e instanceof MaxTurnsError) throw new StageError('turns');
    throw e;
  }

  const output = readOutput(data, kind);
  if (!output.summary && !output.question && !output.reporterQuestion) throw new StageError('empty-answer');

  const written: string[] = [];
  for (const a of output.artifacts) {
    if (!stage.artifacts.includes(a.name)) {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.artifactIgnored', params: { agent: agent.id, name: a.name }, stage: stage.id });
      continue;
    }
    writeArtifact(wt, run.cycleFolder, a.name, tidyArtifact(a.content, run.issue));
    written.push(a.name);
  }
  if (output.question || output.reporterQuestion) return { kind, output, written, commit: null, head: looked, ...(ran ? { commands: ran } : {}) };

  const missing = stage.artifacts.filter((n) => !written.includes(n) && !existsSync(join(wt, run.cycleFolder, n)));
  if (missing.length) throw new StageError('missing-artifacts', { names: missing.join(', ') });

  const identity = config.runner.identity.name.trim() ? { name: config.runner.identity.name.trim(), email: config.runner.identity.email.trim() } : await (d.identity ?? repoIdentity)(wt);
  if (!identity) throw new StageError('no-identity');
  // A pass of an agent that writes that changed no code is a pass of documents: what the agent said it fixed is not in the diff, and the commit does not claim it.
  const noCodeChange = writes && !(await changedOutside(wt, run.cycleFolder));
  if (noCodeChange) d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.noCodeChange', params: { agent: agent.id }, stage: stage.id });
  // A stage that only writes documents never takes the agent's description for its commit: that describes code, and there is none.
  const code = writes && !noCodeChange;
  const fallback = commitFallback(stage.label, code);
  const commit = await commitAll(wt, commitMessage(config.runner.commitMessage, code ? commitSummary(output.commit, fallback) : fallback, run.issue.iid), identity);
  return { kind, output, written, commit, head: writes ? await headSha(wt) : looked, ...(noCodeChange ? { noCodeChange } : {}), ...(ran ? { commands: ran } : {}) };
}

