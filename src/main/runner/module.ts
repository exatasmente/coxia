import { existsSync } from 'node:fs';
import { nativeImage } from 'electron';
import { join } from 'node:path';
import { HOME, ATAS, DATA_ROOT } from '../env';
import { runAgent, probeProviderBudget } from '../agents';
import { forumStore, interceptPosts, threadAnchor } from '../forum';
import { type CommandDecision, RunError, isFlowCycle } from '../../shared/runs';
import type { AttachmentRef } from '../../shared/attachments';
import { createdIssueOf } from '../../shared/runs/links';
import type { ReleaseAction } from '../../shared/types';
import type { Module } from '../module';
import { failureText, noteRetroIssue } from '../retroIssues';
import { callStops } from '../mentions/stop';
import { callOrigin } from '../rpc';
import { attachmentStore } from '../attachments';
import { keepConversationRecording } from '../mentions/recording';
import { runStore } from '../runs';
import { git } from '../conflictGit';
import { vcsProvider, vcsReady } from '../vcs';
import { getConfig, onConfigChange, rc, updateConfig } from '../workspaceConfig';
import { createSandboxService } from '../sandbox';
import { sandbox } from '../sandbox/workspace';
import { firePluginEvent, liveContext, pluginHold, pluginNotes, pluginRunHooks, releasePluginAsks } from '../plugins/module';
import { readArtifact } from './cycleFolder';
import { uploadsOf } from '../evidence/store';
import { realDoor, onRunnerActionDone, onRunnerActionRefused } from './door';
import { remoteReleaseOf } from './release';
import { createPublisher } from './publish';
import { applyDocsFlow, startDocsRun } from '../harness/docsRun';
import { docsStatus } from '../harness/status';
import { docsFlowOf } from '../../shared/config/squads';
import { ASK_DECISIONS, type AskDecision, SCREEN_ASKS_EVENT, keyOf, parseKey } from '../../shared/browser';
import { SCREEN_EVENT } from '../../shared/screen';
import { auditScreen } from '../browser/audit';
import { AskGone, type ScreenAsks, askNotice, createScreenAsks } from '../browser/asks';
import { grantsFor } from '../browser/guard';
import { startBrowser } from '../browser/launch';
import { openProfile } from '../browser/profile';
import { resolveBrowsers } from '../browser/resolve';
import { type ScreenSessions, createScreenSessions } from '../browser/sessions';
import { type NativeImageLike, createFrameEncoder } from '../screen/frame';
import { type EncoderHost, createEncoderHost } from '../screen/encoderHost';
import { realEncoderEnv } from '../screen/encoderWindow';
import { type HandoffService, createHandoffService } from '../screen/handoff';
import { type ScreenHub, createScreenHub } from '../screen/hub';
import { type GateAction, type IssueSource, type Runner, RunnerError, createRunner } from './service';

// The runner of the running workspace, and its channels. What a paired browser may call is decided in webPolicy.ts: reading runs and answering a
// question are open to it (the phone is where a person answers), everything else that starts work or changes a run is the desktop window's.
// What leaves the machine from a run (comments, reviews, the push, the pull request) goes through `realDoor` (door.ts): proposals in Actions, or, for an
// agent that is autonomous, an audited write; the push and the pull request always wait for a "sim".

const source: IssueSource = {
  ready: () => vcsReady(),
  async get(iid) {
    const project = rc().issues.project as string;
    const provider = vcsProvider();
    return { issue: await provider.getIssue(project, iid), comments: await provider.listIssueComments(project, iid) };
  },
  async triggered(label) {
    const provider = vcsProvider();
    if (!provider.caps.issues) return [];
    const want = label.trim().toLowerCase();
    return (await provider.listMyIssues({ project: rc().issues.project, limit: 100 })).filter((i) => i.state === 'open' && i.labels.some((l) => l.toLowerCase() === want));
  },
  async unassigned(label) {
    const provider = vcsProvider();
    if (!provider.caps.issues) return [];
    // The read needs a project of issues, and the list of `listIssues` is a project's own; without one there is nothing to offer.
    const project = rc().issues.project;
    if (!project) return [];
    const want = label.trim().toLowerCase();
    return (await provider.listIssues({ project, scope: 'labels', labels: [label], limit: 100 })).filter((i) => i.state === 'open' && i.labels.some((l) => l.toLowerCase() === want) && i.assignees.length === 0);
  },
};

