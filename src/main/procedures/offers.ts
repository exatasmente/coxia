import type { WorkspaceConfig } from '../../shared/config/types';
import type { ProcedureStep, StepsFrom } from '../../shared/procedures';
import type { OfferView, ProcedureWrite } from '../../shared/proceduresView';
import type { StageUsage } from '../../shared/runs/types';
import type { ScreenSessions } from '../browser/sessions';
import type { ProcedureStore, Writer } from './store';

// The offers to keep a procedure (#187): what the app drafted from the work of a call, when nobody saved one, held in memory until the person says yes or no. Never on disk: an
// offer is a question about work that has just happened, and a restart forgets it with no line. It is not an ask (browser/asks.ts): nothing waits on it, no clock of an agent is
// paused, and a command-only offer has no screen. A yes saves through the same store and validator as the Procedures view, as the person's write and reviewed.

export const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
export const OFFER_MAX_PENDING = 10;

/** The draft an offer is made of: the text and the facts the app held when it drafted it. */
export interface OfferDraft {
  /** The draft's id in its call (`c-N` or `d-N`). */
  id: string;
  kind: 'gui' | 'repo' | 'tool';
  key: string;
  title: string;
  steps: ProcedureStep[];
  pitfalls: string[];
  waits: string[];
  /** Commands left out for safety, by count. */
  leftOut: number;
  /** The person used the screen in this work. */
  handoff: boolean;
  stepsFrom: StepsFrom;
  /** The key was taken from the pages the browser visited. */
  keyedBy?: 'app';
  /** A screen draft: the highest step number it was made up to. A yes or a no moves the screen's mark there. */
  upTo?: number;
  /** A screen draft: the screen's key, for that mark. */
  screen?: string;
}

/** What raising an offer takes: the draft and where it comes from. */
export interface OfferInput extends OfferDraft {
  thread: string;
  stage?: string;
  /** The agent whose work it is. */
  agent: string;
  /** Who wrote the work, as a save would say it (the run reference or the thread id in `ref`). A yes writes it as the person's with this surface, stage, reference, permission and shell. */
  writer: Writer;
  /** What the work cost, and what a yes records as the cost of finding the procedure. */
  usage: StageUsage;
  /** The run's issue number, for the audit; absent outside a run. */
  issue?: number;
}

export interface Offer extends OfferInput {
  /** `o-` and 8 hex digits. */
  offerId: string;
  /** When it was raised (ms). */
  at: number;
}

export type OfferDecline = { ok: true } | { ok: false; code: 'gone' };

export interface OffersDeps {
  store: ProcedureStore;
  config(): WorkspaceConfig;
  /** The screens, when there are any: a yes or a no on a screen draft moves its mark. A getter, as the sessions start after the app does. */
  sessions?(): Pick<ScreenSessions, 'markOf' | 'mark'> | null;
  now?(): number;
  hex?(): string;
  /** The person's home folder, for the validator; the machine's by default. */
  home?: string;
}

export interface ProcedureOffers {
  /** Holds an offer. A newer one for the same thread, agent, kind and key replaces the old; beyond `OFFER_MAX_PENDING` the oldest goes. */
  raise(input: OfferInput): Offer;
  /** The offers still held, oldest first, as the card shows them; one thread's when `thread` is given. */
  list(thread?: string): OfferView[];
  /** Yes: saves it as the person's, reviewed. A refusal leaves the offer where it is and says why. `title` is the one on the card. */
  keep(offerId: unknown, title?: unknown): ProcedureWrite;
  /** No: drops it. */
  decline(offerId: unknown): OfferDecline;
  /** Whether a last turn was already given for this screen at this draft mark; when not, records it. The turn is given once for a mark. */
  turned(screenKey: string, mark: number): boolean;
  /** The screen closed: what it remembers of its turns goes. Offers it raised stay until they are answered or expire. */
  forget(screenKey: string): void;
}

const GONE: Extract<ProcedureWrite, { ok: false }> = { ok: false, code: 'gone', text: 'This offer is no longer there: it was answered, replaced or has expired.' };

