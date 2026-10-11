import { app } from 'electron';
import type { Module } from './module';
import { isAutostart, launchCommandFor, setAutostart } from './autostart-core';
import { isPackaged } from './paths';

// What the login entry runs: the AppImage that is running, the installed binary, or (dev) electron on this repo.
export function launchCommand(): string[] {
  return launchCommandFor({ packaged: isPackaged(), execPath: process.execPath, appPath: app.getAppPath(), appImage: process.env.APPIMAGE });
}

export const autostart: Module = (ctx) => {
  ctx.handle('autostart:get', () => isAutostart());
  ctx.handle('autostart:set', ((on: boolean) => setAutostart(on, launchCommand())) as (...args: never[]) => unknown);
};