let current: Runner | null = null;

/** The runner of this process; undefined until the module registered. */
export const runner = (): Runner | null => current;

let screens: ScreenHub | null = null;
let encoders: EncoderHost | null = null;

/** The live screens of this process's runner; null until the module registered. */
export const screenHub = (): ScreenHub | null => screens;

let asks: ScreenAsks | null = null;
let sessions: ScreenSessions | null = null;
let handoff: HandoffService | null = null;

/** The questions the app's screens ask the person (a held step, a confirmation); null until the module registered. */
export const screenAsks = (): ScreenAsks | null => asks;
/** The open screens of the agents that have one, and the way to open, reuse and close them; null until the module registered. */
export const screenSessions = (): ScreenSessions | null => sessions;
/** The hand-off of an agent's screen to the person (#178); null until the module registered. */
export const handoffService = (): HandoffService | null => handoff;

/** The app is closing: no live screen is read or sent to after this, and the browsers of the open screens are asked to end. */
export const endLiveScreens = (): void => {
  void sessions?.endAll();
  screens?.endAll();
  encoders?.shutdown();
};

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const id = (v: unknown): string => {
  if (typeof v !== 'string') throw new RunError('unknown-run', { id: '' });
  return v;
};

/**
 * The proposal a retro raised to open an issue was approved and the host answered: the issue exists, so the task starts on it. A host that did not answer
 * with the number leaves the improvement in the conversation, and a task that refuses to start is said there too. `start` is a parameter because the runner
 * only exists inside the module, which no test drives.
 */
export function retroIssueDone(action: ReleaseAction, responses: unknown[], start: (ref: string) => Promise<unknown>): void {
  if (action.unit?.purpose !== 'retro-issue') return;
  const retro = String(action.unit.retro ?? '');
  const made = createdIssueOf(responses[0]);
  if (!made) {
    noteRetroIssue(retro, 'main.retro.issue.noIssue', {});
    return;
  }
  void start(`${rc().issues.refPrefix}${made.iid}`).catch((err) => noteRetroIssue(retro, 'main.retro.issue.noRun', { reason: failureText(err) }));
}

