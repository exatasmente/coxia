import type { ScoredActivity, ScoreOverrides } from './config/types';

// Quality scores per activity, shipped with the app as data. They set the floor under which a model is not the one to suggest first for an activity, and
// break ties; they are not a guarantee, and the person overrides them (`llm.scoreOverrides`). Never fetched at run time and never read from a provider's
// address: a number here is only as good as its source, which is named next to it.
//
// When a score changes or a model is added, raise SCORE_TABLE_VERSION: a saved pool does not depend on it (a pool is a list of models the person reviewed),
// but a note in the changelog can say which table a suggestion came from.

export const SCORE_TABLE_VERSION = 1;

/** The score below which a model is listed after the ones that pass, per activity. `explore` and `write` have none: they are ordered by price. */
export const FLOORS: Record<ScoredActivity, number> = { shell: 85, edit: 65, screen: 70 };

/** Who measured: the vendor of the model itself, or someone else comparing models. Shown next to the score. */
export type ScoreOrigin = 'self-reported' | 'third-party';

export interface ScoreSource {
  /** The benchmark and its version, as the source names it. */
  benchmark: string;
  origin: ScoreOrigin;
}

export interface ScoreEntry {
  /** Ids the model is known by; matched after `normalizeModelId`, so an aggregator's `org/name:variant` finds it too. */
  names: string[];
  scores: Partial<Record<ScoredActivity, number>>;
  sources: Partial<Record<ScoredActivity, ScoreSource>>;
}

const TERMINAL_BENCH: ScoreSource['benchmark'] = 'Terminal-Bench 2.1';
const DEEPSWE: ScoreSource['benchmark'] = 'DeepSWE v1.1';
const OSWORLD: ScoreSource['benchmark'] = 'OSWorld-Verified';
const vendor = (benchmark: string): ScoreSource => ({ benchmark, origin: 'self-reported' });
const comparison = (benchmark: string): ScoreSource => ({ benchmark, origin: 'third-party' });

export const SCORE_ENTRIES: readonly ScoreEntry[] = [
  {
    names: ['deepseek-ai/DeepSeek-V4.1-Flash'],
    scores: { shell: 90.6, edit: 74.2 },
    sources: { shell: vendor(TERMINAL_BENCH), edit: vendor(DEEPSWE) },
  },
  {
    names: ['XiaomiMiMo/MiMo-V2.6-Flash'],
    scores: { shell: 87.6, edit: 67.9, screen: 80.8 },
    sources: { shell: vendor(TERMINAL_BENCH), edit: vendor(DEEPSWE), screen: vendor(OSWORLD) },
  },
  {
    // A third-party comparison, not the vendor's own numbers.
    names: ['zai-org/GLM-5.3-Flash'],
    scores: { shell: 84.3, edit: 63.4 },
    sources: { shell: comparison(TERMINAL_BENCH), edit: comparison(DEEPSWE) },
  },
];

/** The id without the organization before the last slash and the variant after a colon (`:free`), in lowercase. */
export function normalizeModelId(id: string): string {
  const base = id.trim().toLowerCase();
  const name = base.slice(base.lastIndexOf('/') + 1);
  const colon = name.indexOf(':');
  return colon > 0 ? name.slice(0, colon) : name;
}

const byName = new Map<string, ScoreEntry>(SCORE_ENTRIES.flatMap((e) => e.names.map((n) => [normalizeModelId(n), e] as const)));

/** A score from the table or from the person; `override` has no benchmark to name. */
export interface FoundScore {
  score: number;
  source: ScoreSource | 'override';
}

/** The floor of an activity: the person's, else the table's. Null for an activity without one. */
export function floorFor(activity: string, overrides?: ScoreOverrides): number | null {
  if (activity !== 'shell' && activity !== 'edit' && activity !== 'screen') return null;
  return overrides?.floors?.[activity] ?? FLOORS[activity];
}

/** The score of a model for an activity: the person's override first, then the table. Null when neither has one. */
export function scoreFor(modelId: string, activity: string, overrides?: ScoreOverrides): FoundScore | null {
  if (activity !== 'shell' && activity !== 'edit' && activity !== 'screen') return null;
  const key = normalizeModelId(modelId);
  const mine = Object.entries(overrides?.models ?? {}).find(([k]) => normalizeModelId(k) === key)?.[1]?.[activity];
  if (typeof mine === 'number') return { score: mine, source: 'override' };
  const entry = byName.get(key);
  const score = entry?.scores[activity];
  const source = entry?.sources[activity];
  return entry && typeof score === 'number' && source ? { score, source } : null;
}
