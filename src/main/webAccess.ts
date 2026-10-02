import { join } from 'node:path';
import { DEFAULT_SETTINGS, type WebSettings } from '../shared/settings';
import type { AppEvent } from '../shared/types';
import type { PairingCode, WebView } from '../shared/webAccess';
import { getSettings, saveWebSettings } from './config';
import { DATA_ROOT } from './env';
import { handle, handleDevice, hasChannel, invoke } from './rpc';
import { createWebApp, startListening, type Listening, type WebApp } from './web';
import { createAuth, type Auth } from './webAuth';
import { createPush, type PushNotice, type PushService, testOriginsFromEnv } from './webPush';

let auth: Auth | null = null;
let current: { app: WebApp; key: string } | null = null;
let state: Listening = { listening: false, address: null, message: 'Desligado.' };
let rendererDir = '';

const theAuth = (): Auth => (auth ??= createAuth(join(DATA_ROOT, 'web-sessions.json')));

let push: PushService | null = null;

// The VAPID subject is the public address, never a person's email; a local test address falls back to the default.
function vapidSubject(): string {
  const url = getSettings().web.publicUrl;
  return url.startsWith('https://') ? url : DEFAULT_SETTINGS.web.publicUrl;
}

const thePush = (): PushService =>
  (push ??= createPush({
    dir: DATA_ROOT,
    subject: vapidSubject(),
    deviceIds: () => theAuth().list().map((d) => d.id),
    notificationsOn: () => getSettings().notifications,
    extraOrigins: testOriginsFromEnv(process.env.CERIMONIAS_PUSH_TEST_ORIGIN),
  }));

/** Sends a desktop Notice to the paired phones too; the desktop "notifications" setting is checked by the service. */
export function pushNotice(n: PushNotice): void {
  if (!getSettings().web.enabled) return;
  try {
    thePush().notify(n);
  } catch (e) {
    console.error('[push]', e instanceof Error ? e.message : e);
  }
}

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
  push?.close();
  auth?.flush();
}

/** Starts, restarts or stops the server so it matches the saved settings. */
export async function syncWebAccess(): Promise<void> {
  const w = getSettings().web;
  const key = JSON.stringify([w.enabled, w.host, w.port, w.basePath]);
  if (current?.key === key) return;
  await stopWebAccess();
  if (!w.enabled) return;
  const app = createWebApp({ settings: () => getSettings().web, rendererDir, auth: theAuth(), invoke, hasChannel, onDeviceGone: (id) => push?.removeDevice(id) });
  state = await startListening(app, w);
  if (state.listening) current = { app, key };
  else await app.close();
}

export function registerWebAccess(dir: string): void {
  rendererDir = dir;
  handle('web:view', () => view());
  handle('web:configure', async (patch: Partial<WebSettings>) => {
    const { enabled, host, port, basePath, publicUrl, trustedProxy, allowExternalEffects } = { ...getSettings().web, ...patch };
    saveWebSettings({ enabled, host, port, basePath, publicUrl, trustedProxy, allowExternalEffects });
    await syncWebAccess();
    return view();
  });
  handle('web:pair', (): PairingCode => theAuth().newPairingCode());
  handle('web:unpair', () => theAuth().cancelPairing());
  handle('web:rename', (id: string, name: string) => {
    theAuth().rename(id, name);
    return view();
  });
  handle('web:revoke', (id: string) => {
    theAuth().revoke(id);
    push?.removeDevice(id);
    current?.app.dropDevice(id);
    return view();
  });
  handleDevice('push:key', () => thePush().publicKey());
  handleDevice('push:status', (deviceId: string, endpoint?: string) => thePush().status(deviceId, endpoint));
  handleDevice('push:subscribe', (deviceId: string, sub: unknown, oldEndpoint?: string) => thePush().subscribe(deviceId, sub, oldEndpoint));
  handleDevice('push:unsubscribe', (deviceId: string) => thePush().unsubscribe(deviceId));
  handleDevice('push:test', (deviceId: string) => thePush().test(deviceId));
}
