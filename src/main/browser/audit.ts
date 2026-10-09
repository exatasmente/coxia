import type { AuditEntry } from '../../shared/auditoria';
import { recordWrite } from '../auditoria';
import { redact } from '../errorlog-core';

// What an agent's virtual screen writes to `auditoria.jsonl`: the screen opening and closing, a step the app held for the person, a confirmation the agent asked for, and the
// intervals in which a person used the screen. Each entry is built from a fixed set of fields, so what the log never holds has no field to arrive in: no keystroke, no typed
// value, no cookie, no page text beyond the name of a control, and no URL path (a site is a host and nothing after it). The log's own scrubbing (tokens) applies on top.

export type ScreenPlace = 'stage' | 'conversation';
/** How the agent's commands run: a sandbox, the computer, or no shell at all (the app's browser only). */
export type ScreenMode = 'sandbox' | 'host' | 'none';
/** Which way to the screen was used: the app's browser, the agent's own shell (its own Playwright), or both. */
export type ScreenPath = 'app-browser' | 'shell' | 'both';
export type ScreenProfile = 'own' | 'fresh' | 'none';
export type ScreenEnd = 'idle' | 'person' | 'failed' | 'stopped' | 'config' | 'max' | 'quit' | 'stage' | 'thread';
export type ScreenAnswer = 'yes' | 'no' | 'site' | 'timeout' | 'closed';
/** Who answered: the window of the app, a paired browser, or nobody (a timeout, a close). */
export type AnsweredThrough = 'window' | 'paired' | 'none';

interface Who {
  /** The screen key (`run:<id>` or `call:<thread>:<agent>`). */
  key: string;
  agent: string;
  place: ScreenPlace;
  /** The issue of the run the screen belongs to; absent in a conversation outside a run. */
  issue?: number;
}

const SHORT = 200;
const COUNTS_MAX = 280;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const words = (text: string, max = SHORT): string => clip(redact(oneLine(text)), max);

