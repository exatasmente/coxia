import type { AppEvent } from './types';

// Where a notification takes the person when tapped. Small and flat so it fits a push payload and a URL query.
export interface PushTarget {
  to: string;
  ref?: string;
  id?: string;
  mr?: string;
}

export interface PushPayload {
  v: 1;
  title: string;
  body: string;
  tag: string;
  target: PushTarget;
  ts: number;
}

export interface PushStatus {
  // Whether this device has a subscription the server knows (and, when asked, the same endpoint).
  subscribed: boolean;
  // The desktop "notifications" setting: off means real notices are not pushed (the test still is).
  notificationsOn: boolean;
}

export const PUSH_SCREENS = ['today', 'call', 'deep', 'ata', 'history', 'settings', 'actions', 'conflict', 'gate', 'qa', 'retro', 'custo', 'quick', 'reentry', 'discussions', 'radar', 'saude', 'auditoria', 'help', 'glossario', 'run', 'runs', 'forum'];
const NEEDS_REF = new Set(['deep', 'gate', 'qa', 'quick', 'reentry', 'discussions']);
const FIELD = /^[\w#.:/-]{1,80}$/;

export const MAX_TITLE = 80;
export const MAX_BODY = 240;

export function parseTarget(raw: unknown): PushTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.to !== 'string' || !PUSH_SCREENS.includes(o.to)) return null;
  const out: PushTarget = { to: o.to };
  for (const key of ['ref', 'id', 'mr'] as const) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !FIELD.test(v)) return null;
    out[key] = v;
  }
  if (NEEDS_REF.has(out.to) && !out.ref) return null;
  if (out.to === 'conflict' && !out.id) return null;
  if (out.to === 'run' && !out.id) return null;
  return out;
}

// The screen a Notice opens, derived from the event the desktop would emit on click.
export function noticeTarget(ev: AppEvent): PushTarget {
  const today: PushTarget = { to: 'today' };
  if (ev.type === 'navigate') return parseTarget({ to: ev.to }) ?? today;
  if (ev.type === 'deep') return parseTarget({ to: 'deep', ref: ev.card.ref }) ?? today;
  if (ev.type === 'conflict') return parseTarget({ to: 'conflict', id: ev.id }) ?? today;
  if (ev.type === 'open') {
    const { name, ref, id, mr } = ev.screen as { name: string; ref?: unknown; id?: unknown; mr?: unknown };
    return parseTarget({ to: name, ref, id, mr }) ?? today;
  }
  return today;
}

export function targetQuery(t: PushTarget): string {
  const q = new URLSearchParams({ open: t.to });
  for (const key of ['ref', 'id', 'mr'] as const) if (t[key]) q.set(key, t[key] as string);
  return q.toString();
}

export function targetFromSearch(search: string): PushTarget | null {
  const q = new URLSearchParams(search);
  const to = q.get('open');
  if (!to) return null;
  return parseTarget({ to, ref: q.get('ref') ?? undefined, id: q.get('id') ?? undefined, mr: q.get('mr') ?? undefined });
}
