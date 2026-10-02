import type { PushStatus } from '../../shared/push';
import { api } from './api';

// Browser (PWA) side of Web Push. Never used in the Electron window, which shows native notifications.
export type PushSupport = 'ok' | 'unsupported' | 'ios-install';

const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = (): boolean => (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

export function pushSupport(): PushSupport {
  // iPhone Safari only exposes push to an app added to the Home Screen (iOS 16.4+), so a tab gets the install hint.
  if (isIos() && !isStandalone()) return 'ios-install';
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'ok' : 'unsupported';
}

export function applicationServerKey(key: string): Uint8Array {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array): boolean => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

export async function localSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export const pushStatus = async (): Promise<PushStatus & { endpoint: string | null }> => {
  const sub = await localSubscription();
  const status = await api.invoke<PushStatus>('push:status', sub?.endpoint);
  return { ...status, subscribed: !!sub && status.subscribed, endpoint: sub?.endpoint ?? null };
};

/** Must run straight from a tap: the permission prompt is the first await. */
export async function enablePush(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const key = applicationServerKey(await api.invoke<string>('push:key'));
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  await api.invoke('push:subscribe', sub.toJSON());
  return permission;
}

export async function disablePush(): Promise<void> {
  const sub = await localSubscription();
  await sub?.unsubscribe();
  await api.invoke('push:unsubscribe');
}

export const sendTestPush = (): Promise<unknown> => api.invoke('push:test');
