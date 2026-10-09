import { join } from 'node:path';
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, ipcMain, nativeImage, session, shell } from 'electron';
import type { HunkChoice } from '../shared/conflict';
import type { Settings } from '../shared/settings';
import type { AgentTurn, AppEvent, Card, Minutes, SavedCeremony, SpeechSegment, TurnOptions, Voice } from '../shared/types';
import { ACTIVITY_EVENT, ACTIVITY_GET } from '../shared/activity';
import { approveAction, conflictApply, conflictChoose, conflictCommit, conflictDiscard, conflictFromMr, conflictPrepare, conflictPropose, conflictReopen, conflictTalk, detectRelease, listActions, previewAction, skipAction, startActions } from './actions';
import { activityLog, setActivitySink } from './activity';
import { deepAsk, deepOptions, prepareTurn, reply, teamsText } from './agents';
import { loadCards } from './cards';
import { continueInClaude, pasteCommand } from './claude';
import { getSettings, saveSettings } from './config';
import { installProcessHandlers, logError } from './errorlog';
import { answerGate, explainGate, gateOptions, getGate, insertGateVisual, newGateRound, recordGate, startGate, visualGate } from './gate';
import { askQa, getQa, prepareQa, writeQaChecklist } from './qa';
import { askRetro, latestRetro, prepareRetro } from './retro';
import { MODULES } from './modules';
import { endLiveScreens } from './runner/module';
import { RESOURCES } from './paths';
import { wantsQuitForUpdate } from './update-core';
import { SHOWN_EVENT } from '../shared/update';
import { announceRunning, flushRenderer, forgetRunning, terminateChildren, trackWindow } from './update';
import { beforeQuit as updatesBeforeQuit, onWindowFocus, setUpdateHooks } from './updates';
import { bindIpc, handle } from './rpc';
import { setBoardHost } from './board';
import { realBoardHost, startBoardHost } from './boardHost';
import { upperFirst } from '../shared/cycles/text';
import { ceremonyLabel } from './cyclePrompts';
import { onConfigChange } from './workspaceConfig';
import { checkStatus, type Notice, registerJob, startScheduler } from './scheduler';
import { getHistory, listHistory, loadState, saveState } from './state';
import { saveMinutes } from './store';
import { glossary } from './glossary';
import { cancelSpeech, planSpeech, speakSegment, startVoice, stopVoice, transcribe, voicesFor } from './voice';
import { broadcast, pushNotice, registerWebAccess, stopWebAccess, syncWebAccess } from './webAccess';
import { t } from '../shared/i18n';
import { warmLoginPath } from './loginPath';

installProcessHandlers();

// Mitigate blank/black repaints reported on Windows by using Electron's software-rendering path.
if (process.platform === 'win32') app.disableHardwareAcceleration();

// Autostart launches with --hidden: the app starts in the tray only.
const HIDDEN = process.argv.includes('--hidden');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function fail(tag: string, source: string, e: unknown): void {
  console.error(tag, e);
  logError(source, e);
}

function show(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function emit(ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('app:event', ev);
  broadcast(ev);
}

function showNotice(n: Notice, send: (ev: AppEvent) => void): void {
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: n.title, body: n.body, icon: join(RESOURCES, 'icon.png') });
  note.on('click', () => {
    show();
    send(n.onClick);
  });
  note.show();
}

function notify(n: Notice): void {
  pushNotice(n);
  showNotice(n, emit);
}

const SCREEN_FIELDS = ['ref', 'id', 'mr', 'back'];

