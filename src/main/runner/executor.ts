import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { type FlowStage, type OutputKind, type Run, type StageOutput, outputKindOf, outputSchema, readOutput } from '../../shared/runs';
import { withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { MaxTurnsError } from '../engine/contract';
import type { ForumStore } from '../forum-core';
import { readFolder, writeArtifact } from './cycleFolder';
import { type Identity, branchDiff, branchStat, commitAll, commitMessage, commitSummary, declaredCommands, headSha, repoIdentity } from './git';
import { type Denial, confinedHooks } from './hooks';
import { type StageInput, stagePrompt, systemText } from './prompt';

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

export function pickAgent(config: WorkspaceConfig, run: Run, flow: FlowStage[]): Picked {
  const stage = flow.find((s) => s.id === run.stage);
  if (!stage || !stage.agent) throw new StageError('no-stage', { stage: run.stage });
  const agent = config.agents.team.find((a) => a.id === stage.agent);
  if (!agent) throw new StageError('unknown-agent', { agent: stage.agent });
  return { agent, stage, kind: outputKindOf(config.devCycle.stages.find((s) => s.id === stage.id)?.kind ?? 'development') };
}

/** The last note another stage left for `agent` that it has not answered with a post since. */
export function pendingHandoff(thread: ForumMessage[], agent: string): { from: string; text: string } | null {
  const lastPost = Math.max(0, ...thread.filter((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === agent).map((m) => m.seq));
  const note = [...thread].reverse().find((m) => m.kind === 'handoff' && m.to === agent && m.seq > lastPost);
  return note ? { from: note.author.type === 'agent' ? note.author.id : note.author.type, text: note.text } : null;
}

/** The person's answer to the last question this agent asked in this stage, until the agent reports again. */
export function pendingAnswer(thread: ForumMessage[], agent: string, stage: string): { question: string; text: string } | null {
  const asked = [...thread].reverse().find((m) => m.kind === 'question' && m.author.type === 'agent' && m.author.id === agent && m.stage === stage);
  if (!asked) return null;
  const answered = thread.find((m) => m.kind === 'answer' && m.seq > asked.seq);
  if (!answered) return null;
  const reported = thread.some((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === agent && m.seq > answered.seq);
  return reported ? null : { question: asked.text, text: answered.text };
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
  const commands = writes ? (config.runner.commands ?? declaredCommands(wt)) : [];
  const threadId = runThreadId(run.id);
  const thread = d.forum.read(threadId, 0, 2000)?.messages ?? [];
  const attempt = run.stages.find((s) => s.stage === stage.id)?.attempts ?? 1;
  const looked = await headSha(wt);

  const input: StageInput = {
    run,
    stage,
    agent,
    config,
    kind,
    writes,
    commands,
    files: readFolder(wt, run.cycleFolder),
    thread: thread.slice(-40),
    attempt,
    handoff: pendingHandoff(thread, agent.id),
    answer: pendingAnswer(thread, agent.id, stage.id),
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
    schema: outputSchema(kind),
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
  if (!output.summary && !output.question) throw new StageError('empty-answer');

  const written: string[] = [];
  for (const a of output.artifacts) {
    if (!stage.artifacts.includes(a.name)) {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.artifactIgnored', params: { agent: agent.id, name: a.name }, stage: stage.id });
      continue;
    }
    writeArtifact(wt, run.cycleFolder, a.name, a.content);
    written.push(a.name);
  }
  if (output.question) return { kind, output, written, commit: null, head: looked };

  const missing = stage.artifacts.filter((n) => !written.includes(n) && !existsSync(join(wt, run.cycleFolder, n)));
  if (missing.length) throw new StageError('missing-artifacts', { names: missing.join(', ') });

  const identity = config.runner.identity.name.trim() ? { name: config.runner.identity.name.trim(), email: config.runner.identity.email.trim() } : await (d.identity ?? repoIdentity)(wt);
  if (!identity) throw new StageError('no-identity');
  // i18n-ignore-start: the subject of a commit in the repository's history: English, like the rest of its commits
  const fallback = writes ? `apply the ${stage.label.toLowerCase()} changes` : `add the ${stage.label.toLowerCase()} documents`;
  // i18n-ignore-end
  const commit = await commitAll(wt, commitMessage(config.runner.commitMessage, commitSummary(output.commit, fallback), run.issue.iid), identity);
  return { kind, output, written, commit, head: writes ? await headSha(wt) : looked };
}

