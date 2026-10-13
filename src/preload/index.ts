import { contextBridge, ipcRenderer } from 'electron';
import { buildApi } from '../shared/apiChannels';
import type { Settled } from '../shared/contract';
import type { AppEvent } from '../shared/types';

// The main process settles every call to a value or a { code, message }; contextBridge would drop the code of a thrown error, so the page gets `call` as it is
// and `invoke` (what the typed methods use) throws the message, as before.
const call = (channel: string, ...args: unknown[]): Promise<Settled> => ipcRenderer.invoke(channel, ...args) as Promise<Settled>;

const api = buildApi(
  async (channel, ...args) => {
    const settled = await call(channel, ...args);
    if (!settled.ok) throw new Error(settled.error.message);
    return settled.value;
  },
  (cb) => {
    const listener = (_e: unknown, ev: AppEvent) => cb(ev);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
);

contextBridge.exposeInMainWorld('api', { ...api, call });