/** The host of an address, or of a bare host, and nothing after it: no path, no query, no fragment, no port, no credentials. Empty when there is none. */
export function siteOf(address: string): string {
  const text = address.trim();
  if (!text) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** `a=3, b=1`, the most used first, cut to what a field of the log holds. Counts only: a name is a tool or a host, never a value. */
export function countsText(counts: Record<string, number>): string {
  const rows = Object.entries(counts)
    .filter(([, n]) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let out = '';
  for (const [name, n] of rows) {
    const piece = `${out ? ', ' : ''}${name.slice(0, 80)}=${Math.floor(n)}`;
    if (out.length + piece.length > COUNTS_MAX) return `${out}, …`;
    out += piece;
  }
  return out || '—';
}

const base = (who: Who): Pick<AuditEntry, 'issue' | 'origin' | 'by'> => ({
  issue: who.issue && who.issue > 0 ? who.issue : 0,
  origin: { actionId: '', kind: 'screen', key: who.key, summary: null },
  by: who.agent,
});

export interface ScreenOpened extends Who {
  mode: ScreenMode;
  path: ScreenPath;
  profile: ScreenProfile;
  /** The message that asked (a conversation) by its number; absent for a stage. */
  message?: number;
}

export const screenOpenEntry = (o: ScreenOpened): Omit<AuditEntry, 'at'> => ({
  ...base(o),
  kind: 'screen-open',
  target: `screen:${o.key}`,
  via: o.mode,
  fields: { agent: o.agent, place: o.place, path: o.path, profile: o.profile, ...(o.message !== undefined ? { message: String(o.message) } : {}) },
  ok: true,
  code: null,
  result: 'opened',
});

export interface ScreenClosed extends Who {
  mode: ScreenMode;
  reason: ScreenEnd;
  ms: number;
  /** Steps of the app's browser by tool name. */
  steps: Record<string, number>;
  /** Tunnels the proxy allowed and refused, by host. */
  hostsAllowed: Record<string, number>;
  hostsRefused: Record<string, number>;
  /** Whether the recording was kept. */
  recording: 'kept' | 'not' | 'none';
}

export const screenCloseEntry = (o: ScreenClosed): Omit<AuditEntry, 'at'> => ({
  ...base(o),
  kind: 'screen-close',
  target: `screen:${o.key}`,
  via: o.mode,
  fields: {
    agent: o.agent,
    place: o.place,
    reason: o.reason,
    ms: String(Math.max(0, Math.round(o.ms))),
    recording: o.recording,
    steps: countsText(o.steps),
    hostsAllowed: countsText(o.hostsAllowed),
    hostsRefused: countsText(o.hostsRefused),
  },
  ok: true,
  code: null,
  result: 'closed',
});

export interface ScreenHeld extends Who {
  /** Why it was held: a submit, a name, a shortcut, a dialog, a step the app could not classify. */
  why: string;
  /** The step in the app's words, read from the page ("click 'Send', a submit button"). */
  step: string;
  site: string;
  /** What the agent wrote about the step, as its own words. */
  agentWords?: string;
  answer: ScreenAnswer;
  through: AnsweredThrough;
}

export const screenHoldEntry = (o: ScreenHeld): Omit<AuditEntry, 'at'> => ({
  ...base(o),
  kind: 'screen-hold',
  target: `screen:${o.key}`,
  via: o.through,
  fields: { agent: o.agent, why: o.why.slice(0, 40), step: words(o.step), site: siteOf(o.site), ...(o.agentWords ? { agentWords: words(o.agentWords) } : {}), answer: o.answer, through: o.through },
  ok: o.answer === 'yes' || o.answer === 'site',
  code: null,
  result: o.answer === 'yes' || o.answer === 'site' ? 'let through' : 'not done',
});

export interface ScreenConfirmed extends Who {
  /** send, save, delete, publish, pay or other. */
  kind: string;
  /** The step in a sentence, as the agent wrote it. */
  words: string;
  site?: string;
  answer: ScreenAnswer;
  through: AnsweredThrough;
}

export const screenConfirmEntry = (o: ScreenConfirmed): Omit<AuditEntry, 'at'> => ({
  ...base(o),
  kind: 'screen-confirm',
  target: `screen:${o.key}`,
  via: o.through,
  fields: { agent: o.agent, confirmKind: o.kind.slice(0, 20), agentWords: words(o.words), ...(o.site ? { site: siteOf(o.site) } : {}), answer: o.answer, through: o.through },
  ok: o.answer === 'yes' || o.answer === 'site',
  code: null,
  result: o.answer === 'yes' || o.answer === 'site' ? 'approved' : 'not approved',
});

export interface ScreenUsed extends Who {
  /** ISO times: the whole of what is kept about the person's use, never what they did. */
  from: string;
  to: string;
}

export const screenUseEntry = (o: ScreenUsed): Omit<AuditEntry, 'at'> => ({
  ...base(o),
  kind: 'screen-use',
  target: `screen:${o.key}`,
  via: 'window',
  fields: { agent: o.agent, from: o.from.slice(0, 40), to: o.to.slice(0, 40) },
  ok: true,
  code: null,
  result: 'used',
});

/** How a hand-off ended: the four results the agent can be given, or `aborted` when nobody was left to be given one. */
export type HandoffOutcome = 'done' | 'declined' | 'expired' | 'unavailable' | 'aborted';

export interface ScreenHandedOver extends Who {
  mode: ScreenMode;
  /** What the agent asked of the person, as it wrote it. */
  what: string;
  outcome: HandoffOutcome;
  /** ISO times of the interval in which the person held the screen; empty when they never took it. Never what they did or typed. */
  from: string;
  to: string;
}

export const screenHandoffEntry = (o: ScreenHandedOver): Omit<AuditEntry, 'at'> => ({
  ...base(o),
  kind: 'screen-handoff',
  target: `screen:${o.key}`,
  via: o.mode,
  fields: { agent: o.agent, place: o.place, what: words(o.what, 300), outcome: o.outcome, from: o.from.slice(0, 40), to: o.to.slice(0, 40) },
  ok: o.outcome === 'done',
  code: null,
  result: o.outcome,
});

/** The writer of the log; replaced in tests. It never throws: the log must not turn a screen's work into a failure. */
export type AuditSink = (entry: Omit<AuditEntry, 'at'>) => void;

const toLog: AuditSink = (entry) => recordWrite(entry);

export const auditScreen = {
  opened: (o: ScreenOpened, sink: AuditSink = toLog): void => sink(screenOpenEntry(o)),
  closed: (o: ScreenClosed, sink: AuditSink = toLog): void => sink(screenCloseEntry(o)),
  held: (o: ScreenHeld, sink: AuditSink = toLog): void => sink(screenHoldEntry(o)),
  confirmed: (o: ScreenConfirmed, sink: AuditSink = toLog): void => sink(screenConfirmEntry(o)),
  used: (o: ScreenUsed, sink: AuditSink = toLog): void => sink(screenUseEntry(o)),
  handedOver: (o: ScreenHandedOver, sink: AuditSink = toLog): void => sink(screenHandoffEntry(o)),
};
