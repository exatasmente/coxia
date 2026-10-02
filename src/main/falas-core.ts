import { createHash } from 'node:crypto';
import type { AgentTurn, Card } from '../shared/types';

// Bump when the content or format of a turn changes, so turns saved under the old prompt are not served again.
const VERSION = 1;
export const MAX_AGE_DAYS = 3;

export interface Artifact {
  path: string;
  mtime: number;
}

// Everything the agent is told about an activity; if none of it moved, a new speech would say the same thing.
export function fingerprint(card: Card, artifacts: Artifact[]): string {
  const sorted = (xs: string[]) => [...xs].sort();
  const body = {
    v: VERSION,
    stage: card.stage,
    blockers: sorted(card.blockers),
    pending: sorted(card.pending),
    mrs: sorted(card.mrs),
    changes: sorted(card.changes),
    note: card.note,
    phase: card.spec?.phase ?? null,
    artifacts: [...artifacts].sort((a, b) => a.path.localeCompare(b.path)).map((a) => [a.path, Math.floor(a.mtime)]),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 24);
}

export interface Saved {
  fp: string;
  turn: AgentTurn;
  at: string;
}

function dayOf(ms: number): string {
  return new Date(ms).toLocaleDateString('sv-SE');
}

// Calendar days, so Friday's speech still serves on Monday.
export function daysBetween(from: number, to: number): number {
  return Math.round((Date.parse(`${dayOf(to)}T12:00:00Z`) - Date.parse(`${dayOf(from)}T12:00:00Z`)) / 86_400_000);
}

export function isReusable(saved: Saved | undefined, fp: string, now: number): saved is Saved {
  if (!saved || saved.fp !== fp) return false;
  const age = daysBetween(Date.parse(saved.at), now);
  return age >= 0 && age <= MAX_AGE_DAYS;
}

export function sinceLabel(at: string, now: number): string {
  const d = daysBetween(Date.parse(at), now);
  return d <= 0 ? 'hoje cedo' : d === 1 ? 'ontem' : d === 2 ? 'anteontem' : `${d} dias`;
}

const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

// The speech is rebuilt around the saved next step, blocker and question: the saved "what changed" is not news anymore.
export function reusedTurn(saved: Saved, now: number, sessionAlive: boolean): AgentTurn {
  const since = sinceLabel(saved.at, now);
  const t = saved.turn;
  const speech = [
    `Sem mudança desde ${since}.`,
    sentence(t.next),
    t.blocker ? sentence(`Bloqueio: ${t.blocker}`) : '',
    t.question ? sentence(t.question) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    ...t,
    sessionId: sessionAlive ? t.sessionId : null,
    speech,
    did: `Sem mudança desde ${since}.`,
    reused: { at: saved.at },
  };
}
