import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { workingTeam } from '../../shared/config/team';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import type { AttachmentRef } from '../../shared/attachments';
import { type ForumMessage, MAX_MENTIONS } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { Run } from '../../shared/runs';
import { mentionJob } from '../../shared/activity';
import { type RunActivity, withActivityContext } from '../activity';
import type { AgentCall } from '../agents';
import { type ReadConfinement, ProviderBusyError, poolBusyParams, poolNoticeLine } from '../engine/contract';
import { callKey } from '../../shared/browser';
import { type CallScreen, type CallScreenRequest, type ScreenPorts, beginHandoff, modelSeesImages, offerHandoff, openCallScreen, promptFor } from '../browser/callScreen';
import { countsText } from '../browser/audit';
import { grantsFor, withheldText } from '../browser/guard';
import { createHostsTally, safeHost, summaryParams } from '../browser/hosts';
import type { ProxyDecision } from '../sandbox/proxy';
import { recordWrite } from '../auditoria';
import { ATAS } from '../env';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import { copyTracked } from '../sandbox/copy';
import { dependencyFolders } from '../runner/dependencies';
import type { SandboxService, SandboxSession } from '../sandbox';
import { readFolder, type FolderFile } from '../runner/cycleFolder';
import { limitsOf, watchdog, type StageEngine } from '../runner/executor';
import { mentionCall, readProposedWrites, type ProposedWrite } from './call';
import { conversationCallTool } from './converse';
import { type ProposalOutcome } from './propose';
import { type Binding, type BindingCell, type KeptSessions, type KeptShell, type ShellSource, keptSessions } from './kept';
import { type CallStops, callStops } from './stop';
import { reposOnDisk, runRepo, type MentionPlace } from './place';
import { type DocsAsk, runDocsAsk, stageOfRun } from '../harness/deliver';
import type { MemoryPort } from '../memory/port';
import type { MemorySession } from '../memory/session';
import type { ProceduresPort } from '../procedures/port';
import type { ProcedureOffers } from '../procedures/offers';
import { raiseOffers, runWrapUp } from '../procedures/wrapup';
import { procedureScreen } from '../procedures/screen';
import type { ProcedureSession } from '../procedures/session';

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
  openSession?: (
    place: MentionPlace,
    def: AgentDef,
    cwd: string,
    stage: string | null,
    signal: AbortSignal,
    clock: { beat: () => void; pause: () => () => void },
    wants?: { display: boolean; held?: () => boolean; mask?: (text: string) => string },
  ) => Promise<SandboxSession | null>;
  /** The agents' screens (the app's browser) and the questions they ask the person; absent, or null before the app has them: no agent gets one here. */
  screens?: () => ScreenPorts | null;
  /** The shell sessions kept for the screens that are open (default: this process's). */
  kept?: KeptSessions;
  /** Where a running answer can be stopped by the person (default: this process's). */
  stops?: CallStops;
  /**
   * The line a caller opened for an agent's call when the message was accepted (a run's thread), and whether it waited its turn there: the answer goes on in it,
   * so the engine reports only how it ends. Absent, or null for an agent: the engine opens its own line when it starts.
   */
  callOf?: (agent: string) => { activity: RunActivity; queued: boolean } | null;
  /** Called once per agent named, when its call is over (answered, failed or not of the team), so the caller lets the next call begin. */
  release?: (agent: string) => void;
  /**
   * Asks the person about a command an agent set to `host` wants to run outside a run: the app-wide command notice, on every screen and on a paired phone, which
   * also answers from the agent's always-allowed rules. Absent: every host command is refused, since there is nobody to ask.
   */
  askCommand?: (agent: AgentDef, command: string, signal: AbortSignal) => Promise<{ ok: boolean; note?: string }>;
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
  /**
   * The read confinement of the call, for a caller that has one (the runner, over the run's worktree). Absent, or `undefined` for a place with no
   * worktree to be confined to (a channel, a general conversation, a ceremony), the mention keeps the read policy of the ceremonies: no confinement.
   */
  readRoot?: (place: MentionPlace, agent: AgentDef, cwd: string) => ReadConfinement | undefined;
  /** The agents already in the exchange that led to this answer, when one agent called another (`CallAgent`): a call back to one of them is refused. */
  chain?: readonly string[];
  /**
   * What an answer is told of the activities of the workspace, by the names the message carries: the front named whole, or the short list of what is
   * in progress. The caller renders it (the runner has the store, the mentions module reads it too); absent: the answer gets no such section. `narrow`: the answer has the
   * shared memory, whose index carries the other activities, so the section holds only what the message is about or named.
   */
  memory?: (place: MentionPlace, message: ForumMessage, narrow: boolean) => string;
  /** The workspace's learned procedures: an answer outside a ceremony gets their list and tools, and what it read is marked in the thread. Absent: none. */
  procedures?: ProceduresPort;
  /** The shared memory (#215): an answer gets the index and, outside a ceremony, tools to read it and to keep notes of its own. Absent, or the workspace's switch off: none. */
  memoryPort?: MemoryPort;
  /** What the message names, for the ranking of the memory's list: the activities (numbers or references) and the agents. Absent: nothing was named. */
  named?: (place: MentionPlace, message: ForumMessage) => { refs: string[]; agents: string[] };
  /**
   * Where the offers to keep a procedure are held (#187). With it, an answer whose work had trial and error and kept no procedure gets one last turn once the answer is
   * posted, detached from the thread's queue. Absent: no last turn.
   */
  offers?: Pick<ProcedureOffers, 'raise' | 'turned'>;
  /** The last turn's runner; a test replaces it to wait for the detached turn (the default is `runWrapUp`). */
  wrapUp?: typeof runWrapUp;
}

