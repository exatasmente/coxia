import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, MAX_MENTIONS } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { Run } from '../../shared/runs';
import { type RunActivity, withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { ATAS } from '../env';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import { copyTree } from '../sandbox/copy';
import type { SandboxService, SandboxSession } from '../sandbox';
import { readFolder, type FolderFile } from '../runner/cycleFolder';
import { limitsOf, watchdog, type StageEngine } from '../runner/executor';
import { mentionCall, readProposedWrites, type ProposedWrite } from './call';
import { type ProposalOutcome } from './propose';
import { reposOnDisk, type MentionPlace } from './place';

// The answer an agent named in a message gives, wherever the person wrote (a run's thread, a channel, a general conversation, the direct conversation of an agent).
// One owner per place: the runner owns the run's thread (it has the worktree, the cycle folder and the publisher) and calls this; the mentions module owns the rest.
// The agent never writes: the call has no confinement, whatever its permission; an agent set to run commands runs them over a throwaway copy of the code, and one that
// reads the code host may propose writes, which wait in Actions (or, for a low-risk write and an autonomous agent, go out audited).

/** What a mention answer needs; the place decides what the agent reads and where its commands run. */
export interface MentionDeps {
  forum: ForumStore;
  config: () => WorkspaceConfig;
  engine: StageEngine;
  /** The sandbox of the workspace; absent: an agent set to run commands answers without a session and the thread says why. */
  sandbox?: SandboxService;
  /** Where an agent with no place to run commands gets a working folder. */
  env: () => { fallbackCwd: string };
  /** The session an agent's commands run in, for a caller that has its own (the runner, over the run's worktree and its flow stage, with the person's yes per host command). Absent: the mention opens the sandbox itself over the throwaway copy. */
  openSession?: (place: MentionPlace, def: AgentDef, cwd: string, stage: string | null, signal: AbortSignal, clock: { beat: () => void; pause: () => () => void }) => Promise<SandboxSession | null>;
  /**
   * The line a caller opened for an agent's call when the message was accepted (a run's thread), and whether it waited its turn there: the answer goes on in it,
   * so the engine reports only how it ends. Absent, or null for an agent: the engine opens its own line when it starts.
   */
  callOf?: (agent: string) => { activity: RunActivity; queued: boolean } | null;
  /** Called once per agent named, when its call is over (answered, failed or not of the team), so the caller lets the next call begin. */
  release?: (agent: string) => void;
  /** Whether the agent's provider is held (its key ran out of budget, a run's thread): the answer spends no call, and the thread says why. */
  held?: (def: AgentDef) => { provider: string; reason: string } | null;
  /**
   * Where the writes a response raises are proposed, wherever the agent answers (a run's thread, a channel, a general conversation, the direct conversation of an
   * agent): the mentions module's own path outside a run's thread (`proposeMention`), which plans each write by the host. Absent: the answer may not propose anything.
   */
  propose?: (e: { writes: ProposedWrite[]; place: MentionPlace; agent: AgentDef; autonomous: boolean; config: WorkspaceConfig; issue: number; seq: number; runId?: string | null }) => Promise<ProposalOutcome[]>;
  /**
   * The agents to answer, in order, already resolved by the caller: the names the message wrote, and, in the direct conversation of an agent, its owner first, even
   * without an `@`. Absent: the mentions the message carries.
   */
  calls?: readonly string[];
}

/** What a mention answer produced, for a caller that records it elsewhere (a ceremony). */
export interface MentionAnswer {
  agent: string;
  text: string;
}

/** A folder of the workspace's own data where the throwaway copy of an answer's commands is made; the sandbox's own folders live beside it. */
const draftDir = (thread: string, seq: number, agent: string): string => join(ATAS, 'sandbox', 'mention', thread.replace(/[^\w-]/g, '_').slice(0, 60), `${seq}-${agent}`);

/** The repository titles of a place on disk, in the config's order. */
const repoTitles = (place: MentionPlace): string[] => reposOnDisk(place).map((r) => r.id);

/** The files a run's thread gives the agent (the cycle folder, the issue record first). */
function runFiles(run: Run): FolderFile[] {
  return existsSync(run.worktree) ? readFolder(run.worktree, run.cycleFolder) : [];
}

/** What the answer's system text and files are, by place. */
function inputOf(place: MentionPlace): { files: FolderFile[]; ref?: string; title?: string; mission?: string | null; repos: string[] } {
  if (place.kind === 'run' && place.run) {
    const run = place.run;
    return { files: runFiles(run), ref: run.issue.ref, title: run.issue.title, repos: [run.repo] };
  }
  return { files: [], ref: place.ref, title: place.title, mission: place.squad?.mission ?? null, repos: repoTitles(place) };
}

/** Whether the agent may propose writes: it reads the code host (its own tracker setting, or the default of its permission), and the place has a propose path. */
function mayPropose(def: AgentDef, deps: MentionDeps, place: MentionPlace): boolean {
  if (!deps.propose) return false;
  return (def.tracker ?? (def.permission === 'worktree' ? 'none' : 'read')) === 'read';
}

/**
 * The answer to one message: each agent named (up to `MAX_MENTIONS`) answers in the thread of the place, read only, and one that runs commands runs them over
 * a throwaway copy of the code. A failure of one agent is said in the thread and does not stop the others. Returns what each agent said, for a caller (a ceremony)
 * that records the answers somewhere other than a thread.
 */
export async function answerMentions(place: MentionPlace, message: ForumMessage, deps: MentionDeps): Promise<MentionAnswer[]> {
  const config = deps.config();
  const out: MentionAnswer[] = [];
  const calls = (deps.calls ?? message.mentions).slice(0, MAX_MENTIONS);
  for (const id of calls) {
    const def = config.agents.team.find((a) => a.id === id);
    if (!def) {
      deps.release?.(id);
      continue;
    }
    const made = deps.callOf?.(id) ?? null;
    const hold = deps.held?.(def) ?? null;
    if (hold) {
      deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mention.budget', params: { agent: id, provider: hold.provider, reason: hold.reason }, stage: place.kind === 'run' ? (place.run?.stage ?? null) : null });
      // The line the caller opened would wait forever: nothing runs, so it ends here, with the reason.
      made?.activity.status('failed', hold.reason);
      deps.release?.(id);
      continue;
    }
    const reader: AgentDef = { ...def, permission: 'read' };
    const wantsCommands = def.shell === 'sandbox' || def.shell === 'host';
    const stage = place.kind === 'run' ? (place.run?.stage ?? null) : null;
    const abort = new AbortController();
    const watch = watchdog(abort, limitsOf(config));
    let session: SandboxSession | null = null;
    let source: { cwd: string; made: boolean; reader: boolean } | null = null;
    // Whether the engine got to run: what failed before it is the call's own failure, and its line must not wait forever.
    let ran = false;
    try {
      if (wantsCommands) {
        source = await shellSourceOf(place, def, message.seq, abort.signal);
        if (!source) {
          deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mention.noShell', params: { agent: id, reason: t('main.mentions.noRepo') }, stage });
        } else {
          session = await (deps.openSession ? deps.openSession(place, def, source.cwd, stage, abort.signal, { beat: watch.beat, pause: watch.pause }) : openMentionSession(deps, def, source, place.thread, abort.signal)).catch((e: unknown) => {
            deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mention.noShell', params: { agent: id, reason: redact(e instanceof Error ? e.message : String(e)).slice(0, 300) }, stage });
            return null;
          });
        }
      }
      const info = inputOf(place);
      const call: AgentCall = mentionCall({
        agent: reader,
        config,
        message,
        thread: deps.forum.read(place.thread, 0, 2000)?.messages ?? [],
        files: info.files,
        cwd: source?.cwd ?? deps.env().fallbackCwd,
        ref: info.ref,
        title: info.title,
        mission: info.mission,
        repos: info.repos,
        place: place.kind === 'run' ? 'run' : place.kind,
        shell: session ? { host: def.shell === 'host', network: config.runner.sandbox.network } : undefined,
        proposals: mayPropose(def, deps, place),
        autonomous: autonomyOf(config, def),
      });
      if (made) call.activity = made.activity;
      if (session) call.exec = session;
      call.beat = watch.beat;
      // The call waited its turn: it says it is working now, when it really begins.
      if (made?.queued) made.activity.status('started');
      ran = true;
      const r = await watch.guard(withActivityContext(place.kind === 'run' ? `run:${place.run?.id}` : `mention:${place.thread}`, () => deps.engine(call, [])));
      const text = typeof (r.data as { text?: unknown })?.text === 'string' ? (r.data as { text: string }).text.trim() : '';
      if (!text) throw new Error(t('main.runner.error.empty-answer'));
      deps.forum.append(place.thread, { kind: 'post', author: { type: 'agent', id }, text, stage, public: false });
      if (mayPropose(def, deps, place)) await raiseWrites(deps, place, def, message.seq, id, readProposedWrites((r.data as { proposals?: unknown }).proposals));
      if (r.partial) deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.partial', params: { agent: id }, stage });
      out.push({ agent: id, text });
    } catch (e) {
      const reason = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
      // Nothing ran, so the engine reported no end: the call fails here, or its line would stay on screen.
      if (!ran) made?.activity.status('failed', reason);
      deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mentionFailed', params: { agent: id, reason }, stage });
    } finally {
      await session?.close().catch(() => undefined);
      if (source?.made) rmSync(source.cwd, { recursive: true, force: true });
      deps.release?.(id);
    }
  }
  return out;
}

/** Whether the agent is autonomous now: the team's current entry, which a change in Settings updates, before the definition the call started with. */
const autonomyOf = (config: WorkspaceConfig, def: AgentDef): boolean => config.agents.team.find((a) => a.id === def.id)?.autonomous ?? def.autonomous;

/**
 * The writes an answer raised, offered wherever the place proposes them: every place plans each write with the provider and puts it in Actions (or lets a low-risk one
 * out when the agent is autonomous), a run's thread included, whose target is its issue. A host with no such operation and a write that could not be planned are said in
 * the thread, and nothing is written.
 */
async function raiseWrites(deps: MentionDeps, place: MentionPlace, def: AgentDef, seq: number, agent: string, writes: ProposedWrite[]): Promise<void> {
  if (!writes.length || !deps.propose) return;
  const stage = place.kind === 'run' ? (place.run?.stage ?? null) : null;
  const config = deps.config();
  const autonomous = autonomyOf(config, def);
  // A run's thread registers its proposals on the run's issue and names the run, so the runner keeps reporting what became of them; any other place registers on
  // the workspace's issue project, which every write of the app registers under.
  const run = place.kind === 'run' ? place.run : null;
  const outcomes = await deps.propose({ writes, place, agent: def, autonomous, config, issue: run ? run.issue.iid : 0, runId: run?.id ?? null, seq });
  const line = (code: string, params: Record<string, string | number>): void => {
    deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code, params, stage });
  };
  for (const o of outcomes) {
    if (o.status === 'unsupported') line('runner.mention.unsupported', { agent, op: o.op, reason: o.reason });
    else if (o.status === 'failed') line('runner.mention.proposalFailed', { agent, reason: o.reason });
    else if (o.status === 'auto') line('runner.mention.autoWrote', { agent, what: o.summary });
    else line('runner.mention.proposed', { agent, count: o.count, what: o.summary });
  }
}

