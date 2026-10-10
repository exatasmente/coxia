import { contextBridge, ipcRenderer } from 'electron';
import { SCREEN_ENCODER_COMMAND, SCREEN_ENCODER_EVENT } from '../shared/screen';

// The bridge of the hidden window that encodes the screen recording: the page hears the main process's commands and answers on one channel. Nothing else of the app is
// exposed to it, and the channels exist for this window only (the main process checks which window a message came from).
contextBridge.exposeInMainWorld('enc', {
  onCommand: (cb: (command: unknown) => void) => void ipcRenderer.on(SCREEN_ENCODER_COMMAND, (_e, command: unknown) => cb(command)),
  send: (event: unknown) => ipcRenderer.send(SCREEN_ENCODER_EVENT, event),
});