/** What a mention answer produced, for a caller that records it elsewhere (a ceremony). */
export interface MentionAnswer {
  agent: string;
  text: string;
}

/** A folder of the workspace's own data where the throwaway copy of an answer's commands is made; the sandbox's own folders live beside it. */
const draftDir = (thread: string, tag: string, agent: string): string => join(ATAS, 'sandbox', 'mention', thread.replace(/[^\w-]/g, '_').slice(0, 60), `${tag}-${agent}`);

/** The repository titles of a place on disk, in the config's order. */
const repoTitles = (place: MentionPlace): string[] => reposOnDisk(place).map((r) => r.id);

/** The files a message carries, for the agent called in its conversation: the refs stay in the message, the tool resolves them by the conversation's folder. */
function attachmentsFor(deps: MentionDeps, thread: string, message: ForumMessage): { thread: string; refs: readonly AttachmentRef[] } | null {
  if (!message.attachments.length) return null;
  return { thread, refs: message.attachments };
}

/** The files a run's thread gives the agent (the cycle folder, the issue record first). */
function runFiles(run: Run): FolderFile[] {
  return existsSync(run.worktree) ? readFolder(run.worktree, run.cycleFolder) : [];
}

/**
 * The documentation ask of an answer: inside a run, the worktree (the repository's folder when the worktree is gone) at the stage the run is at, over the paths the
 * run's work touches; elsewhere, the repositories of the place that exist on disk, with no stage and no paths.
 */
