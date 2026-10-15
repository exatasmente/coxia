import { join } from 'node:path';
import type { WebSettings } from '../shared/settings';
import type { AppEvent } from '../shared/types';
import type { PairingCode, WebView } from '../shared/webAccess';
import { getSettings, saveWebSettings } from './config';
import { dataRoot } from './env';
import { passkeys } from './passkey';
import { handle, handleDevice, hasChannel, invoke } from './rpc';
import { createWebApp, startListening, type Listening, type WebApp } from './web';
import { createAuth, type Auth } from './webAuth';
import { effectivePublicUrl, webOverride } from './webOverride';
import { createPush, type PushNotice, type PushService, testOriginsFromEnv } from './webPush';

let auth: Auth | null = null;
let current: { app: WebApp; key: string } | null = null;
let state: Listening = { listening: false, address: null, message: 'Desligado.' };
let rendererDir = '';
// The saved web settings with this process's own address over them (see webOverride.ts): enabled, because asking for an address is asking for the door.
const webSettings = (): WebSettings => {
  const saved = getSettings().web;
  const override = webOverride();
  if (!override) return saved;
  return { ...saved, enabled: true, host: override.host, port: override.port, publicUrl: effectivePublicUrl(saved.publicUrl) };
};

const theAuth = (): Auth => (auth ??= createAuth(join(dataRoot(), 'web-sessions.json')));

let push: PushService | null = null;

// The VAPID subject is the public address, never a person's email; a local test address falls back to a fixed https placeholder.
function vapidSubject(): string {
  const url = webSettings().publicUrl;
  return url.startsWith('https://') ? url : 'https://localhost/';
}

const thePush = (): PushService =>
  (push ??= createPush({
    dir: dataRoot(),
    subject: vapidSubject(),
    deviceIds: () => theAuth().list().map((d) => d.id),
    notificationsOn: () => getSettings().notifications,
    extraOrigins: testOriginsFromEnv(process.env.CERIMONIAS_PUSH_TEST_ORIGIN),
  }));

/** Sends a desktop Notice to the paired phones too; the desktop "notifications" setting is checked by the service. */
export function pushNotice(n: PushNotice): void {
  if (!webSettings().enabled) return;
  try {
    thePush().notify(n);
  } catch (e) {
    console.error('[push]', e instanceof Error ? e.message : e);
  }
}

/** Where the door listens now, for a host that reports it (the headless entry's ready line) and fails when it could not bind. */
export const webListening = (): Listening & { basePath: string } => ({ ...state, basePath: webSettings().basePath });

export function broadcast(ev: AppEvent): void {
  current?.app.broadcast(ev);
}

function view(): WebView {
  const settings = webSettings();
  return {
    settings,
    ...(webOverride() ? { addressFixed: true } : {}),
    ...(webOverride()?.publicUrl ? { publicUrlFixed: true } : {}),
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
  const w = webSettings();
  const key = JSON.stringify([w.enabled, w.host, w.port, w.basePath]);
  if (current?.key === key) return;
  await stopWebAccess();
  if (!w.enabled) return;
  const app = createWebApp({ settings: webSettings, rendererDir, auth: theAuth(), invoke, hasChannel, isAdmin: (id) => passkeys().hasPasskey(id), onDeviceGone: (id) => { push?.removeDevice(id); passkeys().removeDevice(id); } });
  state = await startListening(app, w);
  if (state.listening) current = { app, key };
  else await app.close();
}

export function registerWebAccess(dir: string): void {
  rendererDir = dir;
  handle('web:view', () => view());
  handle('web:configure', async (patch: Partial<WebSettings>) => {
    // With an address fixed for this process the saved enabled/host/port stay as they are (other processes and the desktop read them) and the rest is saved as usual.
    // The same for the public address when this process has its own: the patch's is dropped, the saved one stays for the other workspaces and the desktop.
    const saved = getSettings().web;
    const override = webOverride();
    const { enabled, host, port, basePath, publicUrl, trustedProxy, allowExternalEffects } = {
      ...saved,
      ...patch,
      ...(override ? { enabled: saved.enabled, host: saved.host, port: saved.port } : {}),
      ...(override?.publicUrl ? { publicUrl: saved.publicUrl } : {}),
    };
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
    passkeys().removeDevice(id);
    current?.app.dropDevice(id);
    return view();
  });
  handleDevice('push:key', () => thePush().publicKey());
  handleDevice('push:status', (deviceId: string, endpoint?: string) => thePush().status(deviceId, endpoint));
  handleDevice('push:subscribe', (deviceId: string, sub: unknown, oldEndpoint?: string) => thePush().subscribe(deviceId, sub, oldEndpoint));
  handleDevice('push:unsubscribe', (deviceId: string) => thePush().unsubscribe(deviceId));
  handleDevice('push:test', (deviceId: string) => thePush().test(deviceId));
}
