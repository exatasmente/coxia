import { ACTIVITIES, LLM_ROLES, MAX_POOL_ENTRIES, type Activity, type LlmRole, type ModelPool, type ModelRef, type ScoreOverrides } from './config/types';
import { type CatalogModel, type StageProfile, STAGE_PROFILE, estimateStageCost } from './modelCatalog';
import { type ScoreSource, floorFor, scoreFor } from './modelScores';

// Suggests the models of a pool from what a provider's listing says: only models that can do the job, ordered by the price of a typical stage among the ones
// that reach the quality floor of the activity. Pure; nothing is saved here, the person reviews the result and saves it with the rest of the configuration.

/** A model without a known context window, or with less than this, is not suggested: a stage needs room for its history. */
export const MIN_SUGGESTED_CONTEXT = 32_000;

/** How many models a suggested list holds, the role's own model included. */
export const SUGGESTED_POOL_SIZE = 4;

export interface RankOptions {
  /** The provider id the entries belong to. */
  provider: string;
  scoreOverrides?: ScoreOverrides;
  minContext?: number;
  /** Leave out the models under the floor instead of listing them after the ones that pass. */
  dropBelowFloor?: boolean;
  profile?: StageProfile;
}

export interface RankedModel {
  ref: ModelRef;
  /** US dollars of one typical stage; null when the listing has no price. */
  cost: number | null;
  score: number | null;
  /** Where the score comes from; null without a score. */
  source: ScoreSource | 'override' | null;
  belowFloor: boolean;
  /** Facts the listing did not say and that the suggestion needs: marked "unverified" on screen. */
  unverified: ('tools' | 'structured')[];
}

/** Whether a model may be suggested for an activity. A fact the listing did not say (null) does not exclude; only a "no" does. */
export function isEligible(m: CatalogModel, activity: Activity, minContext = MIN_SUGGESTED_CONTEXT): boolean {
  if (m.tools === false || m.structured === false) return false;
  if (m.contextWindow === null || m.contextWindow < minContext) return false;
  if (activity === 'screen' && m.vision !== true) return false;
  return true;
}

/** The pool entry for a catalog model, with the facts the listing gave. */
export function refOf(m: CatalogModel, provider: string): ModelRef {
  return {
    provider,
    model: m.id,
    ...(m.vision !== null ? { images: m.vision } : {}),
    ...(m.contextWindow !== null ? { contextWindow: m.contextWindow } : {}),
    ...(m.reasoning === true ? { echoReasoning: true } : {}),
  };
}

const byCost = (a: RankedModel, b: RankedModel): number => {
  if (a.cost !== b.cost) return a.cost === null ? 1 : b.cost === null ? -1 : a.cost - b.cost;
  return a.ref.model < b.ref.model ? -1 : a.ref.model > b.ref.model ? 1 : 0;
};

/**
 * The eligible models for one activity, best first. With a floor (shell, edit, screen): the models that reach it by price, then the ones under it by price, then
 * the ones without a score by price. Without one (explore, write): by price. A tie goes to the smaller id, so the order never depends on the listing's.
 */
export function rankForActivity(models: readonly CatalogModel[], activity: Activity, opts: RankOptions): RankedModel[] {
  const floor = floorFor(activity, opts.scoreOverrides);
  const profile = opts.profile ?? STAGE_PROFILE;
  const rows = models
    .filter((m) => isEligible(m, activity, opts.minContext))
    .map((m): RankedModel => {
      const found = floor === null ? null : scoreFor(m.id, activity, opts.scoreOverrides);
      return {
        ref: refOf(m, opts.provider),
        cost: estimateStageCost(m, profile),
        score: found?.score ?? null,
        source: found?.source ?? null,
        belowFloor: floor !== null && found !== null && found.score < floor,
        unverified: [...(m.tools === null ? (['tools'] as const) : []), ...(m.structured === null ? (['structured'] as const) : [])],
      };
    })
    .filter((r) => !(opts.dropBelowFloor && r.belowFloor));
  const bucket = (r: RankedModel): number => (floor === null || (r.score !== null && !r.belowFloor) ? 0 : r.belowFloor ? 1 : 2);
  return rows.sort((a, b) => bucket(a) - bucket(b) || byCost(a, b));
}

export interface SuggestOptions extends RankOptions {
  /** The model each role has now, for the roles that are on this provider: it stays the first entry. */
  roles?: Partial<Record<LlmRole, ModelRef>>;
  size?: number;
}

export interface PoolSuggestion {
  /** The list of the start of a stage (the role's default list), best first, with what the screen shows next to each entry. */
  write: RankedModel[];
  /** A list for an activity, only where it differs from `write`. */
  activities: Partial<Record<Activity, RankedModel[]>>;
  /** What each role on the provider gets: its own model first, the rest of `write` as reserves, and the lists that differ. */
  roles: Partial<Record<LlmRole, ModelPool>>;
}

const sameModels = (a: RankedModel[], b: RankedModel[]): boolean => a.length === b.length && a.every((r, i) => r.ref.model === b[i].ref.model);

/** The pools to suggest for a provider's listing. Empty lists when nothing in the listing qualifies. */
export function suggestPools(catalog: readonly CatalogModel[], opts: SuggestOptions): PoolSuggestion {
  const size = Math.max(1, Math.min(opts.size ?? SUGGESTED_POOL_SIZE, MAX_POOL_ENTRIES));
  const write = rankForActivity(catalog, 'write', opts);
  const activities: PoolSuggestion['activities'] = {};
  for (const a of ACTIVITIES) {
    if (a === 'write') continue;
    const list = rankForActivity(catalog, a, opts);
    // A list that is the same as the default one in what it keeps is not a list of its own.
    if (list.length && !sameModels(list.slice(0, size), write.slice(0, size))) activities[a] = list.slice(0, size);
  }
  const roles: PoolSuggestion['roles'] = {};
  for (const role of LLM_ROLES) {
    const own = opts.roles?.[role];
    if (!own) continue;
    const fallbacks = write.filter((r) => r.ref.model !== own.model).slice(0, size - 1).map((r) => ({ ...r.ref }));
    const acts = Object.fromEntries(Object.entries(activities).map(([a, l]) => [a, l!.map((r) => ({ ...r.ref }))]));
    roles[role] = { ...(fallbacks.length ? { fallbacks } : {}), ...(Object.keys(acts).length ? { activities: acts } : {}) };
  }
  return { write: write.slice(0, size), activities, roles };
}
