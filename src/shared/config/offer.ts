import type { Activity, EffortSetting, LlmConfig, ModelOffer, ProviderFeatures, ReasoningEffort } from './types';
import { DEFAULT_EFFORT } from './types';

// What the server may be sent, and what the catalog said of a model. Pure: the engine asks here before it puts a parameter in a request.

/** Flex: the server has tiers, the model is marked for it and the person has not turned it off (the call being one nobody waits for is the engine's to check). */
export function canFlex(features: ProviderFeatures | undefined, offer: ModelOffer | undefined, runnerFlex: boolean | undefined): boolean {
  return features?.serviceTier === true && offer?.flex === true && runnerFlex !== false;
}

/** Effort: the server takes it and the model is marked as one that does. */
export function canEffort(features: ProviderFeatures | undefined, offer: ModelOffer | undefined): boolean {
  return features?.reasoningEffort === true && offer?.effort === true;
}

/** Fail-fast: the server refuses at once when asked to. Whether the model is the last of its list is the pool's to check. */
export function canFailFast(features: ProviderFeatures | undefined): boolean {
  return features?.failFast === true;
}

/** The effort to send for an activity, or undefined for "the model decides": the workspace's choice, else the proposal. */
export function effortFor(llm: Pick<LlmConfig, 'effort'>, activity: Activity): ReasoningEffort | undefined {
  const set: EffortSetting | undefined = llm.effort?.[activity] ?? DEFAULT_EFFORT[activity];
  return set === undefined || set === 'default' ? undefined : set;
}

export interface Deprecation {
  /** When the provider retires the model (seconds since 1970). */
  at: number;
  /** Already past: the model is retired or about to be. */
  past: boolean;
  replacedBy?: string;
}

/** Whether a model is marked obsolete, and by what it is replaced. Only a warning: nothing is ever switched for it. */
export function deprecationOf(offer: ModelOffer | undefined, nowMs: number = Date.now()): Deprecation | null {
  if (offer?.deprecated === undefined) return null;
  return { at: offer.deprecated, past: offer.deprecated * 1000 <= nowMs, ...(offer.replacedBy ? { replacedBy: offer.replacedBy } : {}) };
}
