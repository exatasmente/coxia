import { contextBridge, ipcRenderer } from 'electron';
import { buildApi } from '../shared/apiChannels';
import type { AppEvent } from '../shared/types';

const api = buildApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (cb) => {
    const listener = (_e: unknown, ev: AppEvent) => cb(ev);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
);

contextBridge.exposeInMainWorld('api', api);
