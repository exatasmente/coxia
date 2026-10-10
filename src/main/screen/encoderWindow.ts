import { join } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { SCREEN_ENCODER_COMMAND, SCREEN_ENCODER_EVENT } from '../../shared/screen';
import { RESOURCES } from '../paths';
import type { EncoderEnv } from './encoderHost';

// The real window behind the encoder host: hidden, sandboxed, with a bridge that offers it nothing but the two channels, an in-memory partition of its own, every
// permission refused and no way to navigate or open anything. It runs the page in resources/encoder.html, which only encodes what the main process sends it.

export function realEncoderEnv(): EncoderEnv {
  return {
    create(gone) {
      const w = new BrowserWindow({
        show: false,
        width: 320,
        height: 240,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // The page works when a frame arrives, not on a timer, but a hidden window's timers and messages are throttled all the same.
          backgroundThrottling: false,
          partition: 'coxia-screen-encoder',
          preload: join(import.meta.dirname, '../preload/encoder.cjs'),
        },
      });
      const wc = w.webContents;
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.on('will-navigate', (e) => e.preventDefault());
      wc.on('will-attach-webview', (e) => e.preventDefault());
      wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      wc.session.setPermissionCheckHandler(() => false);
      wc.on('render-process-gone', gone);
      w.on('closed', gone);
      void w.loadFile(join(RESOURCES, 'encoder.html')).catch(gone);
      return {
        id: wc.id,
        send: (command) => {
          if (!w.isDestroyed()) wc.send(SCREEN_ENCODER_COMMAND, command);
        },
        destroy: () => {
          if (!w.isDestroyed()) w.destroy();
        },
      };
    },
    listen(handler) {
      const on = (e: { sender: { id: number } }, raw: unknown): void => handler(e.sender.id, raw);
      ipcMain.on(SCREEN_ENCODER_EVENT, on);
      return () => void ipcMain.removeListener(SCREEN_ENCODER_EVENT, on);
    },
    schedule(ms, fn) {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return () => clearTimeout(timer);
    },
  };
}
