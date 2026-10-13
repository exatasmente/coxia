import type { ReleaseOp } from './release';
import type { ActionKind, VcsCommand } from './types';

// The kinds of external effect (#199) and what the app keeps for each: a track record, an offer of autonomy once it is earned, and the grant the person confirms.
// Pure: the disk, the audit and the channels are in main/effectGrants.ts.

/** Every kind starts out asking. New kinds (a provisioning step, a message) join this list and nothing else changes. */
export const EFFECT_KINDS = ['push', 'pull-request', 'comment', 'review', 'tracker', 'deploy', 'email', 'dns', 'spend', 'budget-raise', 'permission-raise'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
export const isEffectKind = (v: unknown): v is EffectKind => typeof v === 'string' && (EFFECT_KINDS as readonly string[]).includes(v);

/** Approved, unreverted proposals of a kind in a row before the app offers autonomy for it. */
export const DEFAULT_OFFER_AFTER = 5;

/** The passkey kind a grant of this effect asks for on an admin device; every kind asks for one. */
export type EffectStepUp = 'permission' | 'budget' | 'infrastructure';
export const stepUpOfEffect = (kind: EffectKind): EffectStepUp => (kind === 'spend' || kind === 'budget-raise' ? 'budget' : kind === 'dns' || kind === 'deploy' ? 'infrastructure' : 'permission');

/** The kinds whose threshold is an amount (in the budget's currency, per action); for the others it is a count of autonomous actions in a rolling hour. */
export const AMOUNT_KINDS: readonly EffectKind[] = ['spend'];
export const THRESHOLD_MAX = 1e9;
export const HOUR_MS = 3_600_000;

/** What a code host write is, read from its endpoint: a pull request, a review, a comment or note, or any other edit of the tracker (labels, status, reviewers). */
export function effectOfCommand(c: Pick<VcsCommand, 'method' | 'endpoint'>): EffectKind {
  const e = c.endpoint.toLowerCase();
  if (e === 'graphql') return 'tracker';
  if (c.method === 'POST' && /(^|\/)(pulls|merge_requests|pullrequests)$/.test(e)) return 'pull-request';
  if (/\/merge$/.test(e)) return 'pull-request';
  if (/review|approve/.test(e)) return 'review';
  if (/notes|comments|discussions|replies/.test(e)) return 'comment';
  return 'tracker';
}

/** The kind of effect an action is, or null for one that leaves nothing outside (an agent suggestion, a conflict card, a plugin's own ask). */
export function effectOfAction(a: { kind: ActionKind; command?: VcsCommand | null; commands?: VcsCommand[]; unit?: Record<string, unknown> | null }): EffectKind | null {
  switch (a.kind) {
    case 'run-push':
    case 'conflict-push':
      return 'push';
    case 'release-git': {
      const op = String(a.unit?.op ?? '') as ReleaseOp;
      return op === 'push-branch' || op === 'push-tag' ? 'push' : op === 'open' || op === 'merge-pr' ? 'pull-request' : 'deploy';
    }
    case 'gitlab':
    case 'vcs': {
      const all = a.commands?.length ? a.commands : a.command ? [a.command] : [];
      if (!all.length) return null;
      const kinds = all.map(effectOfCommand);
      // A group is as far-reaching as its most far-reaching write.
      for (const k of ['pull-request', 'review', 'tracker', 'comment'] as const) if (kinds.includes(k)) return k;
      return null;
    }
    default:
      return null;
  }
}

export interface KindRecord {
  proposed: number;
  approved: number;
  refused: number;
  reverted: number;
  /** Actions of this kind that went out under a grant. Not counted toward the offer. */
  autonomous: number;
  /** Approved proposals in a row with none reverted since: what the offer waits on. A revert or a revocation sets it back to zero. */
  streak: number;
  lastRevokedAt: string | null;
}
export const emptyRecord = (): KindRecord => ({ proposed: 0, approved: 0, refused: 0, reverted: 0, autonomous: 0, streak: 0, lastRevokedAt: null });

/** One decision, kept so a revert can name the action and the count of autonomous actions in an hour can be taken. */
export interface EffectEvent {
  id: string;
  kind: EffectKind;
  outcome: 'approved' | 'refused' | 'autonomous';
  at: string;
  /** For `autonomous`: the grant that allowed it. */
  grant?: string;
  reverted?: boolean;
}
export const EVENTS_MAX = 300;

export interface EffectGrant {
  id: string;
  kind: EffectKind;
  /** `spend`: the most one spend may be; the others: the most autonomous actions in an hour. Absent: none. */
  threshold?: number;
  /** The grant belongs to an account of the registry (#200); removing the account revokes it. */
  accountId?: string;
  grantedAt: string | null;
  grantedBy: 'person';
  via: 'window' | 'paired' | 'admin' | 'config';
  /** Set on a grant that stands for a switch of the configuration from before grants existed (`runner.autonomy.push`). */
  legacy?: boolean;
}

export interface EffectStatus {
  kind: EffectKind;
  record: KindRecord;
  /** N: approved, unreverted proposals in a row before the app offers. */
  offerAfter: number;
  offered: boolean;
  grant: EffectGrant | null;
  /** The passkey kind granting it asks for. */
  stepUp: EffectStepUp;
  /** Whether a grant of this kind can run an action without asking at all (a release step never does). */
  amountThreshold: boolean;
}

/** Whether the app offers autonomy for a kind: the streak reached N and no grant stands. */
export const offerOf = (rec: KindRecord, offerAfter: number, granted: boolean): boolean => !granted && rec.streak >= offerAfter;
