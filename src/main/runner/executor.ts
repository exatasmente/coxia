import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { squadOf, squadsOf, turnTarget } from '../../shared/config/squads';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { type FlowStage, type OutputKind, type Run, type StageOutput, outputKindOf, outputSchema, priorityStageOf, pushStageOf, readOutput } from '../../shared/runs';
import { withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { MaxTurnsError } from '../engine/contract';
import { writableLabels } from '../../shared/priority';
import type { ForumStore } from '../forum-core';
import { ISSUE_FILE, readFolder, writeArtifact } from './cycleFolder';
import { type Identity, branchDiff, branchStat, changedOutside, commitAll, commitFallback, commitMessage, commitSummary, declaredCommands, headSha, repoIdentity } from './git';
import { type Denial, confinedHooks } from './hooks';
import { type CommentAsk, type StageInput, stagePrompt, systemText } from './prompt';

// One attempt at one stage: build what the agent reads, run it, write the documents it returned into the cycle folder and commit what it did.
// The agent never writes the documents nor commits: the app does both, so an agent that only reads can still produce its stage's documents, and
// the commits carry the workspace's identity. What the attempt means for the run (done, a question, findings) is the service's to apply.

export const STAGE_ERROR_CODES = ['no-stage', 'unknown-agent', 'worktree-gone', 'timeout', 'turns', 'empty-answer', 'missing-artifacts', 'no-identity', 'cancelled'] as const;
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
  /** Replaces `runner.stageTimeoutMs` (tests). */
  timeoutMs?: number;
}

export interface StageRun {
  kind: OutputKind;
  output: StageOutput;
  /** The documents written into the cycle folder. */
  written: string[];
  /** The commit this attempt made; null when nothing changed. */
  commit: string | null;
  /** An agent that changes files ended the pass with no change outside the cycle folder. */
  noCodeChange?: boolean;
  /** The branch's commit the agent looked at, before the app committed what the attempt produced: what a review or a QA pass is about. */
  head: string | null;
}

// Turns an agent may take in one attempt: a stage that changes code needs many more than one that reads and writes a document.
const TURNS = { write: 80, read: 30 };

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

export async function withLimit<T>(work: Promise<T>, abort: AbortController, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  work.catch(() => undefined);
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new StageError('timeout', { minutes: Math.max(1, Math.round(ms / 60_000)) }));
      abort.abort();
    }, ms);
    // Cancelled from outside: the run stops waiting for an agent that may not notice.
    abort.signal.addEventListener('abort', () => reject(new StageError('cancelled')));
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function executeStage(d: ExecutorDeps, run: Run, flow: FlowStage[], abort: AbortController): Promise<StageRun> {
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
    maxTurns: writes ? TURNS.write : TURNS.read,
    abort,
  };

  let data: unknown;
  try {
    data = (await withLimit(withActivityContext(`run:${run.id}`, () => d.engine(call, commands)), abort, d.timeoutMs ?? config.runner.stageTimeoutMs)).data;
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
    writeArtifact(wt, run.cycleFolder, a.name, a.content);
    written.push(a.name);
  }
  if (output.question || output.reporterQuestion) return { kind, output, written, commit: null, head: looked };

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
  return { kind, output, written, commit, head: writes ? await headSha(wt) : looked, ...(noCodeChange ? { noCodeChange } : {}) };
}