// A finished agent job, announced by the renderer. Only this window is told on click: paired phones keep their own screen.
function notifyJob(title: unknown, body: unknown, screen: unknown): void {
  if (!getSettings().notifications || typeof title !== 'string' || typeof body !== 'string' || !screen || typeof screen !== 'object') return;
  const raw = screen as Record<string, unknown>;
  if (typeof raw.name !== 'string') return;
  const target: { name: string; [key: string]: unknown } = { name: raw.name };
  for (const key of SCREEN_FIELDS) if (typeof raw[key] === 'string') target[key] = raw[key];
  showNotice({ title: title.slice(0, 80), body: body.slice(0, 240), onClick: { type: 'open', screen: target } }, (ev) => win?.webContents.send('app:event', ev));
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 760,
    minHeight: 560,
    title: 'Coxia',
    icon: join(RESOURCES, 'icon.png'),
    autoHideMenuBar: true,
    show: !HIDDEN,
    backgroundColor: '#F4F5F7',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('[renderer] process gone', d.reason);
    logError('renderer:gone', new Error(`renderer process gone: ${d.reason}`), { exitCode: d.exitCode });
  });
  trackWindow(() => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
  win.on('show', () => win?.webContents.send('app:event', { type: 'module', name: SHOWN_EVENT, payload: null } satisfies AppEvent));
  win.on('focus', onWindowFocus);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Closing keeps the app in the tray so the scheduler goes on; "Sair" in the tray quits.
  win.on('close', (e) => {
    if (!quitting && getSettings().closeToTray && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

const go = (to: 'today' | 'call' | 'settings' | 'history' | 'actions' | 'retro') => () => {
  show();
  emit({ type: 'navigate', to });
};

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: t('main.tray.open'), click: show },
    { label: t('main.tray.ceremonyNow', { ceremony: upperFirst(ceremonyLabel()) }), click: go('call') },
    { label: t('main.tray.statusNow'), click: () => void checkStatus(true).catch((e) => fail('[status]', 'tray:status', e)) },
    { label: t('main.tray.releaseActions'), click: go('actions') },
    { label: t('main.tray.releaseNow'), click: () => void detectRelease(true).catch((e) => fail('[release]', 'tray:release', e)) },
    { label: t('main.tray.retro'), click: go('retro') },
    { label: t('main.tray.history'), click: go('history') },
    { label: t('main.tray.settings'), click: go('settings') },
    { type: 'separator' },
    {
      label: t('main.tray.quit'),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(join(RESOURCES, 'tray.png')));
  tray.setToolTip('Coxia');
  tray.setContextMenu(trayMenu());
  // The labels follow the language of the workspace: rebuild when the configuration changes.
  onConfigChange(() => tray?.setContextMenu(trayMenu()));
  tray.on('click', show);
}

function handlers(): void {
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
  handle('clipboard:copy', (text: string) => clipboard.writeText(text));
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
  handle('gate:start', (card: Card, gate: 1 | 2) => startGate(card, gate));
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
  handle(ACTIVITY_GET, (id?: string | null) => activityLog.get(typeof id === 'string' ? id : null));
  handle('jobs:notify', (title: unknown, body: unknown, screen: unknown) => notifyJob(title, body, screen));
}

// The runtime app name, and so Electron's userData folder (browser profile, single-instance lock, voice environment), are pinned to what an
// install made by an earlier version already uses: the public product name (productName, appId) is free to differ without moving anyone's data.
// An explicit --user-data-dir (a scratch run of a release build) still wins.
app.setName('cerimonias');
if (!process.env.CERIMONIAS_DATA_DIR && !app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), 'cerimonias'));

// A test run with its own data dir gets its own browser profile, so it never takes the real instance's lock.
if (process.env.CERIMONIAS_DATA_DIR) app.setPath('userData', join(process.env.CERIMONIAS_DATA_DIR, 'userData'));

let quitRequested = false;

// The window saves what it holds (the ceremony) before the app quits for an update, whichever way the update comes.
async function flushWindow(): Promise<void> {
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    const started = Date.now();
    await flushRenderer((ev) => win?.webContents.send('app:event', ev), 3000);
    console.log(`[update] window state saved in ${Date.now() - started} ms`);
  }
}

setUpdateHooks({ flush: flushWindow });

// scripts/update.sh asks the running app to quit: save what the window holds, then leave the normal way,
// so the AppImage unmounts after the process is gone and not under it.
async function quitForUpdate(): Promise<void> {
  if (quitRequested) return;
  quitRequested = true;
  console.log('[update] quit requested');
  await flushWindow();
  console.log(`[update] stopped ${terminateChildren()} child process(es)`);
  quitting = true;
  app.quit();
  setTimeout(() => app.exit(0), 8000).unref();
}

// A second launch brings the running window back instead of opening another ceremony.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (wantsQuitForUpdate(process.argv)) {
  // Nothing was running, so there is nothing to quit: do not start the app just to close it.
  app.exit(0);
} else {
  app.on('second-instance', (_e, argv) => {
    if (wantsQuitForUpdate(argv)) void quitForUpdate();
    else show();
  });
  app.whenReady().then(() => {
    // The PATH of the person's login shell is what the commands of a run need; reading it takes a moment, so it starts now.
    warmLoginPath();
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
    bindIpc((channel, fn) => ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args)));
    handlers();
    setActivitySink((entry) => emit({ type: 'module', name: ACTIVITY_EVENT, payload: entry }));
    registerWebAccess(join(import.meta.dirname, '../renderer'));
    startVoice();
    createWindow();
    createTray();
    startActions({ notify, emit });
    // The board reaches the code host through one door, handed in once and never handed back to a module.
    setBoardHost(realBoardHost);
    startBoardHost();
    for (const register of MODULES) {
      register({ handle, notify, emit, job: registerJob });
    }
    startScheduler({ notify, emit });
    void syncWebAccess().catch((e) => fail('[web]', 'module:web', e));
    announceRunning();
  });
  app.on('quit', (_e, code) => console.log(`[app] quit with exit code ${code}`));
  app.on('before-quit', () => {
    quitting = true;
    updatesBeforeQuit();
    forgetRunning();
    endLiveScreens();
    stopVoice();
    void stopWebAccess();
  });
  app.on('window-all-closed', () => app.quit());
}
