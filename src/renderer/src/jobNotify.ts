import { parseTarget, type PushTarget } from '../../shared/push';
import { api } from './api';
import { type Job, notificationText, screenPayload } from './jobs';
import { isWeb } from './platform';

const SW_WAIT_MS = 3000;

function targetOf(job: Job): PushTarget {
  const p = screenPayload(job.screen as { name: string });
  return parseTarget({ to: p.name, ref: p.ref, id: p.id, mr: p.mr }) ?? parseTarget({ to: p.name, ref: p.ref, id: p.id }) ?? { to: 'today' };
}

/** Whether the person is looking at the app: the page is visible and the window has focus. */
export function appInView(): boolean {
  return !document.hidden && document.hasFocus();
}

// The desktop window goes through main (the app icon, and a click that can raise a window hidden in the tray); the browser
// build uses the service worker, whose click handler already opens the target. It never asks for permission from here.
export async function systemNotify(job: Job): Promise<void> {
  const { title, body } = notificationText(job);
  if (!isWeb()) {
    await api.invoke('jobs:notify', title, body, screenPayload(job.screen as { name: string }));
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), SW_WAIT_MS))]);
  if (!reg) return;
  const icon = new URL('icon-192.png', document.baseURI).href;
  await reg.showNotification(title, { body, icon, badge: icon, tag: `job:${job.key}`, data: { target: targetOf(job) } });
}