/** The sandbox of the running workspace's agents, shared with the mentions answered outside a run's thread. */
export { sandbox } from '../sandbox/workspace';
export const runsModule: Module = (ctx) => {
  sandbox.purge();
  // The agents' virtual screens (Linux only). A frame goes to the viewer that asked for it, never through `emit`, which reaches every paired browser: the one event is
  // that a screen opened or ended, with no pixels, so the run list refreshes at once.
  // The recording's encoder is one hidden window shared by every recording; it is made at the first one and closed a while after the last.
  const encoderHost = createEncoderHost(realEncoderEnv());
  encoders = encoderHost;
  const hub = createScreenHub({
    enabled: process.platform === 'linux',
    encoder: createFrameEncoder({ nativeImage: nativeImage as unknown as NativeImageLike }),
    sink: () => encoderHost.sink(),
    // The person used the screen: a screen that closes when idle starts its clock over.
    activity: (key) => sessions?.touch(key),
    // The intervals in which the person used the screen go to the audit log: from and to only, never what was done.
    used: ({ key, agent, from, to }) => {
      const parsed = parseKey(key);
      const issue = parsed?.kind === 'run' ? runStore().get(parsed.run)?.issue.iid : undefined;
      auditScreen.used({ key, agent, place: parsed?.kind === 'run' ? 'stage' : 'conversation', ...(issue ? { issue } : {}), from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    },
    changed: (key) => ctx.emit({ type: 'module', name: SCREEN_EVENT, payload: { key } }),
    // The conversation says when the person took control of the screen and what they did with it: written by the app, never by the agent.
    note: (thread, stage, code, params) => {
      try {
        forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params, ...(stage ? { stage } : {}) });
      } catch (e) {
        console.error('[runner] could not record a note on the screen', e instanceof Error ? e.message : e);
      }
    },
  });
  screens = hub;
  // The questions the screens ask: a card in the conversation reads them from the event, and a notification opens the conversation.
  const askStore = createScreenAsks({
    changed: (pending) => ctx.emit({ type: 'module', name: SCREEN_ASKS_EVENT, payload: { asks: pending } }),
    asked: (ask) => {
      if (!getConfig().notifications) return;
      const key = parseKey(ask.key);
      const notice = askNotice(ask);
      if (key?.kind === 'call') ctx.notify({ ...notice, onClick: { type: 'open', screen: { name: 'forum', thread: key.thread } } });
      else if (key) ctx.notify({ ...notice, onClick: { type: 'open', screen: { name: 'run', id: key.run } } });
      else ctx.notify({ ...notice, onClick: { type: 'navigate', to: 'today' } });
    },
  });
  asks = askStore;
  const openSessions = createScreenSessions({
    enabled: process.platform === 'linux',
    config: getConfig,
    browsers: () => resolveBrowsers(getConfig().runner.sandbox, HOME, [DATA_ROOT]),
    sandboxReady: async () => (await sandbox.status(false)).available,
    dir: join(ATAS, 'sandbox'),
    grants: grantsFor,
    // The profile is never put where a worktree or a project is.
    openProfile: (agent, owner) => openProfile(ATAS, agent, owner, { avoid: rc().repos.map((x) => x.path) }),
    start: (options) => startBrowser(options),
    asks: askStore,
    hub,
    say: (thread, stage, code, params) => {
      try {
        forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params, ...(stage ? { stage } : {}) });
      } catch (e) {
        console.error('[runner] could not record a note on the screen', e instanceof Error ? e.message : e);
      }
    },
    // The recording of a conversation's screen is kept when the screen closes, before its browser and display go: in a run's thread as a piece of the run's evidence, as a
    // stage's is; anywhere else as a `video` attachment of the conversation, with one post of the app that says so. A failure is said there and never fails an answer.
    keepRecording: (screen, outcome) => {
      const run = screen.thread.startsWith('run-') ? runStore().get(screen.thread.slice('run-'.length)) : null;
      if (run) return current?.keepCallRecording(run.id, screen.agent, outcome) ?? 'not';
      return keepConversationRecording({ store: attachmentStore(), forum: forumStore(), anchor: threadAnchor }, screen, outcome);
    },
    changed: (key) => ctx.emit({ type: 'module', name: SCREEN_EVENT, payload: { key } }),
  });
  sessions = openSessions;
  // The agent hands its screen to the person: the wait, the three moves of the person and what each leaves (a line, an audit entry, a step, a notice).
  const handoffs = createHandoffService({
    hub,
    asks: askStore,
    say: (thread, stage, code, params) => {
      try {
        forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params, ...(stage ? { stage } : {}) });
      } catch (e) {
        console.error('[runner] could not record a note on the screen', e instanceof Error ? e.message : e);
      }
    },
    notify: (n) => ctx.notify(n),
    notifications: () => getConfig().notifications,
    masks: (key) => openSessions.masksOf(key),
    step: (key, step) => openSessions.recordStep(key, step),
  });
  handoff = handoffs;
  // A screen that ends takes a request still waiting for it, and what is remembered of its hand-offs, with it.
  openSessions.onClosed((screen) => {
    handoffs.closed(screen.key);
    handoffs.forget(screen.key);
  });
  // An agent that is gone, loses its screen or changes its shell, or a workspace that switches the display off, ends the screens that depended on it.
  onConfigChange((config) => void openSessions.reconcile(config));
  const r = createRunner({
    sandbox,
    screens: hub,
    sessions: openSessions,
    asks: askStore,
    handoff: handoffs,
    // One small call to a provider whose key ran out of budget, by the sweep: it goes through the engines, so the same refusal mapping applies.
    probeBudget: async (providerId) => {
      const result = await probeProviderBudget(providerId);
      return result.ok ? { state: 'ok' as const, detail: '' } : result.refusal ? { state: 'out' as const, detail: result.refusal.detail } : { state: 'unknown' as const, detail: result.detail };
    },
    runs: runStore(),
    forum: forumStore(),
    config: getConfig,
    env: () => ({ repos: rc().repos, issues: rc().issues, cloneRoots: rc().cloneRoots, host: rc().vcsHost, home: HOME, dataDir: ATAS, fallbackCwd: rc().projectsRoot }),
    issues: source,
    engine: (call, commands) => runAgent(call, commands),
    publisher: createPublisher({
      runs: runStore(),
      forum: forumStore(),
      config: getConfig,
      env: () => ({ issueProject: rc().issues.project ?? '', repos: rc().repos.map((x) => ({ id: x.id, projectPath: x.projectPath })) }),
      door: realDoor,
      // The evidence a comment cites, ready to go up: read here, where the workspace's data folder is; the executable that runs the command never sees the file until the throwaway copy is written.
      evidenceUploads: (run, ids) => {
        const dataDir = ATAS;
        const all = uploadsOf(dataDir, run, [...ids]);
        const present = ids.filter((id) => run.evidence?.[id]);
        return { images: all, total: present.length || ids.length };
      },
      // The tags of the repository of a release run: what the wait for its beta reads (the clone's own, never a path from the run's file but its worktree, which shares them).
      localTags: async (run) => {
        const at = existsSync(run.worktree) ? run.worktree : rc().repos.find((x) => x.id === run.repo)?.path;
        return at ? (await git(at, ['tag', '--list', 'v*'], { fail: false })).stdout.split('\n').filter(Boolean) : [];
      },
      // What the remote has of the version right now: what the waits for the beta and the stable to be on the host read, from the same repository.
      remoteRelease: async (run) => {
        const at = existsSync(run.worktree) ? run.worktree : rc().repos.find((x) => x.id === run.repo)?.path;
        return at && run.subject ? remoteReleaseOf(at, run.subject.version) : null;
      },
    }),
    updateConfig,
    notify: (n) => ctx.notify(n),
    // An event of the fixed catalog happened in the run (a stage was entered or finished, a gate was decided, the run finished): the plugins that
    // observe it are called, each inside the stage sandbox, with what the person granted it and writing its document into the run's cycle folder. The
    // app reads the run's own state here, never a stored one; a plugin that fails is not the run's to know, and the stage of a run is not started beside
    // another sandbox over the same worktree.
    pluginEvent: async (event, { run }) => void (await firePluginEvent(event, liveContext(run))),
    // A plugin's request waits for the person: the run does not start another stage until it is answered.
    pluginHold: (runId) => pluginHold(runId),
    pluginRelease: (runId) => releasePluginAsks(runId),
    pluginNotes: () => pluginNotes(),
  });
  current = r;
  pluginRunHooks.settled = (id, note) => {
    try {
      r.pluginSettled(id, note);
    } catch (e) {
      console.error('[runner] a plugin request was answered', id, e instanceof Error ? e.message : e);
    }
  };
  // A comment, a review, the push or the pull request that waited in Actions was approved: the run learns what the host made.
  onRunnerActionDone((action, responses) => r.actionDone(action, responses));
  // A "sim" on a step of a release was refused before it ran (a step it needs is not done): the run's thread says why.
  onRunnerActionRefused((action, reason) => r.actionRefused(action, reason));
  // The issue a retro improvement asked for was created: the task on it starts by itself, without another "sim".
  onRunnerActionDone((action, responses) => retroIssueDone(action, responses, (ref) => r.start(ref)));
  // A person's post that answers the run's question is the answer; a person's @mention calls on the agent, which never writes to the run.
  // The files the message carries ride on that answer: the runner writes them on the answer message it records.
  interceptPosts((thread, body, attachments) => r.answerPost(thread, body, attachments));
  forumStore().subscribe((m) => r.onMessage(m));

  // Whether this computer can make a sandbox, for the team editor to offer the option; `probe` asks again. Neither changes anything.
  // The pieces for testing an interface come with it, read from the saved settings: they never make the sandbox unavailable.
  ctx.handle('sandbox:status', async () => ({ ...(await sandbox.status()), gui: sandbox.guiStatus(getConfig().runner.sandbox) }));
  ctx.handle('sandbox:probe', async () => ({ ...(await sandbox.status(true)), gui: sandbox.guiStatus(getConfig().runner.sandbox) }));
  ctx.handle('runs:list', () => r.list());
  ctx.handle('runs:get', (run: unknown) => (typeof run === 'string' ? r.get(run) : null));
  // The record of the activities, for the runs screen: read only, no model call anywhere in the path, open to a paired browser like the list beside it.
  ctx.handle('runs:activities', () => r.activities());
  // The person's correction of one activity's front, recorded as theirs and written with the app's own masking and cap; like `runs:memory`, only the window's.
  ctx.handle('runs:activitySave', (ref: unknown, body: unknown) => r.correctActivity(text(ref), text(body)));
  // The open issues of the project that carry the trigger label and have no assignee: the manual-start list of the runs screen. Read only, open to a
  // paired browser like the list beside it; nothing here starts a run (the person's start goes through runs:start).
  ctx.handle('runs:unassigned', async () => {
    const { refPrefix } = rc().issues;
    const label = getConfig().runner.triggerLabel;
    const issues = await source.unassigned(label);
    return issues
      .map((i) => ({ iid: i.iid, ref: `${refPrefix}${i.iid}`, title: i.title, url: i.webUrl }))
      .sort((a, b) => a.iid - b.iid);
  });
  // A document a stage produced, for the run screen to show: read only, from the run's own cycle folder, and open to a paired browser like the thread beside it.
  ctx.handle('runs:artifact', (run: unknown, name: unknown) => {
    const found = typeof run === 'string' ? r.get(run) : null;
    return found ? readArtifact(found.worktree, found.cycleFolder, text(name)) : null;
  });
  ctx.handle('runs:memory', (run: unknown, body: unknown) => r.editMemory(id(run), text(body)));
  // The evidence a run kept: read only, from the run's own store, and open to a paired browser like the thread beside it. The bytes come back as an ArrayBuffer.
  ctx.handle('runs:evidenceList', (run: unknown) => r.evidence(id(run)));
  ctx.handle('runs:evidence', (run: unknown, evidence: unknown) => r.evidenceBytes(id(run), text(evidence))?.bytes ?? null);
  // The latest frame of a live screen, for a viewer that shows `since` and wants about `width`: a read like the ones beside it, open to a paired browser. The first argument
  // is a screen key (`run:<id>`, `call:<thread>:<agent>`) or a bare run id. It answers `none` when there is no such screen (it ended): only a malformed call is an error.
  ctx.handle('runs:screen', (key: unknown, since: unknown, width: unknown) => hub.frame(id(key), typeof since === 'number' && Number.isFinite(since) ? since : 0, typeof width === 'number' ? width : Number.NaN));
  // The screens of agents that have one. The list is a read, open to a paired browser like the others: a conversation shows its screens with Watch and Close. Close and Stop only
  // take capability away, like runs:cancel, so they are open too; the viewer's own input stays under `screen:`, which the web policy denies by a pattern.
  ctx.handle('runs:screens', (thread?: unknown) => openSessions.list(typeof thread === 'string' && thread ? thread : undefined));
  // Ends a screen: the browser, the agent's processes and the display go, the recording is kept, a step that waits for the person counts as declined. false: no such screen.
  ctx.handle('runs:screenClose', (key: unknown) => {
    const k = keyOf(key);
    return k ? openSessions.close(k, 'person') : false;
  });
  // Stops one answer of an agent in a conversation and leaves its screen open. false: the agent has no answer running there.
  ctx.handle('runs:callStop', (thread: unknown, agent: unknown) => callStops.stop(text(thread), text(agent)));
  // The person's answer to a step the app's browser holds, or to a confirmation an agent asked for. An external effect: a yes lets an irreversible step happen on a site, so a
  // paired browser gives it only with the external-effects switch (webPolicy.ts). The audit says whether the window or a paired browser answered.
  ctx.handle('runs:screenAnswer', (askId: unknown, decision: unknown, note?: unknown) => {
    if (!ASK_DECISIONS.includes(decision as AskDecision)) return { ok: false as const, reason: 'decision' as const };
    try {
      askStore.answer(text(askId), decision as AskDecision, callOrigin() === 'web' ? 'paired' : 'window', typeof note === 'string' ? note : undefined);
      return { ok: true as const };
    } catch (e) {
      if (e instanceof AskGone) return { ok: false as const, reason: 'gone' as const };
      throw e;
    }
  });
  // Removing a piece of evidence is the person's action, never an agent's; the file goes and the run drops the record.
  ctx.handle('runs:evidenceDelete', (run: unknown, evidence: unknown) => r.removeEvidence(id(run), text(evidence)));
  ctx.handle('runs:start', (ref: unknown, repo?: unknown) => r.start(text(ref), typeof repo === 'string' && repo ? repo : undefined));
  // A release run: its subject is a version (X.Y.Z, and the stable tag a patch is cut from). Like every start, it is the person's; what it asks of the repository goes through Actions.
  ctx.handle('runs:startRelease', (version: unknown, from?: unknown, repo?: unknown) => r.startRelease(text(version), typeof from === 'string' && from ? from : undefined, typeof repo === 'string' && repo ? repo : undefined));
  // The documentation run of a repository: it writes only in its own worktree, and its push and pull request wait in Actions like every other. The desktop window's:
  // webPolicy.ts denies docs:* to a paired browser. `apply` is the person's yes to adding the docs flow and its agent when the workspace has none.
  // What Settings › Documentation shows: root AGENTS.md status and whether a documentation run is going.
  ctx.handle('docs:status', () => docsStatus({ repos: rc().repos, runs: r.list(), flow: !!docsFlowOf(getConfig())?.length }));
  ctx.handle('docs:start', (repo: unknown, mode: unknown, apply?: unknown) => startDocsRun({ runner: r, config: getConfig, applyFlow: applyDocsFlow }, text(repo), text(mode), apply === true));
  ctx.handle('runs:startStage', (run: unknown) => r.startStage(id(run)));
  ctx.handle('runs:accept', (run: unknown, note?: unknown) => r.accept(id(run), text(note)));
  ctx.handle('runs:return', (run: unknown, note: unknown) => r.returnStage(id(run), text(note)));
  ctx.handle('runs:gate', (run: unknown, action: unknown, reason?: unknown) => r.gate(id(run), action as GateAction, text(reason)));
  // The files of the answer travel with it: the person attaches them to the message that answers the run's question, and the answer carries the refs.
  ctx.handle('runs:answer', (run: unknown, answer: unknown, attachments?: unknown) =>
    r.answer(
      id(run),
      text(answer),
      Array.isArray(attachments)
        ? attachments.filter((a): a is AttachmentRef => !!a && typeof (a as AttachmentRef).id === 'string').map((a) => ({ id: a.id, name: String(a.name ?? ''), kind: a.kind, bytes: Number(a.bytes) || 0 }))
        : undefined,
    ));
  ctx.handle('runs:retry', (run: unknown) => r.retry(id(run)));
  ctx.handle('runs:cancel', (run: unknown) => r.cancel(id(run)));
  // Lets a `shell: host` agent run a command on this computer: from a paired browser only with the same switch as approving a proposal (webPolicy.ts).
  ctx.handle('runs:command', (run: unknown, command: unknown, decision: unknown, note?: unknown) => r.command(id(run), text(command), decision as CommandDecision, text(note)));
  ctx.handle('runs:skipWait', (run: unknown, reason: unknown) => r.skipWait(id(run), text(reason)));
  ctx.handle('runs:sendBack', (run: unknown, stage: unknown, note: unknown) => r.sendBack(id(run), text(stage), text(note)));
  ctx.handle('runs:migrateFlow', (run: unknown) => r.migrateFlow(id(run)));
  ctx.handle('runs:undoPost', (run: unknown, key: unknown) => r.undoPost(id(run), text(key)));
  ctx.handle('runs:setSquad', (run: unknown, squad: unknown) => r.setSquad(id(run), typeof squad === 'string' && squad ? squad : null));
  ctx.handle('runs:removeSquad', (squad: unknown, confirm?: unknown) => r.removeSquad(text(squad), confirm === true));
  ctx.handle('runs:setSquadAutonomous', (squad: unknown, on: unknown) => {
    if (typeof on !== 'boolean') throw new RunError('unknown-squad', { squad: '' });
    r.setSquadAutonomous(text(squad), on);
    return getConfig().squads?.find((q) => q.id === squad)?.autonomy ?? true;
  });
  ctx.handle('runs:setAutonomous', (agent: unknown, on: unknown) => {
    if (typeof agent !== 'string' || typeof on !== 'boolean') throw new RunnerError('unknown-agent', { agent: '' });
    r.setAutonomous(agent, on);
    return getConfig().agents.team.find((a) => a.id === agent)?.autonomous ?? false;
  });

  ctx.job({
    name: 'runner',
    everyMin: 5,
    workHoursOnly: false,
    enabled: () => getConfig().runner.enabled && isFlowCycle(getConfig().devCycle.stages) && vcsReady(),
    // Looks for new issues, for what the waiting runs wait for (a merged pull request, a reply, a label, the time) and for the reviews that waited for their pull
    // request. It never waits for a stage to end, and a sweep that is still going is not started twice.
    run: () => r.sweep(),
  });
  // A run that was in the middle of a stage when the app closed starts that stage over; the others go on where they were.
  setTimeout(() => r.resume(), 2_000);
};
