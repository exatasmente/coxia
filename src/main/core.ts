import { join } from 'node:path';
import type { HunkChoice } from '../shared/conflict';
import type { Settings } from '../shared/settings';
import type { AgentTurn, AppEvent, Card, Minutes, SavedCeremony, SpeechSegment, TurnOptions, Voice } from '../shared/types';
import { t } from '../shared/i18n';
import { ACTIVITY_EVENT, ACTIVITY_GET, reasoningOn } from '../shared/activity';
import { approveAction, conflictApply, conflictChoose, conflictCommit, conflictDiscard, conflictFromMr, conflictPrepare, conflictPropose, conflictReopen, conflictTalk, detectRelease, freeReleaseCheckout, listActions, previewAction, skipAction, startActions } from './actions';
import { type AdminDoor, type AdminDoorState, createAdminDoor } from './adminDoor';
import { readAdminDoorSetting, writeAdminDoorSetting } from './adminDoorSetting';
import { activityLog, setActivitySink, setThoughtsGate } from './activity';
import { deepAsk, deepOptions, prepareTurn, reply, teamsText } from './agents';
import { setBoardHost } from './board';
import { realBoardHost, startBoardHost } from './boardHost';
import { loadCards } from './cards';
import { continueInClaude, pasteCommand } from './claude';
import { getSettings, saveSettings } from './config';
import { atasDir, bootEnv, dataRoot, workspaceId } from './env';
import { installProcessHandlers, logError } from './errorlog';
import { answerGate, explainGate, gateOptions, getGate, insertGateVisual, newGateRound, recordGate, startGate, visualGate } from './gate';
import { glossary } from './glossary';
import { type HostPort, appVersion, setHostPort } from './host';
import { MoveError, exportBundle } from './moveBundle';
import { homedir } from 'node:os';
import { MODULES } from './modules';
import { disarmAll } from './plugins/module';
import { type PathsPort, setPathsPort } from './paths';
import { recordWrite } from './auditoria';
import { askQa, getQa, prepareQa, writeQaChecklist } from './qa';
import { askRetro, latestRetro, prepareRetro } from './retro';
import { type Ownership, type OwnershipStatus, OwnershipError, createOwnership, instanceIdOf, setOwnership } from './ownership';
import { pauseRunner, startRunner, stopRunner } from './runner/module';
import { handle, hello, viaOf } from './rpc';
import { CONTRACT_VERSION, ContractError } from '../shared/contract';
import { type Notice, checkStatus, registerJob, startScheduler, stopScheduler } from './scheduler';
import { secrets, setCryptoPort } from './secrets';
import type { CryptoPort } from './secrets-core';
import { stopUpdates } from './updates';
import { getHistory, listHistory, loadState, saveState } from './state';
import { saveMinutes } from './store';
import { cancelSpeech, planSpeech, speakSegment, startVoice, stopVoice, transcribe, voicesFor } from './voice';
import { broadcast, pushNotice, registerWebAccess, setWebOverride, stopWebAccess, syncWebAccess, webListening } from './webAccess';
import { getConfig } from './workspaceConfig';

// The core as a value: everything the app does that is not the window, the tray or the runtime, started and stopped by whoever owns the process.
// The desktop calls it inside app.whenReady(); a headless host calls it from a plain Node process. Nothing here reaches the desktop runtime.

/** What a window does with what the core says. Absent on a host without one. */
export interface Window {
  /** An event for the window alone: the paired browsers are reached by the core itself. */
  emit(ev: AppEvent): void;
  /** For a feature a paired browser must never see. */
  emitWindow(ev: AppEvent): void;
  /** A notice for the desktop; the paired phones get theirs from the core. */
  notify(n: Notice): void;
}

