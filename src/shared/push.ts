import type { AppEvent } from './types';

// Where a notification takes the person when tapped. Small and flat so it fits a push payload and a URL query.
export interface PushTarget {
  to: string;
  ref?: string;
  id?: string;
  mr?: string;
  /** With `number`, a merge request that need not be a card of the day ("group/repo" and the number the host shows); only `discussions` takes them. */
  project?: string;
  number?: number;
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

// `chat` (the home) and `overview` (what Today held) join the older names, which stay valid; `board`, `procedures` and `memory` are plain screens the persona offers a button for.
export const PUSH_SCREENS = ['chat', 'overview', 'board', 'procedures', 'memory', 'today', 'call', 'deep', 'ata', 'history', 'settings', 'actions', 'conflict', 'gate', 'qa', 'retro', 'custo', 'quick', 'reentry', 'discussions', 'radar', 'saude', 'auditoria', 'help', 'glossario', 'run', 'runs', 'forum'];
const NEEDS_REF = new Set(['deep', 'gate', 'qa', 'quick', 'reentry', 'discussions']);
const FIELD = /^[\w#.:/-]{1,80}$/;
/** "group/repo", the form the cards carry a project in; a part made only of dots ("..") is no name. */
export const PROJECT = /^(?!\.+\/)[\w.-]{1,60}\/(?!\.+$)[\w.-]{1,60}$/;

export const isMrNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 1e9;

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
  if (o.project !== undefined || o.number !== undefined) {
    // The two go together, and only to the discussions: half a merge request, or one on another screen, is no target.
    if (out.to !== 'discussions' || typeof o.project !== 'string' || !PROJECT.test(o.project) || !isMrNumber(o.number)) return null;
    out.project = o.project;
    out.number = o.number;
  }
  if (NEEDS_REF.has(out.to) && !out.ref && !out.number) return null;
  if (out.to === 'conflict' && !out.id) return null;
  if (out.to === 'run' && !out.id) return null;
  return out;
}

// The screen a Notice opens, derived from the event the desktop would emit on click.
export function noticeTarget(ev: AppEvent): PushTarget {
  const fallback: PushTarget = { to: 'overview' };
  if (ev.type === 'navigate') return parseTarget({ to: ev.to }) ?? fallback;
  if (ev.type === 'deep') return parseTarget({ to: 'deep', ref: ev.card.ref }) ?? fallback;
  if (ev.type === 'conflict') return parseTarget({ to: 'conflict', id: ev.id }) ?? fallback;
  if (ev.type === 'open') {
    const { name, ref, id, mr, project, number } = ev.screen as { name: string; ref?: unknown; id?: unknown; mr?: unknown; project?: unknown; number?: unknown };
    return parseTarget({ to: name, ref, id, mr, project, number }) ?? fallback;
  }
  return fallback;
}

export function targetQuery(t: PushTarget): string {
  const q = new URLSearchParams({ open: t.to });
  for (const key of ['ref', 'id', 'mr', 'project'] as const) if (t[key]) q.set(key, t[key] as string);
  if (t.number !== undefined) q.set('number', String(t.number));
  return q.toString();
}

export function targetFromSearch(search: string): PushTarget | null {
  const q = new URLSearchParams(search);
  const to = q.get('open');
  if (!to) return null;
  const number = q.get('number');
  return parseTarget({
    to,
    ref: q.get('ref') ?? undefined,
    id: q.get('id') ?? undefined,
    mr: q.get('mr') ?? undefined,
    project: q.get('project') ?? undefined,
    // Only digits: "7abc" is no number, and parseInt would read it as 7.
    number: number === null ? undefined : /^\d{1,9}$/.test(number) ? Number(number) : NaN,
  });
}
