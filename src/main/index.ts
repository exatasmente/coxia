import { join } from 'node:path';
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, ipcMain, nativeImage, session, shell } from 'electron';
import type { AppEvent } from '../shared/types';
import { detectRelease } from './actions';
import { getSettings } from './config';
import { createCoxia } from './core';
import { electronPorts } from './electronPorts';
import { installProcessHandlers, logError } from './errorlog';
import { resourcesDir } from './paths';
import { wantsQuitForUpdate } from './update-core';
import { SHOWN_EVENT } from '../shared/update';
import { announceRunning, flushRenderer, forgetRunning, terminateChildren, trackWindow } from './update';
import { beforeQuit as updatesBeforeQuit, onWindowFocus, setUpdateHooks } from './updates';
import { bindIpc, handle } from './rpc';
import { upperFirst } from '../shared/cycles/text';
import { ceremonyLabel } from './cyclePrompts';
import { onConfigChange } from './workspaceConfig';
import { type Notice, checkStatus } from './scheduler';
import { broadcast } from './webAccess';
import { t } from '../shared/i18n';
import { warmLoginPath } from './loginPath';

// The modules load before this body runs, and none of them touches the disk on import: the core fixes the data folder when it is made, and the desktop
// gives it the keychain, the folders and the process it owns, which the secrets, paths and host modules read at the time of use.
// An error thrown before the core starts (making the window, the tray) still reaches the error log; the core leaves these handlers to the desktop.
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

// The window alone: what a paired browser must never receive (the machine's Claude Code sessions).
function emitWindow(ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('app:event', ev);
}

function showNotice(n: Notice, send: (ev: AppEvent) => void): void {
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: n.title, body: n.body, icon: join(resourcesDir(), 'icon.png') });
  note.on('click', () => {
    show();
    send(n.onClick);
  });
  note.show();
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
    icon: join(resourcesDir(), 'icon.png'),
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

const go = (to: 'chat' | 'overview' | 'today' | 'call' | 'settings' | 'history' | 'actions' | 'retro') => () => {
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
  tray = new Tray(nativeImage.createFromPath(join(resourcesDir(), 'tray.png')));
  tray.setToolTip('Coxia');
  tray.setContextMenu(trayMenu());
  // The labels follow the language of the workspace: rebuild when the configuration changes.
  onConfigChange(() => tray?.setContextMenu(trayMenu()));
  tray.on('click', show);
}

// The channels that only the window can serve: they need the clipboard and the desktop's notifications.
function desktopHandlers(): void {
  handle('clipboard:copy', (text: string) => clipboard.writeText(text));
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
  const core = createCoxia({
    ...electronPorts(),
    rendererDir: join(import.meta.dirname, '../renderer'),
    window: { emit: emitWindow, emitWindow, notify: (n) => showNotice(n, emit) },
  });
  app.whenReady().then(async () => {
    // The PATH of the person's login shell is what the commands of a run need; reading it takes a moment, so it starts now.
    warmLoginPath();
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
    bindIpc((channel, fn) => ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args)));
    desktopHandlers();
    createWindow();
    createTray();
    await core.start();
    announceRunning();
  });
  app.on('quit', (_e, code) => console.log(`[app] quit with exit code ${code}`));
  // The core stops before the app goes (the open screens keep their recordings, the web door closes, a stage in the middle is left for the next start): the quit is held once, then asked again.
  let stopped = false;
  let stopping = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (!stopped) {
      event.preventDefault();
      if (!stopping) {
        stopping = true;
        // No grace for a stage: closing the app has always interrupted it, and the next start takes it over.
        void core.stop({ deadlineMs: 0 }).finally(() => {
          stopped = true;
          app.quit();
        });
      }
      return;
    }
    updatesBeforeQuit();
    forgetRunning();
  });
  app.on('window-all-closed', () => app.quit());
}
