// What the sweep does to find out whether a provider whose key ran out of budget answers again: one small call per provider, never one per waiting run.
import { ProviderBudgetError } from '../engine/contract';
import { redact } from '../errorlog-core';

/** What a probe learned: the provider answered (`ok`), it refused by budget again (`out`), or it could not be told (`unknown`, the runs keep waiting). */
export type BudgetProbe = 'ok' | 'out' | 'unknown';

export interface BudgetProbeResult {
  state: BudgetProbe;
  /** The provider's own text, already masked, when it refused or failed. */
  detail: string;
}

/** The run state of a provider whose key is out of budget: what the sweep remembers, one entry per provider. */
export interface WaitingProvider {
  /** 'claude-sdk' or 'open'. */
  engine: string;
  /** The reason in words, with the provider's own text. */
  reason: string;
  /** Since when the provider has been out. */
  since: string;
  /** When its limit resets (epoch ms), when the refusal said so: the sweep does not ask before it. */
  until?: number;
}

/** A provider whose limit said when it resets is not asked before that time; one that said nothing is asked at every sweep, as before. */
export function dueForProbe(state: WaitingProvider, nowMs: number): boolean {
  return state.until === undefined || nowMs >= state.until;
}

/** Runs one small call against the provider and tells whether it answers. The caller gives the engine and the role resolution. */
export type BudgetProbeFn = (providerId: string) => Promise<BudgetProbeResult>;

/** The state a failure maps to: a refusal by budget is `out`; anything else that is not a clean answer is `unknown`. */
export function probeStateOf(error: unknown): BudgetProbeResult {
  if (error instanceof ProviderBudgetError) return { state: 'out', detail: error.detail };
  return { state: 'unknown', detail: redact(error instanceof Error ? error.message : String(error)).slice(0, 300) };
}