export function createProcedureOffers(deps: OffersDeps): ProcedureOffers {
  const now = deps.now ?? Date.now;
  const hex = deps.hex ?? (() => Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0'));
  const held: Offer[] = [];
  const turns = new Set<string>();

  // Expiry is checked where the offers are read, so nothing runs on a timer.
  const purge = (): void => {
    const cutoff = now() - OFFER_TTL_MS;
    for (let i = held.length - 1; i >= 0; i--) if (held[i].at <= cutoff) held.splice(i, 1);
  };
  const find = (offerId: unknown): Offer | undefined => {
    purge();
    return typeof offerId === 'string' ? held.find((o) => o.offerId === offerId) : undefined;
  };
  const drop = (o: Offer): void => void held.splice(held.indexOf(o), 1);

  // The screen's mark never goes back: what was answered in between stays answered.
  const moveMark = (o: Offer): void => {
    if (!o.screen || o.upTo === undefined) return;
    try {
      const sessions = deps.sessions?.();
      if (sessions) sessions.mark(o.screen, Math.max(o.upTo, sessions.markOf(o.screen)));
    } catch {
      // a screen that is gone has no mark to move
    }
  };

  const view = (o: Offer): OfferView => ({
    offerId: o.offerId,
    thread: o.thread,
    agent: o.agent,
    kind: o.kind,
    key: o.key,
    title: o.title,
    steps: o.steps,
    pitfalls: o.pitfalls,
    waits: o.waits,
    leftOut: o.leftOut,
    handoff: o.handoff,
    stepsFrom: o.stepsFrom,
    screen: o.screen !== undefined,
    ...(o.stage ? { stage: o.stage } : {}),
    at: new Date(o.at).toISOString(),
    expiresAt: new Date(o.at + OFFER_TTL_MS).toISOString(),
  });

  return {
    raise(input) {
      purge();
      const same = held.findIndex((o) => o.thread === input.thread && o.agent === input.agent && o.kind === input.kind && o.key.toLowerCase() === input.key.toLowerCase());
      if (same >= 0) held.splice(same, 1);
      const offer: Offer = { ...input, offerId: `o-${hex()}`, at: now() };
      held.push(offer);
      while (held.length > OFFER_MAX_PENDING) held.shift();
      return offer;
    },

    list(thread) {
      purge();
      return held.filter((o) => thread === undefined || o.thread === thread).map(view);
    },

    keep(offerId, title) {
      const o = find(offerId);
      if (!o) return GONE;
      const named = typeof title === 'string' && title.trim() ? title : o.title;
      const input = { kind: o.kind, key: o.key, title: named, steps: o.steps, pitfalls: o.pitfalls, waits: o.waits };
      const r = deps.store.save({
        input,
        writer: { ...o.writer, by: 'person' },
        createdBy: o.agent,
        repos: deps.config().projects.repos.map((x) => x.id),
        stepsFrom: o.stepsFrom,
        ...(o.keyedBy ? { keyedBy: o.keyedBy } : {}),
        home: deps.home,
      });
      if (!r.ok) return { ok: false, code: r.code, text: r.text, ...(r.refusals ? { refusals: r.refusals } : {}), ...(r.id ? { id: r.id } : {}) };
      // The cost of finding the procedure is the work's, not the person's reading of it.
      deps.store.finishUse({ at: new Date(now()).toISOString(), ref: o.writer.ref ?? '', usage: o.usage, read: [], stale: [], replaced: [], created: [r.record.id] });
      moveMark(o);
      drop(o);
      const stored = deps.store.get(r.record.id);
      return { ok: true, record: stored.status === 'ok' ? stored.record : r.record };
    },

    decline(offerId) {
      const o = find(offerId);
      if (!o) return { ok: false, code: 'gone' };
      moveMark(o);
      drop(o);
      return { ok: true };
    },

    turned(screenKey, mark) {
      const key = `${screenKey}|${mark}`;
      if (turns.has(key)) return true;
      turns.add(key);
      return false;
    },

    forget(screenKey) {
      for (const k of [...turns]) if (k.startsWith(`${screenKey}|`)) turns.delete(k);
    },
  };
}
