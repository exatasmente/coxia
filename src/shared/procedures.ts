import type { AgentPermission, AgentShell } from './config/types';
import type { StageUsage } from './runs/types';

// The shape of a learned procedure: what an agent worked out about doing a recurring thing, kept per workspace. This file is the contract and the constants;
// the validator is in main/procedures/record.ts and the files in main/procedures/store.ts. Every cap is a constant here, not a setting.

/** The version of the record format. A record a newer app wrote is not read and never overwritten. */
export const PROCEDURE_VERSION = 1;

export const PROCEDURE_KINDS = ['gui', 'repo', 'tool', 'cycle', 'request'] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

/** Set only by the app: `ok` and `failing` follow what the calls that read the record reported. */
export const PROCEDURE_STATES = ['unverified', 'ok', 'failing'] as const;
export type ProcedureState = (typeof PROCEDURE_STATES)[number];

/** Where the steps of a record come from: the app's recording, the agent's edit of it, or the agent alone (every kind but `gui`). */
export const STEPS_FROM = ['recording', 'edited', 'agent'] as const;
export type StepsFrom = (typeof STEPS_FROM)[number];

/** The places a record is written from. `person` is an edit in the Procedures view. */
export const PROCEDURE_SURFACES = ['stage', 'direct', 'channel', 'forum', 'run-thread', 'called', 'person'] as const;
export type ProcedureSurface = (typeof PROCEDURE_SURFACES)[number];

export const LIMITS = {
  key: 80,
  title: 80,
  steps: 20,
  stepText: 240,
  stepRun: 200,
  pitfalls: 8,
  pitfall: 200,
  waits: 6,
  wait: 160,
  /** What the record's content (key, title, steps, pitfalls, waits) serialises to, at most. `stats`, `origin` and `previous` are not counted. */
  content: 4000,
  perKey: 10,
  perWorkspace: 300,
  /** A quoted piece of a `gui` step is a label; page content is longer. */
  quote: 40,
  /** The uses kept for the comparison with the cost of finding the procedure. */
  recent: 20,
} as const;

/** A record whose `lastVerified` is older than this is listed as old; it is never dropped by age. */
export const OLD_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/** A record that failed this many times since it was last saved is left out of the prompt list (the person still sees it). */
export const FAILING_OUT_OF_LIST = 2;

export interface ProcedureStep {
  text: string;
  /** A command, or a control as the agent saw it by role and visible label. */
  run?: string;
  /** The agent reworded this step of the app's draft (`gui` only). */
  edited?: true;
}

/** The text a person or an agent writes. This is what the validator checks and what the 4,000 characters measure. */
export interface ProcedureContent {
  kind: ProcedureKind;
  key: string;
  title: string;
  steps: ProcedureStep[];
  pitfalls: string[];
  waits: string[];
}

export interface ProcedureOrigin {
  /** Who wrote this revision: an agent id or `person`. */
  by: string;
  /** Who created the record. */
  createdBy: string;
  surface: ProcedureSurface;
  /** The stage kind, when the surface is a stage. */
  stage?: string;
  /** The run reference or the thread id. */
  ref?: string;
  /** What the writing agent could do at that moment, so a reader knows what it is reading. */
  permission?: AgentPermission;
  shell?: AgentShell;
  at: string;
}

/** What one call that read the procedure used. */
export interface ProcedureUseEntry {
  at: string;
  ref: string;
  failed: boolean;
  usage: StageUsage;
}

export interface ProcedureStats {
  uses: number;
  failures: number;
  /** Failures reported since the record was last saved; at the limit the record leaves the prompt list. */
  failuresSinceSave: number;
  lastUsed: string | null;
  /** What the call that created the record used: the cost of finding the procedure. Null until that call finishes. */
  baseline: StageUsage | null;
  /** The last uses, oldest first, at most `LIMITS.recent`. */
  recent: ProcedureUseEntry[];
}

/** The text fields of the revision before this one, kept once so the person can restore it. */
export type ProcedurePrevious = Pick<ProcedureContent, 'title' | 'steps' | 'pitfalls' | 'waits'>;

export interface ProcedureRecord extends ProcedureContent {
  v: typeof PROCEDURE_VERSION;
  /** `p-` and 8 hex digits. Never reused after a delete. */
  id: string;
  /** Starts at 1 and goes up on every write; a write names the one it read. */
  revision: number;
  state: ProcedureState;
  lastVerified: string | null;
  lastFailed: { at: string; step: number } | null;
  stats: ProcedureStats;
  origin: ProcedureOrigin;
  /** `app` when the key was taken from the pages the browser path visited. */
  keyedBy?: 'app';
  stepsFrom: StepsFrom;
  /** The person looked at this revision, or wrote it. */
  reviewed: boolean;
  previous: ProcedurePrevious | null;
}

export const PROCEDURE_ID = /^p-[0-9a-f]{8}$/;
export const isProcedureId = (id: unknown): id is string => typeof id === 'string' && PROCEDURE_ID.test(id);

/** The part of a record the 4,000 characters measure. */
export const contentOf = (r: ProcedureContent): ProcedureContent => ({ kind: r.kind, key: r.key, title: r.title, steps: r.steps, pitfalls: r.pitfalls, waits: r.waits });

export const contentSize = (r: Pick<ProcedureContent, 'key' | 'title' | 'steps' | 'pitfalls' | 'waits'>): number => JSON.stringify({ key: r.key, title: r.title, steps: r.steps, pitfalls: r.pitfalls, waits: r.waits }).length;