async function docsAskOf(place: MentionPlace, config: WorkspaceConfig, files: FolderFile[]): Promise<DocsAsk> {
  const run = place.kind === 'run' ? place.run : undefined;
  if (!run) return { repos: reposOnDisk(place).map((r) => r.path), stage: null, paths: [] };
  const stage = stageOfRun(run, config);
  if (existsSync(run.worktree)) return runDocsAsk({ wt: run.worktree, base: run.base, cycleFolder: run.cycleFolder, stage, texts: files.map((f) => f.text) });
  const repo = runRepo(config, run);
  return { repos: repo && existsSync(repo.path) ? [repo.path] : [], stage, paths: [] };
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
export async function answerMentions(place: MentionPlace, message: ForumMessage, given: MentionDeps): Promise<MentionAnswer[]> {
  // A ceremony has no screen, whatever its agents are set to.
  const deps: MentionDeps = place.kind === 'ceremony' ? { ...given, screens: undefined } : given;
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
    // The hand-off of the agent's screen for this answer (#178): made before any session, which reads its gate and its mask through the binding.
    const ports = deps.screens?.() ?? null;
    const ref = place.kind === 'run' && place.run ? place.run.issue.ref : place.ref;
    const title = place.kind === 'run' && place.run ? place.run.issue.title : place.title;
    const about = [ref, title?.slice(0, 120)].filter(Boolean).join(' ');
    const offer = def.screen === true ? beginHandoff(ports?.handoff, def, { key: callKey(place.thread, id), thread: place.thread, place: 'conversation', stage: stage ?? '', ...(place.run ? { issue: place.run.issue.iid } : {}), about, pause: watch.pause, signal: abort.signal }) : null;
    // What the session reads of this answer while it is the one using it.
    const mine: Binding = { signal: abort.signal, pause: watch.pause, beat: watch.beat, handoff: offer?.call ?? null };
    let session: SandboxSession | null = null;
    let source: ShellSource | null = null;
    // The agent's screen for this answer, and the shell session kept for it between answers (when it is the screen's to keep).
    let screen: CallScreen | null = null;
    let keptShell: KeptShell | null = null;
    // Whether the engine got to run: what failed before it is the call's own failure, and its line must not wait forever.
    let ran = false;
    // The procedures the answer is given (none in a ceremony), and whether the engine ended in an answer: what a failed call read is no use of a procedure.
    let procedures: ProcedureSession | null = null;
    // The memory session of the answer, closed where the procedures' one is.
    let shared: MemorySession | null = null;
    let answered = false;
    // The last turn took over closing the procedures: its task does, once it is over.
    let detached = false;
    // The person's Stop (or the screen closing under the answer) ends this answer only: what the thread says then is not a failure.
    let stoppedBy: 'person' | 'screen' | null = null;
    const stopper = new AbortController();
    stopper.signal.addEventListener('abort', () => {
      stoppedBy ??= 'person';
      abort.abort();
    });
    const unregister = (deps.stops ?? callStops).register(place.thread, id, stopper);
    const screenClosed = (): void => {
      stoppedBy ??= 'screen';
      abort.abort();
    };
    try {
      if (wantsCommands) {
        const opened = await openShell(deps, place, def, message, stage, mine, abort.signal, watch, config);
        session = opened.session;
        source = opened.source;
        screen = opened.screen;
        keptShell = opened.kept;
      }
      // The agent's screen when no shell session made it: the app's browser on a display of its own, and the confirmation tool where the call has the right to it.
      if (!screen && ports) screen = await openCallScreen(ports, screenRequest(deps, place, def, message, stage, watch, null, abort.signal));
      // The hand-off tool, where the person can take the screen: the app's browser draws on a display that is registered with the live hub.
      offerHandoff(screen, offer, { live: !!screen?.lease && !!ports?.sessions.watched(callKey(place.thread, id)), session: session !== null, host: def.shell === 'host' });
      // A screen that closes under a running answer takes the answer with it: nothing it was doing can go on.
      if (screen?.lease) {
        if (screen.lease.closed.aborted) screenClosed();
        else screen.lease.closed.addEventListener('abort', screenClosed, { once: true });
      }
      // Stopped before the engine began: the catch below says so, whatever the error is.
      if (abort.signal.aborted) throw new Error('stopped');
      const info = inputOf(place);
      // A session kept for the screen holds the commands of the earlier answers too: this answer's are the ones numbered after the last one it found.
      const shell = session;
      const startN = shell ? shell.log.reduce((top, e) => Math.max(top, e.n), 0) : 0;
      // The call's screen as the procedures and the memory read it: the steps of its browser for a draft, and the hand-off's seams for the check of what the person typed.
      const pscreen = screen?.toolset ? procedureScreen({ key: callKey(place.thread, id), sessions: ports?.sessions, typed: screen.toolset.typed, handoff: ports?.handoff, active: () => screen?.toolset?.handoff?.active() === true, browser: !!screen.toolset.browser }) : undefined;
      const surface = deps.chain?.length ? 'called' : place.kind === 'run' ? 'run-thread' : place.kind === 'general' ? 'forum' : place.owner ? 'direct' : 'channel';
      const note = (code: string, params: Record<string, string | number>): void => {
        try {
          deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code, params, stage });
        } catch (e) {
          console.error('[mentions] could not record a note', e instanceof Error ? e.message : e);
        }
      };
      if (place.kind !== 'ceremony') {
        procedures =
          deps.procedures?.open({
            surface,
            agent: reader,
            ref: place.kind === 'run' && place.run ? place.run.issue.ref : place.thread,
            issue: place.run?.issue.iid,
            repos: info.repos,
            requests: true,
            screen: pscreen,
            commands: shell ? { entries: () => shell.log.filter((e) => e.n > startN) } : undefined,
            note,
          }) ?? null;
        // The shared memory: the index the answer is told and the tools it uses, in its own folder of the place's thread (a run's, a channel's, the general or a direct one).
        shared =
          (await deps.memoryPort?.open({
            surface,
            agent: reader,
            conversation: place.thread,
            writes: true,
            tools: true,
            ref: place.kind === 'run' && place.run ? place.run.issue.ref : place.ref,
            ...(place.run ? { repo: place.run.repo, runId: place.run.id, issue: place.run.issue.iid } : {}),
            named: deps.named?.(place, message),
            screen: pscreen,
            note,
          })) ?? null;
      }
      // The files the message carries go to the agent only when the workspace gives them: the person still attaches and opens them, the agent is told why not.
      const attachments = deps.config().attachments?.agents === false ? null : attachmentsFor(deps, place.thread, message);
      const call: AgentCall = mentionCall({
        agent: reader,
        config,
        message,
        thread: deps.forum.read(place.thread, 0, 2000)?.messages ?? [],
        files: info.files,
        cwd: source?.cwd ?? (place.run && existsSync(place.run.worktree) ? place.run.worktree : deps.env().fallbackCwd),
        ref: info.ref,
        title: info.title,
        mission: info.mission,
        repos: info.repos,
        place: place.kind === 'run' ? 'run' : place.kind,
        shell: session ? { host: def.shell === 'host', network: config.runner.sandbox.network } : undefined,
        // What the agent is told of its screen and its hosts: nothing for an agent with neither, so its prompt is what it was.
        screen: promptFor(screen, def, config.runner.sandbox, grantsFor(def), session?.gui?.display === 'on'),
        proposals: mayPropose(def, deps, place),
        autonomous: autonomyOf(config, def),
        attachments: attachments ?? undefined,
        // What the app knows of the activities: the section is text only, so no tool of the call changes and no folder of it is opened.
        memory: deps.memory?.(place, message, shared !== null) || undefined,
        procedures: procedures?.list.text,
        proceduresGui: procedures?.has.screen === true,
        proceduresCmd: procedures?.has.commands === true,
        ...(shared ? { index: shared.list.text, indexWrite: shared.writes } : {}),
      });
      if (procedures) {
        call.procedures = procedures.tools;
        call.onUsage = procedures.wrapUsage();
      }
      if (shared?.tools) call.memoryTools = shared.tools;
      if (attachments === null && message.attachments.length) {
        // The workspace turned attachments to agents off: the conversation says so, once per answer, so the person knows why the agent did not read them.
        deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'main.attachment.agentsOff', stage });
      }
      call.onPool = (notice) => {
        try {
          deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, ...poolNoticeLine(id, notice), stage });
        } catch (e) {
          console.error('[mentions] could not record a switch of model', e instanceof Error ? e.message : e);
        }
      };
      call.docs = await docsAskOf(place, config, info.files);
      // The engine hears the abort too, so Stop ends the model's work and not only the wait for it.
      call.abort = abort;
      if (made) call.activity = made.activity;
      if (session) call.exec = session;
      if (screen?.toolset) call.screen = screen.toolset;
      // An agent named in a run's thread reads only inside that run's worktree, like a reading stage of it; elsewhere the caller gives none.
      // Its working folder is the same folder as the guard's root, so a relative path is judged and read against one folder, never two.
      call.readRoot = deps.readRoot?.(place, def, call.cwd);
      call.beat = watch.beat;
      // The agent may bring another agent of the team into the conversation (not in a ceremony, whose answers are recorded elsewhere): the other answers here, read
      // only, and the answer comes back to it. The caller's clocks stop while the other answers, as they do while a command waits for the person.
      if (place.kind !== 'ceremony') {
        const chain = [...(deps.chain ?? []), id];
        call.runnerTools = [
          conversationCallTool({
            team: workingTeam(config.agents.team).map((a) => a.id),
            chain,
            cap: config.runner.conversations.perStage,
            ask: async (to, topic) => {
              const [asked] = deps.forum.append(place.thread, { kind: 'post', author: { type: 'agent', id }, text: topic, mentions: [to], stage, public: false });
              const resume = watch.pause();
              try {
                const answers = await answerMentions(place, asked, { ...deps, calls: [to], chain, callOf: undefined, release: undefined });
                return answers.find((a) => a.agent === to)?.text ?? null;
              } finally {
                resume();
              }
            },
          }),
        ];
      }
      // The call waited its turn: it says it is working now, when it really begins.
      if (made?.queued) made.activity.status('started');
      ran = true;
      const r = await watch.guard(withActivityContext(place.kind === 'run' ? `run:${place.run?.id}` : mentionJob(place.thread), () => deps.engine(call, [])));
      answered = true;
      const text = answerText((r.data as { text?: unknown })?.text);
      if (!text) throw new Error(t('main.runner.error.empty-answer'));
      deps.forum.append(place.thread, { kind: 'post', author: { type: 'agent', id }, text, stage, public: false });
      // The answer is out: the work may have earned one last turn, which runs beside the thread and not in front of its next message.
      if (procedures && deps.offers && !deps.chain?.length) {
        const session = procedures;
        detached = giveLastTurn(deps, session, ports, { agent: reader, place, id, text, about, stage, cwd: deps.env().fallbackCwd });
      }
      if (mayPropose(def, deps, place)) await raiseWrites(deps, place, def, message.seq, id, readProposedWrites((r.data as { proposals?: unknown }).proposals));
      if (r.partial) deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.partial', params: { agent: id }, stage });
      out.push({ agent: id, text });
    } catch (e) {
      const reason = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
      // Nothing ran, so the engine reported no end: the call fails here, or its line would stay on screen.
      if (!ran) made?.activity.status('failed', reason);
      if (stoppedBy) deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: stoppedBy === 'person' ? 'runner.mention.stopped' : 'runner.mention.stoppedScreen', params: { agent: id }, stage });
      // Every model of the role's pool was busy: the line names the pool and when the first one is back, whole where the reason would be cut.
      else if (e instanceof ProviderBusyError) deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.model.allBusy', params: { agent: id, ...poolBusyParams(e) }, stage });
      else deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mentionFailed', params: { agent: id, reason }, stage });
    } finally {
      shared?.finish();
      if (!detached) procedures?.finish(answered ? 'done' : 'failed');
      unregister();
      // A hand-off still open ends first, with no result; the typed values are forgotten with the answer.
      offer?.call.end();
      screen?.lease?.closed.removeEventListener('abort', screenClosed);
      screen?.release();
      if (keptShell) {
        // The session belongs to the screen now: it stays, with the copy, until the screen ends.
        keptShell.cell.bound = null;
      } else {
        await session?.close().catch(() => undefined);
        if (source?.made) rmSync(source.cwd, { recursive: true, force: true });
      }
      deps.release?.(id);
    }
  }
  return out;
}