/**
 * Where an agent's commands run. A run's thread: its worktree, and the session reads from it. Anywhere else: a throwaway copy of the place's repositories, made
 * under the workspace's data (the one repository itself in a folder, or one subfolder per repository), which the caller removes when the answer ends. `null`
 * when the place has no repository on disk (a ceremony, or a place with none): the agent answers without commands and the thread says why.
 */
async function shellSourceOf(place: MentionPlace, def: AgentDef, seq: number, signal: AbortSignal): Promise<{ cwd: string; made: boolean; reader: boolean } | null> {
  if (place.kind === 'run' && place.run && existsSync(place.run.worktree)) return { cwd: place.run.worktree, made: false, reader: true };
  const repos = reposOnDisk(place);
  if (!repos.length) return null;
  const dir = draftDir(place.thread, seq, def.id);
  mkdirSync(dir, { recursive: true });
  // One repository: its copy is the working folder itself; several: one subfolder per repository, and the folder holds them all.
  for (const repo of repos) await copyTree(repo.path, repos.length === 1 ? dir : join(dir, repo.id), 1024 * 1024 * 1024, signal);
  return { cwd: dir, made: true, reader: false };
}

/**
 * Opens the session an agent's commands run in, over the throwaway folder `cwd` (already a copy), read only: a sandbox of this computer, or a host session. A host
 * session keeps the same limit as a run's thread: every command waits for the person, and without the app to ask it is refused, never run unattended.
 */
