import type { StageUsage } from './types';

// What a stage cost in model use, as the engines report it: one report per model call. The tokens are the provider's own count (an estimate when the server
// sent none); the cost is only what a provider or the SDK said it charged, never a guess from a price list, so it is absent when nobody said.

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
}

export const emptyUsage = (): StageUsage => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, calls: 0, costUsd: null });

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** The total with one more report added. A report with no tokens (the SDK's final cost) adds its cost but is not a call. */
export function addReport(total: StageUsage, r: UsageReport): StageUsage {
  const tokens = count(r.promptTokens) + count(r.completionTokens);
  const cost = typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : null;
  return {
    promptTokens: total.promptTokens + count(r.promptTokens),
    completionTokens: total.completionTokens + count(r.completionTokens),
    cachedTokens: total.cachedTokens + count(r.cachedTokens),
    calls: total.calls + (tokens > 0 ? 1 : 0),
    costUsd: cost === null ? total.costUsd : (total.costUsd ?? 0) + cost,
  };
}

/** Two totals as one (the attempts of a stage). */
export function mergeUsage(a: StageUsage | undefined, b: StageUsage): StageUsage {
  if (!a) return { ...b };
  return { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, cachedTokens: a.cachedTokens + b.cachedTokens, calls: a.calls + b.calls, costUsd: a.costUsd === null && b.costUsd === null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0) };
}

export const hasUsage = (u: StageUsage | undefined): u is StageUsage => !!u && (u.calls > 0 || u.promptTokens + u.completionTokens > 0 || u.costUsd !== null);
