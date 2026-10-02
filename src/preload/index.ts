import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/types';

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
};

contextBridge.exposeInMainWorld('api', api);
