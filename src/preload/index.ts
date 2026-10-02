import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppEvent } from '../shared/types';

const api: Api = {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  listHistory: () => ipcRenderer.invoke('history:list'),
  getHistory: (id) => ipcRenderer.invoke('history:get', id),
  loadCards: (limit) => ipcRenderer.invoke('cards:load', limit),
  prepareTurn: (card) => ipcRenderer.invoke('agent:prepare', card),
  reply: (card, turn, text) => ipcRenderer.invoke('agent:reply', card, turn, text),
  deepAsk: (card, question, sessionId) => ipcRenderer.invoke('deep:ask', card, question, sessionId),
  deepOptions: (card, sessionId) => ipcRenderer.invoke('deep:options', card, sessionId),
  teamsText: (minutes, cards) => ipcRenderer.invoke('ata:teams', minutes, cards),
  saveMinutes: (minutes, teams, selected) => ipcRenderer.invoke('ata:save', minutes, teams, selected),
  speak: (text, voice) => ipcRenderer.invoke('voice:speak', text, voice),
  transcribe: (audio) => ipcRenderer.invoke('voice:transcribe', audio),
  voices: () => ipcRenderer.invoke('voice:list'),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  continueInClaude: (sessionId) => ipcRenderer.invoke('claude:continue', sessionId),
  checkStatus: () => ipcRenderer.invoke('status:check'),
  listActions: () => ipcRenderer.invoke('actions:list'),
  detectRelease: () => ipcRenderer.invoke('actions:detect'),
  previewAction: (id) => ipcRenderer.invoke('actions:preview', id),
  approveAction: (id) => ipcRenderer.invoke('actions:approve', id),
  skipAction: (id) => ipcRenderer.invoke('actions:skip', id),
  conflictAsk: (id, question) => ipcRenderer.invoke('actions:conflict', id, question),
  onEvent: (cb) => {
    const listener = (_e: unknown, ev: AppEvent) => cb(ev);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