export interface CoxiaOptions {
  /** The data folder of this process; CERIMONIAS_DATA_DIR, or the standard folder, when absent. */
  dataDir?: string;
  /** The workspace this process runs; the registry's current one when absent. It must exist, and the registry's current one is left as it is. */
  workspace?: string;
  /** The address of the web door for this process alone: it listens there, enabled, over the saved settings, and nothing is written to them. */
  web?: { host: string; port: number };
  /** The encryption behind stored secrets (the keychain, or the master key file of a server). Absent: no secret is stored. */
  secrets?: CryptoPort;
  paths?: PathsPort;
  host?: HostPort;
  /** The folder of the built renderer, served to paired browsers. Absent: the web door answers the RPC and no page. */
  rendererDir?: string;
  window?: Window;
  /** Listens on the admin socket in the workspace's folder (#211), for a client on this machine: the server shell, the CLI, the SDK. A host that says so decides it (the headless entry); when absent, the setting of the data root (`admin-door.json`, off by default) does, which the person switches from the desktop window (#309). */
  adminDoor?: boolean;
}

export interface StopOptions {
  /** How long a running stage may take to reach its end before it is interrupted; the interrupted run resumes at the next start. */
  deadlineMs?: number;
}

export interface Coxia {
  /** Registers the channels and the modules and starts what runs by itself (the scheduler, the web door, voice). Once per core. */
  start(): Promise<void>;
  /** Clears every timer, closes the web door, stops voice and the screens, and lets a running stage reach a safe point within the deadline. Safe to call twice. */
  stop(options?: StopOptions): Promise<void>;
  /** Whether the admin socket listens and, when it does not, why; meaningful after `start`. */
  adminDoor(): AdminDoorState | null;
  /** Who owns the workspace and whether this instance does (#209); null before `start`. A client runs neither the runner nor the scheduler. */
  ownership(): OwnershipStatus | null;
}

/** Long enough for a short stage to end by itself, short enough for a service manager that kills after a while. */
export const DEFAULT_STOP_DEADLINE_MS = 10_000;

const SCREEN_FIELDS = ['ref', 'id', 'mr', 'back'];

function fail(tag: string, source: string, e: unknown): void {
  console.error(tag, e);
  logError(source, e);
}