/** A key is looked up without regard to case (a host is written either way). */
export const sameKey = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The title compared for a near-duplicate: case and runs of spaces do not tell two titles apart. */
export const normalTitle = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').trim();

/** Not verified for 90 days (or never, and written that long ago). Listed as old, never dropped. */
export function isOld(r: Pick<ProcedureRecord, 'lastVerified' | 'origin'>, now: number): boolean {
  const at = Date.parse(r.lastVerified ?? r.origin.at);
  return Number.isFinite(at) && now - at > OLD_AFTER_MS;
}

/** What a call that read a procedure leaves on its record of the call: the revision it read and what became of it. */
export interface ProcedureUse {
  id: string;
  revision: number;
  title: string;
  outcome: 'ok' | 'failed' | 'replaced';
}

/** The switch of the learned procedures: absent (a config stored before it) reads as off. Off offers no tool and no prompt section, and the view still works. */
export const proceduresOn = (config: { runner?: { procedures?: boolean } | null } | null | undefined): boolean => config?.runner?.procedures === true;

/** A saving is shown only from this many uses on: with fewer, the view says there are not enough to compare. */
export const COMPARE_MIN_USES = 3;

/** What the uses of a procedure cost on average (whole tokens, calls rounded). The cost is the average of the uses, or null when any use has none reported. */
export interface UsageAverage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  calls: number;
  costUsd: number | null;
  costEstimated: boolean;
}

export interface Comparison {
  /** Every use the procedure had. */
  uses: number;
  /** The uses kept for the comparison (the last 20). */
  counted: number;
  /** The share of the counted uses with no failure reported, 0 to 1; null when none are counted. */
  noFailureShare: number | null;
  /** What finding the procedure cost: the usage of the call that created it. */
  baseline: StageUsage | null;
  average: UsageAverage | null;
  /** There is a baseline and at least `COMPARE_MIN_USES` counted uses, so a comparison may be shown. Below it the view says "not enough uses to compare". */
  enough: boolean;
  /**
   * (baseline - average) x uses, in tokens, only when `enough` and the average is below the baseline. The cost is there only when the baseline and every counted use
   * reported one and it is lower too; it is an estimate when any of them says so.
   */
  saved: { tokens: number; costUsd: number | null; costEstimated: boolean } | null;
  /** Always true: the call that created the record and the ones that used it did other work too, so this is a comparison and not a controlled test. */
  approximate: true;
}

const tokensOf = (u: Pick<StageUsage, 'promptTokens' | 'completionTokens'>): number => u.promptTokens + u.completionTokens;

/** The comparison of what a procedure cost to find with what it cost to use. Nothing is invented: a missing baseline or too few uses give no saving. */
export function compare(stats: ProcedureStats): Comparison {
  const recent = stats.recent;
  const counted = recent.length;
  const baseline = stats.baseline;
  const noFailureShare = counted ? recent.filter((e) => !e.failed).length / counted : null;
  const mean = (pick: (u: StageUsage) => number): number => recent.reduce((sum, e) => sum + pick(e.usage), 0) / counted;
  const costed = counted > 0 && recent.every((e) => e.usage.costUsd !== null);
  const average: UsageAverage | null = counted
    ? {
        promptTokens: Math.round(mean((u) => u.promptTokens)),
        completionTokens: Math.round(mean((u) => u.completionTokens)),
        cachedTokens: Math.round(mean((u) => u.cachedTokens)),
        calls: Math.round(mean((u) => u.calls)),
        costUsd: costed ? mean((u) => u.costUsd ?? 0) : null,
        costEstimated: recent.some((e) => e.usage.costEstimated === true),
      }
    : null;
  const enough = baseline !== null && counted >= COMPARE_MIN_USES;
  let saved: Comparison['saved'] = null;
  if (enough && baseline && average) {
    const perUse = tokensOf(baseline) - mean((u) => tokensOf(u));
    if (perUse > 0) {
      const costPerUse = baseline.costUsd !== null && average.costUsd !== null ? baseline.costUsd - average.costUsd : null;
      saved = {
        tokens: Math.round(perUse * stats.uses),
        costUsd: costPerUse !== null && costPerUse > 0 ? costPerUse * stats.uses : null,
        costEstimated: baseline.costEstimated === true || average.costEstimated,
      };
    }
  }
  return { uses: stats.uses, counted, noFailureShare, baseline, average, enough, saved, approximate: true };
}

/** The workspace summary: the sums of the savings shown, with the same label. Cost is summed over the procedures that have one. */
export function compareAll(all: readonly ProcedureStats[]): { procedures: number; uses: number; tokens: number; costUsd: number | null; costEstimated: boolean; approximate: true } {
  const shown = all.map(compare).filter((c) => c.saved !== null);
  const costs = shown.filter((c) => c.saved?.costUsd != null);
  return {
    procedures: shown.length,
    uses: shown.reduce((n, c) => n + c.uses, 0),
    tokens: shown.reduce((n, c) => n + (c.saved?.tokens ?? 0), 0),
    costUsd: costs.length ? costs.reduce((n, c) => n + (c.saved?.costUsd ?? 0), 0) : null,
    costEstimated: costs.some((c) => c.saved?.costEstimated === true),
    approximate: true,
  };
}
