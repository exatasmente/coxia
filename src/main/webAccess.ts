import { join } from 'node:path';
import type { WebSettings } from '../shared/settings';
import type { AppEvent } from '../shared/types';
import type { PairingCode, WebView } from '../shared/webAccess';
import { getSettings, saveWebSettings } from './config';
import { ATAS } from './env';
import { handle, hasChannel, invoke } from './rpc';
import { createWebApp, startListening, type Listening, type WebApp } from './web';
import { createAuth, type Auth } from './webAuth';

let auth: Auth | null = null;
let current: { app: WebApp; key: string } | null = null;
let state: Listening = { listening: false, address: null, message: 'Desligado.' };
let rendererDir = '';

const theAuth = (): Auth => (auth ??= createAuth(join(ATAS, 'web-sessions.json')));

export function broadcast(ev: AppEvent): void {
  current?.app.broadcast(ev);
}

function view(): WebView {
  const settings = getSettings().web;
  return {
    settings,
    status: { enabled: settings.enabled, ...state, clients: current?.app.clientCount() ?? 0, devices: theAuth().list().length },
    devices: theAuth().list(),
    pairingExpiresAt: theAuth().pairingPending()?.expiresAt ?? null,
  };
}

export async function stopWebAccess(): Promise<void> {
  const prev = current;
  current = null;
  state = { listening: false, address: null, message: 'Desligado.' };
  if (prev) await prev.app.close();
  auth?.flush();
}

/** Starts, restarts or stops the server so it matches the saved settings. */
export async function syncWebAccess(): Promise<void> {
  const w = getSettings().web;
  const key = JSON.stringify([w.enabled, w.host, w.port, w.basePath]);
  if (current?.key === key) return;
  await stopWebAccess();
  if (!w.enabled) return;
  const app = createWebApp({ settings: () => getSettings().web, rendererDir, auth: theAuth(), invoke, hasChannel });
  state = await startListening(app, w);
  if (state.listening) current = { app, key };
  else await app.close();
}

export function registerWebAccess(dir: string): void {
  rendererDir = dir;
  handle('web:view', () => view());
  handle('web:configure', async (patch: Partial<WebSettings>) => {
    const { enabled, host, port, basePath, publicUrl, allowExternalEffects } = { ...getSettings().web, ...patch };
    saveWebSettings({ enabled, host, port, basePath, publicUrl, allowExternalEffects });
    await syncWebAccess();
    return view();
  });
  handle('web:pair', (): PairingCode => theAuth().newPairingCode());
  handle('web:revoke', (id: string) => {
    theAuth().revoke(id);
    current?.app.dropDevice(id);
    return view();
  });
}
