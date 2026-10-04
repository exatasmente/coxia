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
}

/** Runs one small call against the provider and tells whether it answers. The caller gives the engine and the role resolution. */
export type BudgetProbeFn = (providerId: string) => Promise<BudgetProbeResult>;

/** The state a failure maps to: a refusal by budget is `out`; anything else that is not a clean answer is `unknown`. */
export function probeStateOf(error: unknown): BudgetProbeResult {
  if (error instanceof ProviderBudgetError) return { state: 'out', detail: error.detail };
  return { state: 'unknown', detail: redact(error instanceof Error ? error.message : String(error)).slice(0, 300) };
}