function openMentionSession(deps: MentionDeps, def: AgentDef, source: { cwd: string; reader: boolean }, thread: string, signal: AbortSignal): Promise<SandboxSession> {
  const sandbox = deps.sandbox;
  if (!sandbox) return Promise.reject(new Error(t('main.mentions.noRepo')));
  const config = deps.config();
  const onExec = (r: { n: number; command: string; exitCode: number | null; timedOut: boolean; ms: number; output: string; refused?: string }): void => {
    try {
      deps.forum.append(thread, {
        kind: 'system',
        author: { type: 'app' },
        code: 'runner.exec',
        params: { agent: def.id, n: r.n, command: redact(r.command.replace(/\s+/g, ' ')).slice(0, 300), result: r.refused ? t('main.runner.exec.refused.denied') : r.timedOut ? t('main.runner.exec.timeout') : r.exitCode === null ? t('main.runner.exec.notRun') : t('main.runner.exec.exit', { code: r.exitCode }), ms: Math.round(r.ms / 100) / 10, tail: r.output.slice(0, 600) || '—' },
      });
    } catch {
      // A note that cannot be recorded does not stop the answer.
    }
  };
  // A host command runs on the person's computer: like a run's thread, each one waits for their yes; a mention place has no screen to ask on today, so it is refused
  // rather than run unattended.
  const approve = (_command: string): Promise<{ ok: boolean }> => Promise.resolve({ ok: false });
  if (def.shell === 'host') return sandbox.openHost({ worktree: source.cwd, reader: source.reader, config: config.runner.sandbox, onExec, approve, signal });
  return sandbox.open({ worktree: source.cwd, reader: source.reader, config: config.runner.sandbox, onExec, signal });
}

