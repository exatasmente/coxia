import { lazyLabels } from './i18n';

// Browser (PWA) sends that may wait in the offline queue and be replayed. Each one only talks to the agents or reads/writes
// local state: nothing here reaches GitLab or the desktop machine, and webPolicy allows all of them (a test enforces it).
export const QUEUEABLE: Record<string, string> = lazyLabels(['agent:reply', 'deep:ask', 'gate:answer', 'gate:explain', 'qa:ask', 'retro:ask', 'actions:conflict', 'forum:attachment-put', 'forum:attachment-post', 'forum:attachment-drop'], 'main.outbox');

export const isQueueable = (channel: string): boolean => Object.prototype.hasOwnProperty.call(QUEUEABLE, channel);

export const IDEMPOTENCY_HEADER = 'X-Idempotency-Key';
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

// IndexedDB shared by the page and the service worker (sw.js repeats these names: keep them in sync).
export const OUTBOX_DB = 'cerimonias-outbox';
export const OUTBOX_STORE = 'items';
export const OUTBOX_TAG = 'cerimonias-outbox';
export const OUTBOX_CHANNEL = 'cerimonias-outbox';
export const OUTBOX_MAX_AGE_MS = 6 * 3600_000;

export type OutboxStatus = 'queued' | 'done' | 'failed';

export interface OutboxItem {
  id: string;
  channel: string;
  label: string;
  // Wire-encoded argument list, ready to POST.
  body: string;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  // Wire-encoded response body of a finished item.
  result?: string;
  error?: string;
  excerpt?: string;
}