// The channels of the ceremonies and of the screens every client shares; the window's own (the clipboard, a notification) are registered by the desktop.
function handlers(emit: (ev: AppEvent) => void): void {
  handle('state:load', () => loadState());
  handle('state:save', (state: SavedCeremony) => saveState(state));
  handle('history:list', () => listHistory());
  handle('history:get', (id: string) => getHistory(id));
  handle('cards:load', (limit: number, refresh?: boolean, squad?: unknown) => loadCards(limit, refresh, typeof squad === 'string' && squad ? squad : null));
  handle('agent:prepare', (card: Card, options?: TurnOptions) => prepareTurn(card, options));
  handle('agent:reply', (card: Card, turn: AgentTurn, text: string) => reply(card, turn, text));
  handle('deep:ask', (card: Card, question: string, sessionId: string | null) => deepAsk(card, question, sessionId));
  handle('deep:options', (card: Card, sessionId: string) => deepOptions(card, sessionId));
  handle('ata:teams', (minutes: Minutes, cards: Card[]) => teamsText(minutes, cards));
  handle('ata:save', (minutes: Minutes, teams: string, selected: number[], ceremonyId?: string) => saveMinutes(minutes, teams, selected, ceremonyId));
  handle('voice:plan', (text: string, voice: Voice) => {
    const { engine, prosody } = getSettings().voice;
    return planSpeech(text, voice, engine, { prosody, glossary: glossary() });
  });
  handle('voice:segment', (token: string, segment: SpeechSegment) => speakSegment(token, segment));
  handle('voice:cancel', (token: string) => cancelSpeech(token));
  handle('voice:transcribe', (audio: ArrayBuffer) => transcribe(audio, glossary()));
  handle('voice:list', () => voicesFor(getSettings().voice.engine));
  handle('settings:get', () => getSettings());
  handle('settings:save', (s: Settings) => {
    const saved = saveSettings(s);
    emit({ type: 'settings', settings: saved });
    return saved;
  });
  handle('claude:continue', (sessionId: string, prompt?: string) => continueInClaude(sessionId, prompt));
  handle('claude:command', (sessionId: string, prompt?: string) => pasteCommand(sessionId, prompt));
  handle('status:check', () => checkStatus(true));
  handle('actions:list', () => listActions());
  handle('actions:detect', () => detectRelease(true));
  handle('actions:preview', (id: string) => previewAction(id));
  handle('actions:approve', (id: string) => approveAction(id));
  handle('actions:freeBranch', (id: string) => freeReleaseCheckout(id));
  handle('actions:skip', (id: string) => skipAction(id));
  handle('actions:conflict', (id: string, question: string) => conflictTalk(id, question));
  handle('conflict:fromMr', (card: Card, ref: string) => conflictFromMr(card, ref));
  handle('conflict:prepare', (id: string) => conflictPrepare(id));
  handle('conflict:propose', (id: string) => conflictPropose(id));
  handle('conflict:choose', (id: string, hunkId: string, choice: HunkChoice, edited?: string) => conflictChoose(id, hunkId, choice, edited));
  handle('conflict:apply', (id: string, options: { skipTests: boolean }) => conflictApply(id, options));
  handle('conflict:commit', (id: string) => conflictCommit(id));
  handle('conflict:reopen', (id: string) => conflictReopen(id));
  handle('conflict:discard', (id: string) => conflictDiscard(id));
  handle('gate:options', (card: Card) => gateOptions(card));
  handle('gate:start', (card: Card, gate: 1 | 2, file?: string) => startGate(card, gate, typeof file === 'string' ? file : undefined));
  handle('gate:get', (id: string) => getGate(id));
  handle('gate:answer', (id: string, q: number, input: { choice?: number; text?: string }) => answerGate(id, q, input));
  handle('gate:explain', (id: string, question: string) => explainGate(id, question));
  handle('gate:visual', (id: string) => visualGate(id));
  handle('gate:insert', (id: string) => insertGateVisual(id));
  handle('gate:round', (id: string) => newGateRound(id));
  handle('gate:record', (id: string) => recordGate(id));
  handle('qa:prepare', (card: Card) => prepareQa(card));
  handle('qa:get', (iid: string) => getQa(iid));
  handle('qa:ask', (iid: string, question: string) => askQa(iid, question));
  handle('qa:write', (iid: string) => writeQaChecklist(iid));
  handle('retro:prepare', (squad?: unknown) => prepareRetro(typeof squad === 'string' && squad ? squad : null));
  handle('retro:latest', (squad?: unknown) => latestRetro(typeof squad === 'string' && squad ? squad : null));
  handle('retro:ask', (id: string, question: string) => askRetro(id, question));
  handle('contract:hello', (clientVersion: unknown) => hello(clientVersion));
  handle(ACTIVITY_GET, (id?: string | null) => activityLog.get(typeof id === 'string' ? id : null));
}

// The channels of the ownership of the workspace (#209). Handing over and taking over are admin acts: the window, the admin door, or a paired device with a passkey, which
// the web door lets through only with a fresh assertion of kind `ownership` (webPolicy.ts STEP_UP); a paired device without one never reaches these handlers.
function ownershipHandlers(o: Ownership): void {
  handle('ownership:status', () => o.status());
  handle('ownership:release', (to: unknown, deadlineMs?: unknown) => o.release(String(to ?? ''), { by: viaOf(), ...(typeof deadlineMs === 'number' ? { deadlineMs } : {}) }));
  handle('ownership:claim', () => o.claim({ admin: true, by: viaOf() }));
  // The workspace moves to another machine (#309): this instance stops for good and the lease says where it went. Desktop and admin door only (webPolicy DESKTOP_ONLY).
  handle('ownership:move-out', (input?: unknown) => {
    const to = input && typeof input === 'object' ? (input as { to?: unknown }).to : undefined;
    return o.moveOut(typeof to === 'string' ? to : '', { by: viaOf() });
  });
}

