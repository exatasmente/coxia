import type { StageUsage } from './types';

// What a stage cost in model use, as the engines report it: one report per model call. The tokens are the provider's own count (an estimate when the server
// sent none); the cost is what a provider said it charged, or an estimate when the call did not go to Anthropic's own API, never a plain price for a call
// that went elsewhere. The two flags are told apart: `estimated` says the tokens were estimates, `costEstimated` says the cost is one.

/** One model call's use, as an engine reports it. */
export interface UsageReport {
  promptTokens: number;
  completionTokens: number;
  /** Of the prompt tokens, the ones served from the provider's cache. */
  cachedTokens: number;
  /** What the provider or the SDK said the call cost, in US dollars; absent when it said nothing. */
  costUsd?: number;
  /** The server sent no usage and the numbers are estimates. */
  estimated?: boolean;
  /** The cost is an estimate: the provider did not report what the call was charged (outside Anthropic's own API the SDK's figure is a list price). */
  costEstimated?: boolean;
}

export const emptyUsage = (): StageUsage => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, calls: 0, costUsd: null });

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

// The provenance of the whole from two sides that may each carry a cost: a side with no cost is neutral, a side with one and no flag is charged (the flag only
// ever marks an estimate), and the total is an estimate only when no side holding a cost was charged.
const provenance = (a: boolean | undefined, hasA: boolean, b: boolean | undefined, hasB: boolean): boolean | undefined => {
  if (!hasA && !hasB) return undefined;
  const charged = (hasA && a !== true) || (hasB && b !== true);
  return charged ? false : true;
};

/** The total with one more report added. A report with no tokens (the SDK's final cost) adds its cost but is not a call. */
export function addReport(total: StageUsage, r: UsageReport): StageUsage {
  const tokens = count(r.promptTokens) + count(r.completionTokens);
  const cost = typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : null;
  const costUsd = cost === null ? total.costUsd : (total.costUsd ?? 0) + cost;
  return {
    promptTokens: total.promptTokens + count(r.promptTokens),
    completionTokens: total.completionTokens + count(r.completionTokens),
    cachedTokens: total.cachedTokens + count(r.cachedTokens),
    calls: total.calls + (tokens > 0 ? 1 : 0),
    costUsd,
    // A report with no cost does not change what the stage's total means.
    costEstimated: cost === null ? total.costEstimated : provenance(total.costEstimated, total.costUsd !== null, r.costEstimated, true),
  };
}

/** Two totals as one (the attempts of a stage). Any charged value makes the total charged; a total is estimated only when it holds cost and no charged value did. */
export function mergeUsage(a: StageUsage | undefined, b: StageUsage): StageUsage {
  if (!a) return { ...b };
  const costUsd = a.costUsd === null && b.costUsd === null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, cachedTokens: a.cachedTokens + b.cachedTokens, calls: a.calls + b.calls, costUsd, costEstimated: provenance(a.costEstimated, a.costUsd !== null, b.costEstimated, b.costUsd !== null) };
}

export const hasUsage = (u: StageUsage | undefined): u is StageUsage => !!u && (u.calls > 0 || u.promptTokens + u.completionTokens > 0 || u.costUsd !== null);
