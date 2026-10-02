import { join } from 'node:path';
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, ipcMain, nativeImage, session, shell } from 'electron';
import type { Settings } from '../shared/settings';
import type { AgentTurn, AppEvent, Card, Minutes, SavedCeremony, SpeechSegment, Voice } from '../shared/types';
import { approveAction, conflictTalk, detectRelease, listActions, previewAction, skipAction, startActions } from './actions';
import { deepAsk, deepOptions, prepareTurn, reply, teamsText } from './agents';
import { loadCards } from './cards';
import { continueInClaude } from './claude';
import { getSettings, saveSettings } from './config';
import { answerGate, explainGate, gateOptions, getGate, insertGateVisual, newGateRound, recordGate, startGate, visualGate } from './gate';
import { askQa, getQa, prepareQa, writeQaChecklist } from './qa';
import { askRetro, latestRetro, prepareRetro } from './retro';
import { MODULES } from './modules';
import { RESOURCES } from './paths';
import { bindIpc, handle } from './rpc';
import { checkStatus, type Notice, registerJob, startScheduler } from './scheduler';
import { getHistory, listHistory, loadState, saveState } from './state';
import { saveMinutes } from './store';
import { glossary } from './glossary';
import { cancelSpeech, planSpeech, speakSegment, startVoice, stopVoice, transcribe, voicesFor } from './voice';
import { broadcast, registerWebAccess, stopWebAccess, syncWebAccess } from './webAccess';

// Autostart launches with --hidden: the app starts in the tray only.
const HIDDEN = process.argv.includes('--hidden');

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
  broadcast(ev);
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
    show: !HIDDEN,
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
  handle('state:load', () => loadState());
  handle('state:save', (state: SavedCeremony) => saveState(state));
  handle('history:list', () => listHistory());
  handle('history:get', (id: string) => getHistory(id));
  handle('cards:load', (limit: number, refresh?: boolean) => loadCards(limit, refresh));
  handle('agent:prepare', (card: Card) => prepareTurn(card));
  handle('agent:reply', (card: Card, turn: AgentTurn, text: string) => reply(card, turn, text));
  handle('deep:ask', (card: Card, question: string, sessionId: string | null) => deepAsk(card, question, sessionId));
  handle('deep:options', (card: Card, sessionId: string) => deepOptions(card, sessionId));
  handle('ata:teams', (minutes: Minutes, cards: Card[]) => teamsText(minutes, cards));
  handle('ata:save', (minutes: Minutes, teams: string, selected: number[]) => saveMinutes(minutes, teams, selected));
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
  handle('settings:save', (s: Settings) => saveSettings(s));
  handle('claude:continue', (sessionId: string, prompt?: string) => continueInClaude(sessionId, prompt));
  handle('status:check', () => checkStatus(true));
  handle('actions:list', () => listActions());
  handle('actions:detect', () => detectRelease(true));
  handle('actions:preview', (id: string) => previewAction(id));
  handle('actions:approve', (id: string) => approveAction(id));
  handle('actions:skip', (id: string) => skipAction(id));
  handle('actions:conflict', (id: string, question: string) => conflictTalk(id, question));
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
  handle('retro:prepare', () => prepareRetro());
  handle('retro:latest', () => latestRetro());
  handle('retro:ask', (id: string, question: string) => askRetro(id, question));
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
    bindIpc((channel, fn) => ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args)));
    handlers();
    registerWebAccess(join(import.meta.dirname, '../renderer'));
    startVoice();
    createWindow();
    createTray();
    startActions({ notify, emit });
    for (const register of MODULES) {
      register({ handle, notify, emit, job: registerJob });
    }
    startScheduler({ notify, emit });
    void syncWebAccess().catch((e) => console.error('[web]', e));
  });
  app.on('before-quit', () => {
    quitting = true;
    stopVoice();
    void stopWebAccess();
  });
  app.on('window-all-closed', () => app.quit());
}