// What a workspace that stepped down hands to the machine it moves to (#309). Only on the admin door and the desktop (webPolicy DESKTOP_ONLY), and only once the workspace was moved out.
// The call carries the target machine's key: it is used to encrypt and is in no log, no audit line and no message (moveBundle.ts scrubs it from what it throws).
function moveHandlers(o: Ownership): void {
  handle('move:export', (input?: unknown) => {
    if (!o.status().movedOut) throw new ContractError('forbidden', t('main.move.notMovedOut'));
    const given = input && typeof input === 'object' ? (input as { targetKey?: unknown; out?: unknown }) : {};
    const record = (ok: boolean, fields: Record<string, string>, result: string): void =>
      recordWrite({ kind: 'ownership', issue: 0, target: 'ownership move-export', via: 'ownership', fields: { workspace: workspaceId(), ...fields }, ok, code: null, result, origin: { actionId: '', kind: 'ownership', key: 'move-export', summary: null }, by: viaOf() });
    try {
      const manifest = exportBundle({ root: dataRoot(), workspaceDir: atasDir(), workspaceId: workspaceId(), store: secrets(), version: appVersion(), contractVersion: CONTRACT_VERSION, home: homedir() }, { targetKey: given.targetKey, out: given.out });
      record(true, { out: String(given.out), repos: String(manifest.repos.length), secretsMoved: String(manifest.secrets.moved.length), secretsNotMoved: String(manifest.secrets.notMoved.length) }, '');
      return manifest;
    } catch (e) {
      record(false, {}, e instanceof Error ? e.message : String(e));
      throw e instanceof MoveError ? e : new MoveError('internal', e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * Fixes the data folder and fills the ports; starts nothing. The ports are process-wide, like the data folder: one core per process.
 * A second `start` after a `stop` is refused: the modules keep their registrations and listeners for the life of the process, so a new run of the core is a new process.
 */
export function createCoxia(options: CoxiaOptions = {}): Coxia {
  bootEnv({ ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }), ...(options.workspace === undefined ? {} : { workspace: options.workspace }) });
  setWebOverride(options.web ?? null);
  if (options.secrets) setCryptoPort(options.secrets);
  if (options.paths) setPathsPort(options.paths);
  if (options.host) setHostPort(options.host);

  let started = false;
  let owns: Ownership;
  let stopping: Promise<void> | null = null;
  let dropProcessHandlers: (() => void) | null = null;

  const win = options.window;
  let admin: AdminDoor | null = null;
  // To the window, to every paired browser and to every admin client.
  const emit = (ev: AppEvent): void => {
    win?.emit(ev);
    broadcast(ev);
    admin?.emit(ev);
  };
  const notify = (n: Notice): void => {
    pushNotice(n);
    win?.notify(n);
  };

  async function start(): Promise<void> {
    // i18n-ignore: developer error: the modules cannot be registered twice in a process
    if (started) throw new Error('the core was already started in this process');
    started = true;
    dropProcessHandlers = installProcessHandlers();
    // Before the modules register: the runner reads it to know whether it starts.
    owns = createOwnership({
      dir: atasDir(),
      instanceId: instanceIdOf(dataRoot()),
      audit: recordWrite,
      hooks: {
        pause: async (deadlineMs) => {
          stopScheduler();
          await pauseRunner(deadlineMs);
        },
        resume: () => {
          startScheduler({ notify, emit });
          startRunner();
        },
        // The checks a new owner can make of itself in process: the workspace's configuration reads, the runner exists, and the web door is up when it is on.
        health: async () => {
          try {
            getConfig();
            const door = webListening();
            return getSettings().web.enabled || options.web ? door.listening : true;
          } catch {
            return false;
          }
        },
      },
    });
    setOwnership(owns);
    const first = owns.acquire();
    if (!first.expired && first.owner && first.role === 'client') console.error('[ownership]', t('main.ownership.notOwner', { owner: `${first.owner.host} (${first.owner.instanceId.slice(0, 8)}, pid ${first.owner.pid})` }));
    handlers(emit);
    ownershipHandlers(owns);
    moveHandlers(owns);
    setActivitySink((entry) => emit({ type: 'module', name: ACTIVITY_EVENT, payload: entry }));
    // Read when a thought is made, so the switch of the workspace takes effect from the next one.
    setThoughtsGate(() => reasoningOn(getConfig()));
    // Without a page to serve, the folder is one that does not exist: an empty path would resolve to the working directory.
    registerWebAccess(options.rendererDir ?? join(dataRoot(), '.no-renderer'));
    startVoice();
    startActions({ notify, emit });
    // The board reaches the code host through one door, handed in once and never handed back to a module.
    setBoardHost(realBoardHost);
    startBoardHost();
    for (const register of MODULES) {
      register({ handle, notify, emit, ...(win ? { emitWindow: win.emitWindow } : {}), job: registerJob });
    }
    // Only the owner of the workspace runs the scheduler and the runner; a client serves the channels and the doors (#209).
    if (owns.running()) startScheduler({ notify, emit });
    await syncWebAccess().catch((e) => fail('[web]', 'module:web', e));
    // A window that is only a client says so, once, with the notice every other event of the desktop uses.
    if (!owns.running() && first.owner) notify({ title: t('main.ownership.noticeTitle'), body: t('main.ownership.noticeBody', { owner: first.owner.host }), onClick: { type: 'navigate', to: 'actions' } });
    // Last, so every channel is registered when the first client connects. A door that cannot open says why and the core goes on.
    if (options.adminDoor ?? readAdminDoorSetting(dataRoot())) await openAdmin();
    // Only the window switches the door: it is the one door the person's own hands are on (a paired browser and the admin door itself are refused, as is any other origin).
    handle('adminDoor:get', () => adminView());
    handle('adminDoor:set', async (enabled: unknown) => {
      if (viaOf() !== 'window') throw new ContractError('forbidden', t('main.admin.windowOnly'));
      if (typeof enabled !== 'boolean') throw new ContractError('invalid-input', t('main.admin.badRequest'));
      writeAdminDoorSetting(dataRoot(), enabled);
      if (enabled) await openAdmin();
      else await closeAdmin();
      return adminView();
    });
  }

  async function openAdmin(): Promise<void> {
    if (admin) return;
    admin = createAdminDoor(atasDir(), workspaceId);
    await admin.start();
  }
  async function closeAdmin(): Promise<void> {
    const door = admin;
    admin = null;
    await door?.stop().catch((e) => fail('[admin]', 'core:admin-door', e));
  }
  const adminView = (): AdminDoorState & { enabled: boolean } => ({ enabled: readAdminDoorSetting(dataRoot()), listening: false, path: '', reason: '', ...admin?.state() });

  function stop(stopOptions: StopOptions = {}): Promise<void> {
    stopping ??= (async () => {
      const deadlineMs = stopOptions.deadlineMs ?? DEFAULT_STOP_DEADLINE_MS;
      // The door first: no new call arrives while the running work ends.
      await admin?.stop().catch((e) => fail('[stop]', 'core:stop', e));
      // The lease is let go after the work ends, below, so a next start does not find it held by a dead process.
      // The timers next, so nothing new starts while the running work ends.
      stopScheduler();
      stopUpdates();
      disarmAll();
      try {
        await stopRunner(deadlineMs);
      } catch (e) {
        fail('[stop]', 'core:stop', e);
      }
      owns?.stop();
      setOwnership(null);
      stopVoice();
      await stopWebAccess().catch((e) => fail('[stop]', 'core:stop', e));
      setActivitySink(null);
      dropProcessHandlers?.();
      dropProcessHandlers = null;
    })();
    return stopping;
  }

  return { start, stop, adminDoor: () => admin?.state() ?? null, ownership: () => (started ? owns.status() : null) };
}
