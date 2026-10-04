import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, MAX_MENTIONS } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { Run } from '../../shared/runs';
import { withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { ATAS } from '../env';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import { copyTree } from '../sandbox/copy';
import type { SandboxService, SandboxSession } from '../sandbox';
import { readFolder, type FolderFile } from '../runner/cycleFolder';
import { limitsOf, watchdog, type StageEngine } from '../runner/executor';
import { mentionCall, readProposedIssue, type ProposedIssue } from './call';
import { reposOnDisk, type MentionPlace } from './place';

// The answer an agent named in a message gives, wherever the person wrote (a run's thread, a channel, a general conversation). One owner per place: the runner
// owns the run's thread (it has the worktree, the cycle folder and the publisher) and calls this; the mentions module owns the rest. The agent never writes:
// the call has no confinement, whatever its permission; an agent set to run commands runs them over a throwaway copy of the code, and one that reads the code
// host may propose an issue, which waits in Actions.

/** What a mention answer needs; the place decides what the agent reads and where its commands run. */
export interface MentionDeps {
  forum: ForumStore;
  config: () => WorkspaceConfig;
  engine: StageEngine;
  /** The sandbox of the workspace; absent: an agent set to run commands answers without a session and the thread says why. */
  sandbox?: SandboxService;
  /** Where an agent with no place to run commands gets a working folder. */
  env: () => { fallbackCwd: string };
  /**
   * Opens the session an agent's commands run in, for a caller that has its own (the runner, over the run's worktree and its flow stage, with the person's yes
   * per host command). Absent: the mention opens the sandbox itself over the throwaway copy.
   */
  openSession?: (place: MentionPlace, def: AgentDef, cwd: string, stage: string | null, signal: AbortSignal, clock: { beat: () => void; pause: () => () => void }) => Promise<SandboxSession | null>;
  /** Only a run has one: where the issue the agent proposed waits. Without it, an issue the agent raises is not offered. */
  proposeIssue?: (runId: string, e: { key: string; title: string; body: string; labels: string[]; by: string; stage: string | null }) => Promise<unknown>;
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

/** Whether the agent may propose an issue: it reads the code host (its own tracker setting, or the default of its permission), and the place has a publisher. */
function proposesIssue(def: AgentDef, deps: MentionDeps, place: MentionPlace): boolean {
  if (place.kind !== 'run' || !deps.proposeIssue) return false;
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
  for (const id of message.mentions.slice(0, MAX_MENTIONS)) {
    const def = config.agents.team.find((a) => a.id === id);
    if (!def) continue;
    const reader: AgentDef = { ...def, permission: 'read' };
    const wantsCommands = def.shell === 'sandbox' || def.shell === 'host';
    const stage = place.kind === 'run' ? (place.run?.stage ?? null) : null;
    const abort = new AbortController();
    const watch = watchdog(abort, limitsOf(config));
    let session: SandboxSession | null = null;
    let source: { cwd: string; made: boolean; reader: boolean } | null = null;
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
        issue: proposesIssue(def, deps, place),
      });
      if (session) call.exec = session;
      call.beat = watch.beat;
      const r = await watch.guard(withActivityContext(place.kind === 'run' ? `run:${place.run?.id}` : `mention:${place.thread}`, () => deps.engine(call, [])));
      const text = typeof (r.data as { text?: unknown })?.text === 'string' ? (r.data as { text: string }).text.trim() : '';
      if (!text) throw new Error(t('main.runner.error.empty-answer'));
      deps.forum.append(place.thread, { kind: 'post', author: { type: 'agent', id }, text, stage, public: false });
      if (place.kind === 'run' && place.run) {
        const issue = proposesIssue(def, deps, place) ? readProposedIssue((r.data as { issue?: unknown }).issue) : null;
        if (issue) await proposeIssue(deps, place.run, message.seq, id, issue);
      }
      out.push({ agent: id, text });
    } catch (e) {
      const reason = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
      deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mentionFailed', params: { agent: id, reason }, stage });
    } finally {
      await session?.close().catch(() => undefined);
      if (source?.made) rmSync(source.cwd, { recursive: true, force: true });
    }
  }
  return out;
}

/** The proposal of an issue that waited in Actions, offered by the place's publisher (only a run has one). */
async function proposeIssue(deps: MentionDeps, run: Run, seq: number, agent: string, issue: ProposedIssue): Promise<void> {
  await deps.proposeIssue?.(run.id, { key: `${seq}-${agent}`, title: issue.title, body: issue.body, labels: issue.labels, by: agent, stage: run.stage });
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

/** Opens the session an agent's commands run in, over the throwaway folder `cwd` (already a copy), read only: a sandbox of this computer, or a host session. */
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
  if (def.shell === 'host') return sandbox.openHost({ worktree: source.cwd, reader: source.reader, config: config.runner.sandbox, onExec, signal });
  return sandbox.open({ worktree: source.cwd, reader: source.reader, config: config.runner.sandbox, onExec, signal });
}

