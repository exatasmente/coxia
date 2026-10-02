import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, ipcMain, nativeImage, session, shell } from 'electron';
import type { Settings } from '../shared/settings';
import type { AgentTurn, AppEvent, Card, Minutes, SavedCeremony, Voice } from '../shared/types';
import { approveAction, conflictTalk, detectRelease, listActions, previewAction, skipAction, startActions } from './actions';
import { deepAsk, deepOptions, prepareTurn, reply, teamsText } from './agents';
import { loadCards } from './cards';
import { continueInClaude } from './claude';
import { getSettings, saveSettings } from './config';
import { answerGate, explainGate, gateOptions, getGate, insertGateVisual, newGateRound, recordGate, startGate, visualGate } from './gate';
import { askQa, getQa, prepareQa, writeQaChecklist } from './qa';
import { askRetro, latestRetro, prepareRetro } from './retro';
import { MODULES } from './modules';
import { checkStatus, type Notice, registerJob, startScheduler } from './scheduler';
import { getHistory, listHistory, loadState, saveState } from './state';
import { saveMinutes } from './store';
import { speak, startVoice, stopVoice, transcribe, voicesFor } from './voice';

const RESOURCES = join(import.meta.dirname, '../../resources');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function show(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function emit(ev: AppEvent): void {
  win?.webContents.send('app:event', ev);
}

function notify(n: Notice): void {
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: n.title, body: n.body, icon: join(RESOURCES, 'icon.png') });
  note.on('click', () => {
    show();
    emit(n.onClick);
  });
  note.show();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 760,
    minHeight: 560,
    title: 'Cerimônias',
    icon: join(RESOURCES, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#F4F5F7',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
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

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(join(RESOURCES, 'tray.png')));
  tray.setToolTip('Cerimônias');
  const go = (to: 'today' | 'call' | 'settings' | 'history' | 'actions' | 'retro') => () => {
    show();
    emit({ type: 'navigate', to });
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir', click: show },
      { label: 'Pré-daily agora', click: go('call') },
      { label: 'Conferir status agora', click: () => void checkStatus(true).catch((e) => console.error('[status]', e)) },
      { label: 'Ações de release', click: go('actions') },
      { label: 'Conferir release agora', click: () => void detectRelease(true).catch((e) => console.error('[release]', e)) },
      { label: 'Retro da semana', click: go('retro') },
      { label: 'Histórico', click: go('history') },
      { label: 'Configurações', click: go('settings') },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', show);
}

function handlers(): void {
  ipcMain.handle('state:load', () => loadState());
  ipcMain.handle('state:save', (_e, state: SavedCeremony) => saveState(state));
  ipcMain.handle('history:list', () => listHistory());
  ipcMain.handle('history:get', (_e, id: string) => getHistory(id));
  ipcMain.handle('cards:load', (_e, limit: number) => loadCards(limit));
  ipcMain.handle('agent:prepare', (_e, card: Card) => prepareTurn(card));
  ipcMain.handle('agent:reply', (_e, card: Card, turn: AgentTurn, text: string) => reply(card, turn, text));
  ipcMain.handle('deep:ask', (_e, card: Card, question: string, sessionId: string | null) => deepAsk(card, question, sessionId));
  ipcMain.handle('deep:options', (_e, card: Card, sessionId: string) => deepOptions(card, sessionId));
  ipcMain.handle('ata:teams', (_e, minutes: Minutes, cards: Card[]) => teamsText(minutes, cards));
  ipcMain.handle('ata:save', (_e, minutes: Minutes, teams: string, selected: number[]) => saveMinutes(minutes, teams, selected));
  ipcMain.handle('voice:speak', async (_e, text: string, voice: Voice) => {
    const path = await speak(text, voice, getSettings().voice.engine);
    const bytes = readFileSync(path);
    unlinkSync(path);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
  ipcMain.handle('voice:transcribe', (_e, audio: ArrayBuffer) => transcribe(audio));
  ipcMain.handle('voice:list', () => voicesFor(getSettings().voice.engine));
  ipcMain.handle('clipboard:copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, s: Settings) => saveSettings(s));
  ipcMain.handle('claude:continue', (_e, sessionId: string, prompt?: string) => continueInClaude(sessionId, prompt));
  ipcMain.handle('status:check', () => checkStatus(true));
  ipcMain.handle('actions:list', () => listActions());
  ipcMain.handle('actions:detect', () => detectRelease(true));
  ipcMain.handle('actions:preview', (_e, id: string) => previewAction(id));
  ipcMain.handle('actions:approve', (_e, id: string) => approveAction(id));
  ipcMain.handle('actions:skip', (_e, id: string) => skipAction(id));
  ipcMain.handle('actions:conflict', (_e, id: string, question: string) => conflictTalk(id, question));
  ipcMain.handle('gate:options', (_e, card: Card) => gateOptions(card));
  ipcMain.handle('gate:start', (_e, card: Card, gate: 1 | 2) => startGate(card, gate));
  ipcMain.handle('gate:get', (_e, id: string) => getGate(id));
  ipcMain.handle('gate:answer', (_e, id: string, q: number, input: { choice?: number; text?: string }) => answerGate(id, q, input));
  ipcMain.handle('gate:explain', (_e, id: string, question: string) => explainGate(id, question));
  ipcMain.handle('gate:visual', (_e, id: string) => visualGate(id));
  ipcMain.handle('gate:insert', (_e, id: string) => insertGateVisual(id));
  ipcMain.handle('gate:round', (_e, id: string) => newGateRound(id));
  ipcMain.handle('gate:record', (_e, id: string) => recordGate(id));
  ipcMain.handle('qa:prepare', (_e, card: Card) => prepareQa(card));
  ipcMain.handle('qa:get', (_e, iid: string) => getQa(iid));
  ipcMain.handle('qa:ask', (_e, iid: string, question: string) => askQa(iid, question));
  ipcMain.handle('qa:write', (_e, iid: string) => writeQaChecklist(iid));
  ipcMain.handle('retro:prepare', () => prepareRetro());
  ipcMain.handle('retro:latest', () => latestRetro());
  ipcMain.handle('retro:ask', (_e, id: string, question: string) => askRetro(id, question));
}

// A test run with its own data dir gets its own browser profile, so it never takes the real instance's lock.
if (process.env.CERIMONIAS_DATA_DIR) app.setPath('userData', join(process.env.CERIMONIAS_DATA_DIR, 'userData'));

// A second launch brings the running window back instead of opening another ceremony.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
    handlers();
    startVoice();
    createWindow();
    createTray();
    startActions({ notify, emit });
    for (const register of MODULES) {
      register({ handle: (channel, fn) => ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args)), notify, emit, job: registerJob });
    }
    startScheduler({ notify, emit });
  });
  app.on('before-quit', () => {
    quitting = true;
    stopVoice();
  });
  app.on('window-all-closed', () => app.quit());
}