/** Whether the agent is autonomous now: the team's current entry, which a change in Settings updates, before the definition the call started with. */
const autonomyOf = (config: WorkspaceConfig, def: AgentDef): boolean => config.agents.team.find((a) => a.id === def.id)?.autonomous ?? def.autonomous;

/**
 * Plans the last turn of an answer and starts it, detached. True when it began (the caller then leaves closing the procedures to it). The turn is given once for a screen at a
 * draft mark: a later answer on the same screen, before anything moved the mark, only waits for the person to answer the card. Nothing here fails the answer.
 */
function giveLastTurn(deps: MentionDeps, session: ProcedureSession, ports: ScreenPorts | null, w: { agent: AgentDef; place: MentionPlace; id: string; text: string; about: string; stage: string | null; cwd: string }): boolean {
  try {
    const offers = deps.offers as NonNullable<MentionDeps['offers']>;
    const plan = session.plan({ words: w.text });
    if (!plan) return false;
    if (plan.screen && ports) {
      const key = callKey(w.place.thread, w.id);
      let mark = 0;
      try {
        mark = ports.sessions.markOf(key);
      } catch {
        // a screen that is gone has no mark: its turn is the first
      }
      // The turn was given already for this screen at this mark: no second one, but the card is refreshed from what this answer drafted (the store replaces it by thread,
      // agent, kind and key). The commands of the answer are in the plan as well, and are offered too.
      if (offers.turned(key, mark)) {
        raiseOffers({ offers }, { plan, agent: w.agent, session, thread: w.place.thread, ...(w.stage ? { stage: w.stage } : {}) });
        return false;
      }
    }
    // The call's typed values are forgotten when its answer ends, which comes before the turn does: the turn keeps a copy in memory, and forgets it when it is over.
    session.freezeTyped();
    const task = (deps.wrapUp ?? runWrapUp)(
      {
        engine: deps.engine,
        offers,
        note: (code, params) => {
          try {
            deps.forum.append(w.place.thread, { kind: 'system', author: { type: 'app' }, code, params, stage: w.stage });
          } catch (e) {
            console.error('[mentions] could not record a note', e instanceof Error ? e.message : e);
          }
        },
      },
      { agent: w.agent, session, plan, ref: w.about, thread: w.place.thread, ...(w.stage ? { stage: w.stage } : {}), cwd: w.cwd },
    );
    void task.catch(() => undefined).finally(() => {
      session.finish('done');
      session.release();
    });
    return true;
  } catch (e) {
    session.release();
    console.error('[mentions] could not plan the last turn', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * The text of an answer. A model sometimes writes its whole answer object as the text (`{"text": "…"}`, the line ends escaped): the person would read the JSON, so
 * the text inside it is taken instead. Anything else is the text as it came.
 */
export function answerText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return text;
  try {
    const inner = (JSON.parse(text) as { text?: unknown }).text;
    return typeof inner === 'string' && inner.trim() ? inner.trim() : text;
  } catch {
    return text;
  }
}

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
 * under the workspace's data (the one repository itself in a folder, or one subfolder per repository), which the caller removes when the answer ends, or, for a copy kept
 * with a screen (`tag` `screen`), when the screen does. `null` when the place has no repository on disk (a ceremony, or a place with none): the agent answers without
 * commands and the thread says why.
 */
async function shellSourceOf(place: MentionPlace, def: AgentDef, tag: string, signal: AbortSignal, maxBytes: number): Promise<ShellSource | null> {
  if (place.kind === 'run' && place.run && existsSync(place.run.worktree)) return { cwd: place.run.worktree, made: false, reader: true };
  const repos = reposOnDisk(place);
  // An agent with a screen works on sites and needs no code: with none in the place, its commands run in an empty throwaway folder instead.
  if (!repos.length && def.screen !== true) return null;
  const dir = draftDir(place.thread, tag, def.id);
  // A copy kept with a screen has a name of its own, not the message's: what an earlier screen of the agent left there is not this one's.
  if (tag === SCREEN_TAG) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (!repos.length) return { cwd: dir, made: true, reader: false };
  // One repository: its copy is the working folder itself; several: one subfolder per repository, and the folder holds them all. Only what git knows is copied, as a
  // run's worktree holds it: what a person built or installed (dist, node_modules) is not code, and can weigh gigabytes.
  for (const repo of repos) await copyTracked(repo.path, repos.length === 1 ? dir : join(dir, repo.id), maxBytes, signal);
  if (repos.length !== 1) return { cwd: dir, made: true, reader: false };
  // As in a run's worktree, the clone's dependencies come by link (the sandbox binds them read-only), so the agent can run the repository's own tests.
  for (const rel of dependencyFolders(repos[0].path)) {
    if (existsSync(join(dir, rel))) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    symlinkSync(join(repos[0].path, rel), join(dir, rel));
  }
  return { cwd: dir, made: true, reader: false, clone: repos[0].path };
}

/** The name a copy kept with a screen goes by, instead of the number of the message that made it. */
const SCREEN_TAG = 'screen';

/**
 * Opens the session an agent's commands run in, over the throwaway folder `cwd` (already a copy), read only: a sandbox of this computer, or a host session. A host
 * session keeps the same limit as a run's thread: every command waits for the person, and without the app to ask it is refused, never run unattended. What belongs to
 * the answer that uses the session (its clocks, its signal) is read through `bound`, so a session kept for a screen follows the answer that has it now.
 */
function openMentionSession(deps: MentionDeps, def: AgentDef, source: { cwd: string; reader: boolean; clone?: string }, place: MentionPlace, bound: () => Binding | null, signal: AbortSignal, display: boolean): Promise<SandboxSession> {
  const sandbox = deps.sandbox;
  if (!sandbox) return Promise.reject(new Error(t('main.mentions.noRepo')));
  const thread = place.thread;
  const config = deps.config();
  const host = def.shell === 'host';
  const say = (code: string, params: Record<string, string | number>): void => {
    try {
      deps.forum.append(thread, { kind: 'system', author: { type: 'app' }, code, params });
    } catch {
      // A note that cannot be recorded does not stop the answer.
    }
  };
  // The proxy of the session's sandbox is counted, not told tunnel by tunnel: the thread gets one line the first time a host is refused and one summary when the session
  // closes (a package install opens dozens of tunnels), as the app's browser does, and the audit log gets the summary.
  const tally = createHostsTally({
    onFirstRefusal: (h) => {
      const shown = safeHost(h);
      if (shown) say('runner.proxy.firstRefusal', { agent: def.id, host: shown });
    },
  });
  tally.beginCall();
  const onProxy = (p: ProxyDecision): void => tally.decide(p);
  const summarize = (): void => {
    const line = summaryParams(tally.summary());
    if (!line) return;
    say('runner.proxy.summary', { agent: def.id, allowed: line.allowed, refused: line.refused, hosts: line.hosts });
    const { allowed, refused } = tally.summary();
    recordWrite({
      kind: 'exec',
      issue: place.run?.issue.iid ?? 0,
      target: 'network summary',
      via: 'sandbox',
      fields: { agent: def.id, thread, hostsAllowed: countsText(allowed), hostsRefused: countsText(refused) },
      ok: true,
      code: null,
      result: 'summary',
      origin: { actionId: '', kind: 'conversation-proxy', key: `${thread}:${def.id}`, summary: null },
      by: def.id,
    });
  };
  const onExec = (r: { n: number; command: string; exitCode: number | null; timedOut: boolean; ms: number; output: string; refused?: string }, mode?: 'run' | 'refused'): void => {
    say(host ? 'runner.exec.host' : 'runner.exec', { agent: def.id, n: r.n, command: redact(r.command.replace(/\s+/g, ' ')).slice(0, 300), result: r.refused ? t(`main.runner.exec.refused.${r.refused}`) : r.timedOut ? t('main.runner.exec.timeout') : r.exitCode === null ? t('main.runner.exec.notRun') : t('main.runner.exec.exit', { code: r.exitCode }), ms: Math.round(r.ms / 100) / 10, tail: r.output.slice(0, 600) || '—' });
    // A command of a conversation is audited as a stage's is: what ran, where, and how it ended; the log's own scrubbing applies on top.
    if (mode === 'run') {
      recordWrite({
        kind: 'exec',
        issue: place.run?.issue.iid ?? 0,
        target: redact(r.command.replace(/\s+/g, ' ')).slice(0, 300),
        via: host ? 'host' : 'sandbox',
        fields: { agent: def.id, thread, n: String(r.n), ms: String(r.ms), timedOut: String(r.timedOut) },
        ok: r.exitCode === 0,
        code: r.exitCode,
        result: r.output.slice(-300),
        origin: { actionId: '', kind: 'conversation-exec', key: `${thread}:${def.id}`, summary: null },
        by: def.id,
      });
    }
  };
  // A host command runs on the person's computer: like a run's thread, each one waits for their yes, here through the command notice every screen shows. The
  // agent's clock stops while the person decides, and the thread keeps the ask and the answer next to the command.
  const approve = async (command: string): Promise<{ ok: boolean; note?: string }> => {
    const now = bound();
    if (!deps.askCommand || !now || now.signal.aborted) return { ok: false };
    say('runner.command.ask', { agent: def.id, command: redact(command.replace(/\s+/g, ' ')).slice(0, 300) });
    const resume = now.pause();
    try {
      const answer = await deps.askCommand(def, command, now.signal);
      say(answer.ok ? 'runner.command.once' : 'runner.command.deny', { agent: def.id, note: answer.note?.trim() || '—' });
      return answer;
    } finally {
      resume();
    }
  };
  // A test workspace never reaches real sites: the agent's own hosts are withheld, and the thread says so (an agent with a screen has it said by its screen).
  const grants = grantsFor(def);
  if (def.shell !== 'host' && grants.withheld.includes('hosts') && !def.screen) say('runner.screen.testWorkspace', { agent: def.id, what: withheldText('hosts') });
  // What the answer using the session has now: its gate and its mask follow whichever answer holds a kept session.
  const held = (): boolean => bound()?.handoff?.active() ?? false;
  const mask = (text: string): string => bound()?.handoff?.typed.mask(text) ?? text;
  if (def.shell === 'host') return sandbox.openHost({ worktree: source.cwd, reader: source.reader, config: config.runner.sandbox, onExec, approve, signal, held, mask, ...(display ? { display } : {}) });
  return sandbox.open({ worktree: source.cwd, reader: source.reader, config: config.runner.sandbox, onExec, onProxy, signal, held, mask, agent: { allowedHosts: grants.allowedHosts }, ...(display ? { display } : {}), ...(source.clone ? { clone: source.clone } : {}) }).then((session) => {
    // The summary is written once, when the session ends, whoever ends it.
    const close = session.close.bind(session);
    let done = false;
    session.close = async () => {
      if (!done) {
        done = true;
        summarize();
      }
      return close();
    };
    return session;
  });
}

/** What the sessions are asked to open the screen of an agent in this place for this answer. */
function screenRequest(deps: MentionDeps, place: MentionPlace, def: AgentDef, message: ForumMessage, stage: string | null, watch: { pause: () => () => void }, display: { socket: string; kind: 'sandbox' | 'host' } | null, signal: AbortSignal, onClose?: () => Promise<void>): CallScreenRequest {
  return {
    key: callKey(place.thread, def.id),
    agent: def,
    thread: place.thread,
    place: 'conversation',
    ...(stage ? { stage } : {}),
    ...(place.run ? { issue: place.run.issue.iid } : {}),
    message: message.seq,
    display,
    seesImages: modelSeesImages(def),
    pause: watch.pause,
    hasDisplay: display !== null,
    signal,
    ...(onClose ? { onClose } : {}),
  };
}

interface OpenedShell {
  session: SandboxSession | null;
  source: ShellSource | null;
  screen: CallScreen | null;
  /** The session is the screen's, kept for the next answer. */
  kept: KeptShell | null;
}

/**
 * The shell session of an answer. An agent whose screen the app can open keeps one session, with its throwaway copy and a display, for as long as the screen lives: the
 * first answer makes it and the next ones find it as it was. Anyone else gets a session for this answer only, which the caller closes. The screen is asked for after the session,
 * since the app's browser draws on the session's display; when it cannot be had, the session is this answer's.
 */
async function openShell(deps: MentionDeps, place: MentionPlace, def: AgentDef, message: ForumMessage, stage: string | null, mine: Binding, signal: AbortSignal, watch: { beat: () => void; pause: () => () => void }, config: WorkspaceConfig): Promise<OpenedShell> {
  const store = deps.kept ?? keptSessions;
  const ports = deps.screens?.() ?? null;
  const key = callKey(place.thread, def.id);
  const keeps = ports !== null && def.screen === true && grantsFor(def).browser;
  const request = (display: { socket: string; kind: 'sandbox' | 'host' } | null) => screenRequest(deps, place, def, message, stage, watch, display, signal, () => store.release(key).then(() => undefined));
  let screen: CallScreen | null = null;

  if (keeps) {
    const existing = store.get(key);
    if (existing) {
      screen = await openCallScreen(ports, request(existing.display));
      if (screen.lease) {
        existing.cell.bound = mine;
        return { session: existing.session, source: existing.source, screen, kept: existing };
      }
    }
  }

  // A session for this answer, or the first of a screen's.
  const makesKept = keeps && screen === null;
  const say = (reason: string): void => {
    deps.forum.append(place.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mention.noShell', params: { agent: def.id, reason }, stage });
  };
  const source = await shellSourceOf(place, def, makesKept ? SCREEN_TAG : String(message.seq), signal, config.runner.sandbox.limits.copyMb * 1024 * 1024);
  if (!source) {
    say(t('main.mentions.noRepo'));
    return { session: null, source: null, screen, kept: null };
  }
  const cell: BindingCell = { bound: mine };
  const life = new AbortController();
  const clock = { beat: () => cell.bound?.beat(), pause: () => cell.bound?.pause() ?? (() => undefined) };
  // A kept session refuses and masks through the answer that has it now, not the one that made it.
  const gate = { held: () => cell.bound?.handoff?.active() ?? false, mask: (text: string) => cell.bound?.handoff?.typed.mask(text) ?? text };
  const session = await (deps.openSession ? deps.openSession(place, def, source.cwd, stage, makesKept ? life.signal : signal, clock, { display: makesKept, ...gate }) : openMentionSession(deps, def, source, place, () => cell.bound, makesKept ? life.signal : signal, makesKept)).catch((e: unknown) => {
    say(redact(e instanceof Error ? e.message : String(e)).slice(0, 300));
    return null;
  });
  if (!session || !makesKept) return { session, source, screen, kept: null };

  const lent = session.screen && session.gui?.display === 'on' ? { socket: session.screen.socket, kind: session.screen.kind } : null;
  screen = await openCallScreen(ports, request(lent));
  if (!screen.lease) return { session, source, screen, kept: null };
  const shell: KeptShell = { session, source, display: lent, cell, life };
  await store.keep(key, shell);
  // The screen may have ended between its opening and now: nothing would release the session, so it goes with it.
  if (!ports?.sessions.has(key)) {
    await store.release(key);
    return { session, source, screen, kept: null };
  }
  return { session, source, screen, kept: shell };
}
