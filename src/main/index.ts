import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app, clipboard, ipcMain, session, shell } from 'electron';
import type { AgentTurn, Card, Minutes, SavedCeremony, Voice } from '../shared/types';
import { deepAsk, deepOptions, prepareTurn, reply, teamsText } from './agents';
import { loadCards } from './cards';
import { loadState, saveState } from './state';
import { saveMinutes } from './store';
import { AGENT_VOICES, MODERATOR, speak, startVoice, stopVoice, transcribe } from './voice';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    title: 'Cerimônias',
    backgroundColor: '#F4F5F7',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

function handlers(): void {
  ipcMain.handle('state:load', () => loadState());
  ipcMain.handle('state:save', (_e, state: SavedCeremony) => saveState(state));
  ipcMain.handle('cards:load', (_e, limit: number) => loadCards(limit));
  ipcMain.handle('agent:prepare', (_e, card: Card) => prepareTurn(card));
  ipcMain.handle('agent:reply', (_e, card: Card, turn: AgentTurn, text: string) => reply(card, turn, text));
  ipcMain.handle('deep:ask', (_e, card: Card, question: string, sessionId: string | null) => deepAsk(card, question, sessionId));
  ipcMain.handle('deep:options', (_e, card: Card, sessionId: string) => deepOptions(card, sessionId));
  ipcMain.handle('ata:teams', (_e, minutes: Minutes, cards: Card[]) => teamsText(minutes, cards));
  ipcMain.handle('ata:save', (_e, minutes: Minutes, teams: string, selected: number[]) => saveMinutes(minutes, teams, selected));
  ipcMain.handle('voice:speak', async (_e, text: string, voice: Voice) => {
    const path = await speak(text, voice);
    const bytes = readFileSync(path);
    unlinkSync(path);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
  ipcMain.handle('voice:transcribe', (_e, audio: ArrayBuffer) => transcribe(audio));
  ipcMain.handle('voice:list', () => ({ moderator: MODERATOR, agents: AGENT_VOICES }));
  ipcMain.handle('clipboard:copy', (_e, text: string) => clipboard.writeText(text));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
  handlers();
  startVoice();
  createWindow();
});

app.on('window-all-closed', () => {
  stopVoice();
  app.quit();
});
