import { poolFieldsOf } from '../../../shared/config/pool';
import { presetFeaturesOf } from '../../../shared/wizard';
import { ACTIVITIES, DEFAULT_EFFORT, LLM_ROLES, MAX_POOL_ENTRIES, type Activity, type EffortSetting, type LlmRole, type ModelOffer, type ModelPool, type ModelRef, type ProviderFeatures, type ScoredActivity, type ScoreOverrides, type WorkspaceConfig } from '../../../shared/config/types';
import { type CatalogModel, type Retirement, estimateStageCost, offerOf } from '../../../shared/modelCatalog';
import { type PoolSuggestion } from '../../../shared/modelPools';
import { type FoundScore, normalizeModelId, scoreFor } from '../../../shared/modelScores';

// The edits of a model pool behind the pool editor, the suggestion panel and the agent editor, as pure functions: nothing here saves. The caller puts the
// result in the draft it holds, and the draft is saved the way the rest of the configuration is.

/** The lists of a pool: the role's reserves (after its own model), or the complete list of one activity. */
export type PoolListKey = 'fallbacks' | Activity;

export const POOL_LIST_KEYS: readonly PoolListKey[] = ['fallbacks', ...ACTIVITIES];

export const listOf = (pool: ModelPool, key: PoolListKey): ModelRef[] => (key === 'fallbacks' ? pool.fallbacks : pool.activities?.[key]) ?? [];

/** The pool with one list replaced; an empty list is no list, and the field leaves the pool (absent = nothing changes). */
export function withList(pool: ModelPool, key: PoolListKey, list: ModelRef[]): ModelPool {
  return poolFieldsOf(key === 'fallbacks' ? { ...pool, fallbacks: list } : { ...pool, activities: { ...pool.activities, [key]: list } });
}

/** An entry one place up or down; out of range changes nothing. */
export function moveEntry(list: ModelRef[], index: number, delta: -1 | 1): ModelRef[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export const removeEntry = (list: ModelRef[], index: number): ModelRef[] => list.filter((_, i) => i !== index);

export type AddProblem = 'empty' | 'provider' | 'duplicate' | 'max';

const same = (a: Pick<ModelRef, 'provider' | 'model'>, b: Pick<ModelRef, 'provider' | 'model'>): boolean => a.provider === b.provider && a.model === b.model;

/** An entry added at the end, or what is wrong with it. `lead` is the role's own model, which the reserves of the role must not repeat. */
export function addEntry(list: ModelRef[], entry: Pick<ModelRef, 'provider' | 'model'>, providers: readonly string[], lead?: Pick<ModelRef, 'provider' | 'model'> | null): { list: ModelRef[] } | { problem: AddProblem } {
  const model = entry.model.trim();
  if (!model || /\s/.test(model)) return { problem: 'empty' };
  if (!providers.includes(entry.provider)) return { problem: 'provider' };
  const ref = { provider: entry.provider, model };
  if (list.some((x) => same(x, ref)) || (lead && same(lead, ref))) return { problem: 'duplicate' };
  if (list.length >= MAX_POOL_ENTRIES) return { problem: 'max' };
  return { list: [...list, ref] };
}

/** The reserves without a copy of the role's own model (the model changed to one that was a reserve). */
export function withoutLead(pool: ModelPool, lead: Pick<ModelRef, 'provider' | 'model'>): ModelPool {
  return poolFieldsOf({ ...pool, fallbacks: (pool.fallbacks ?? []).filter((x) => !same(x, lead)) });
}

/**
 * "Use the suggestion" for the roles that are on a provider: the role starts with the suggestion's first model, and its reserves and lists become the suggested
 * ones (the model of today among them, at its place by cost). Only the draft changes. The facts about the role's model stay when the model stays; the roles the
 * suggestion has nothing for keep what they had.
 */
export function applySuggestion(cfg: WorkspaceConfig, suggestion: PoolSuggestion): WorkspaceConfig {
  const roles = { ...cfg.llm.roles };
  for (const role of LLM_ROLES) {
    const pool = suggestion.roles[role];
    if (!pool) continue;
    const { fallbacks: _f, activities: _a, ...own } = roles[role];
    const { lead, ...rest } = pool;
    const head = same(own, lead) ? own : { ...lead };
    roles[role] = { ...head, ...poolFieldsOf(rest) };
  }
  return { ...cfg, llm: { ...cfg.llm, roles } };
}

/** The roles whose own model is on a provider: the ones a suggestion for that provider is made for. */
export const rolesOnProvider = (cfg: WorkspaceConfig, providerId: string): Partial<Record<LlmRole, ModelRef>> =>
  Object.fromEntries(LLM_ROLES.filter((r) => cfg.llm.roles[r].provider === providerId).map((r) => [r, { provider: providerId, model: cfg.llm.roles[r].model }]));

/** What a test of one model found, for the entries of that model in the roles' pools. */
export interface ModelFacts {
  images?: boolean;
  contextWindow?: number | null;
  reasoning?: boolean;
}

const withFacts = (r: ModelRef, f: ModelFacts): ModelRef => ({
  ...r,
  ...(f.images !== undefined ? { images: f.images } : {}),
  ...(typeof f.contextWindow === 'number' ? { contextWindow: f.contextWindow } : {}),
  ...(f.reasoning === true ? { echoReasoning: true } : {}),
});

/** Every entry of the model in the roles' pools (and the role's own model) written with what the test found; the draft only. */
export function withModelFacts(cfg: WorkspaceConfig, provider: string, model: string, facts: ModelFacts): WorkspaceConfig {
  const hit = (r: Pick<ModelRef, 'provider' | 'model'>) => r.provider === provider && r.model === model;
  const fix = (list: ModelRef[] | undefined) => list?.map((r) => (hit(r) ? withFacts(r, facts) : r));
  const roles = { ...cfg.llm.roles };
  for (const role of LLM_ROLES) {
    const rm = roles[role];
    const activities = rm.activities ? Object.fromEntries(Object.entries(rm.activities).map(([a, l]) => [a, fix(l)!])) : undefined;
    roles[role] = { ...(hit(rm) ? withFacts(rm, facts) : rm), ...(rm.fallbacks ? { fallbacks: fix(rm.fallbacks) } : {}), ...(activities ? { activities } : {}) };
  }
  return { ...cfg, llm: { ...cfg.llm, roles } };
}

/**
 * What the provider's catalog says of its models, written on every entry of that provider in the draft: the role models, the reserves, the lists of an activity and
 * the agents with a model of their own. A test regrows it, so what the person corrected by hand lasts until the next one. A model the catalog does not know keeps its
 * entry; a retirement the richer listing gives for a model the standard one no longer shows is written too. Only the draft changes, and nothing is ever swapped.
 */
export function applyCatalogOffer(cfg: WorkspaceConfig, providerId: string, catalog: readonly CatalogModel[], retired: Record<string, Retirement> = {}): WorkspaceConfig {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const mark = <R extends Pick<ModelRef, 'provider' | 'model' | 'offer'>>(r: R): R => {
    if (r.provider !== providerId) return r;
    const known = byId.get(r.model);
    const gone = retired[r.model];
    if (!known && !gone) return r;
    const base = known ? offerOf(known) : r.offer && Object.fromEntries(Object.entries(r.offer).filter(([k]) => k !== 'deprecated' && k !== 'replacedBy'));
    const offer = { ...(base ?? {}), ...(gone ? { deprecated: gone.at, ...(gone.replacedBy ? { replacedBy: gone.replacedBy } : {}) } : {}) };
    const { offer: _old, ...rest } = r;
    return { ...rest, ...(Object.keys(offer).length ? { offer } : {}) } as R;
  };
  const list = (l: ModelRef[] | undefined) => l?.map(mark);
  const roles = { ...cfg.llm.roles };
  for (const role of LLM_ROLES) {
    const rm = mark(roles[role]);
    const activities = rm.activities ? Object.fromEntries(Object.entries(rm.activities).map(([a, l]) => [a, list(l)!])) : undefined;
    roles[role] = { ...rm, ...(rm.fallbacks ? { fallbacks: list(rm.fallbacks) } : {}), ...(activities ? { activities } : {}) };
  }
  const team = cfg.agents.team.map((a) => {
    if (a.model.role !== null) return a;
    const m = mark(a.model);
    const activities = m.activities ? Object.fromEntries(Object.entries(m.activities).map(([k, l]) => [k, list(l)!])) : undefined;
    return { ...a, model: { ...m, ...(m.fallbacks ? { fallbacks: list(m.fallbacks) } : {}), ...(activities ? { activities } : {}) } };
  });
  return { ...cfg, llm: { ...cfg.llm, roles }, agents: { ...cfg.agents, team } };
}

/** The listing's entry for the tested model with what the test found written over it; the other models are left as they are. */
export function withProbed(catalog: CatalogModel[], probed: CatalogModel[], model: string): CatalogModel[] {
  const found = probed.find((m) => m.id === model);
  if (!found) return catalog;
  return catalog.some((m) => m.id === model) ? catalog.map((m) => (m.id === model ? { ...m, tools: found.tools, structured: found.structured, vision: found.vision ?? m.vision, reasoning: found.reasoning ?? m.reasoning } : m)) : catalog;
}

const clean = (o: ScoreOverrides): ScoreOverrides | undefined => {
  const floors = Object.keys(o.floors ?? {}).length ? o.floors : undefined;
  const models = Object.fromEntries(Object.entries(o.models ?? {}).filter(([, v]) => Object.keys(v).length));
  const next: ScoreOverrides = { ...(floors ? { floors } : {}), ...(Object.keys(models).length ? { models } : {}) };
  return Object.keys(next).length ? next : undefined;
};

const inRange = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= 100;

/** The floor of an activity set by the person; null puts back the table's. A value out of 0 to 100 changes nothing. */
export function withFloor(o: ScoreOverrides | undefined, activity: ScoredActivity, value: number | null): ScoreOverrides | undefined {
  if (value !== null && !inRange(value)) return o;
  const floors = { ...(o?.floors ?? {}) };
  if (value === null) delete floors[activity];
  else floors[activity] = value;
  return clean({ ...o, floors });
}

/** The score of a model for an activity set by the person (kept by its normalized id); null puts back the table's. */
export function withModelScore(o: ScoreOverrides | undefined, modelId: string, activity: ScoredActivity, value: number | null): ScoreOverrides | undefined {
  if (value !== null && !inRange(value)) return o;
  const key = normalizeModelId(modelId);
  const models = { ...(o?.models ?? {}) };
  const mine = { ...(models[key] ?? {}) };
  if (value === null) delete mine[activity];
  else mine[activity] = value;
  models[key] = mine;
  return clean({ ...o, models });
}

/** What the screen shows beside an entry of a pool. */
export interface EntryFacts {
  /** US dollars of one typical stage; null without a price in the listing. */
  cost: number | null;
  contextWindow: number | null;
  /** The scores that exist, for the activity of the list (or all three in the role's own list). */
  scores: { activity: ScoredActivity; found: FoundScore }[];
  /** The listing did not say whether the model has tools or structured output. */
  unverified: ('tools' | 'structured')[];
}

const SCORED: readonly ScoredActivity[] = ['shell', 'edit', 'screen'];

export function entryFacts(ref: ModelRef, catalog: readonly CatalogModel[] | undefined, key: PoolListKey, overrides?: ScoreOverrides): EntryFacts {
  const m = catalog?.find((x) => x.id === ref.model);
  const activities = key === 'fallbacks' ? SCORED : SCORED.filter((a) => a === key);
  const scores = activities.flatMap((activity) => {
    const found = scoreFor(ref.model, activity, overrides);
    return found ? [{ activity, found }] : [];
  });
  return {
    cost: m ? estimateStageCost(m) : null,
    contextWindow: ref.contextWindow ?? m?.contextWindow ?? null,
    scores,
    unverified: m ? [...(m.tools === null ? (['tools'] as const) : []), ...(m.structured === null ? (['structured'] as const) : [])] : [],
  };
}

/** The pool of a role replaced; its own model and the facts about it stay. */
export function withRolePool(cfg: WorkspaceConfig, role: LlmRole, pool: ModelPool): WorkspaceConfig {
  const { fallbacks: _f, activities: _a, ...own } = cfg.llm.roles[role];
  return { ...cfg, llm: { ...cfg.llm, roles: { ...cfg.llm.roles, [role]: { ...own, ...poolFieldsOf(pool) } } } };
}

/** The overrides of the scores set on the config; none left, the field leaves it. */
export function withOverrides(cfg: WorkspaceConfig, overrides: ScoreOverrides | undefined): WorkspaceConfig {
  const { scoreOverrides: _gone, ...llm } = cfg.llm;
  return { ...cfg, llm: overrides ? { ...llm, scoreOverrides: overrides } : llm };
}

/** How many lists a pool holds (the reserves, and each activity with a list of its own), for the summary of a folded editor. */
export const poolListCount = (pool: ModelPool): number => POOL_LIST_KEYS.filter((k) => listOf(pool, k).length > 0).length;

// ---- what the provider offers: the features of a provider, the effort per activity, the marks of an entry --------------------------------------

/** The provider's features with one changed; a switch off leaves the field, and no feature at all leaves `features` out (absent = nothing is sent). */
export function withFeatures(cfg: WorkspaceConfig, providerId: string, patch: Partial<ProviderFeatures>): WorkspaceConfig {
  return {
    ...cfg,
    llm: {
      ...cfg.llm,
      providers: cfg.llm.providers.map((p) => {
        if (p.id !== providerId) return p;
        const merged: ProviderFeatures = { ...(p.features ?? {}), ...patch };
        const kept: ProviderFeatures = {
          ...(merged.serviceTier ? { serviceTier: true } : {}),
          ...(merged.failFast ? { failFast: true } : {}),
          ...(merged.reasoningEffort ? { reasoningEffort: true } : {}),
          ...(merged.catalogUrl?.trim() ? { catalogUrl: merged.catalogUrl.trim() } : {}),
        };
        const { features: _old, ...rest } = p;
        return Object.keys(kept).length ? { ...rest, features: kept } : rest;
      }),
    },
  };
}

/** The provider's features replaced by the ones of its preset, which the person asked for with the button. Nothing else uses it. */
export function withPresetFeatures(cfg: WorkspaceConfig, providerId: string): WorkspaceConfig {
  const p = cfg.llm.providers.find((x) => x.id === providerId);
  const preset = p ? presetFeaturesOf(p.baseUrl) : null;
  if (!p || !preset) return cfg;
  return withFeatures({ ...cfg, llm: { ...cfg.llm, providers: cfg.llm.providers.map((x) => (x.id === providerId ? { ...x, features: undefined } : x)) } }, providerId, preset);
}

/** What the screen shows for an activity: the workspace's choice, else the proposal, else "the model's own". */
export const effortSetting = (cfg: WorkspaceConfig, activity: Activity): EffortSetting => cfg.llm.effort?.[activity] ?? DEFAULT_EFFORT[activity] ?? 'default';

/** The effort of an activity set by the person; the proposal leaves nothing in the file (absent = the proposal). */
export function withEffort(cfg: WorkspaceConfig, activity: Activity, value: EffortSetting): WorkspaceConfig {
  const effort = { ...(cfg.llm.effort ?? {}) };
  if (value === (DEFAULT_EFFORT[activity] ?? 'default')) delete effort[activity];
  else effort[activity] = value;
  const { effort: _old, ...llm } = cfg.llm;
  return { ...cfg, llm: { ...llm, ...(Object.keys(effort).length ? { effort } : {}) } };
}

/** One mark of an entry set by hand (the catalog's word is corrected on the row); a mark off leaves the field, and no mark leaves `offer` out. */
export function withMark<R extends { offer?: ModelOffer }>(entry: R, mark: 'flex' | 'effort', on: boolean): R {
  const offer: ModelOffer = { ...(entry.offer ?? {}) };
  if (on) offer[mark] = true;
  else delete offer[mark];
  const { offer: _old, ...rest } = entry;
  return (Object.keys(offer).length ? { ...rest, offer } : rest) as R;
}

export interface Obsolete {
  /** `provider · model`, as the row shows it. */
  where: string;
  model: string;
  at: number;
  replacedBy: string | null;
}

/** The models of a provider that the draft uses and the catalog marks obsolete: the role models, their reserves and lists, and the agents with a model of their own. */
export function obsoleteIn(cfg: WorkspaceConfig, providerId: string): Obsolete[] {
  const seen = new Map<string, Obsolete>();
  const note = (r: Pick<ModelRef, 'provider' | 'model' | 'offer'>) => {
    if (r.provider !== providerId || r.offer?.deprecated === undefined || seen.has(r.model)) return;
    seen.set(r.model, { where: `${r.provider} · ${r.model}`, model: r.model, at: r.offer.deprecated, replacedBy: r.offer.replacedBy ?? null });
  };
  const walk = (m: ModelPool & Pick<ModelRef, 'provider' | 'model' | 'offer'>) => {
    note(m);
    (m.fallbacks ?? []).forEach(note);
    Object.values(m.activities ?? {}).forEach((l) => (l ?? []).forEach(note));
  };
  for (const role of LLM_ROLES) walk(cfg.llm.roles[role]);
  for (const a of cfg.agents.team) if (a.model.role === null) walk(a.model);
  return [...seen.values()];
}

/** The marks of a role's own model set by hand; the pool of the role stays. */
export function withRoleOffer(cfg: WorkspaceConfig, role: LlmRole, offer: ModelOffer | undefined): WorkspaceConfig {
  const { offer: _old, ...rm } = cfg.llm.roles[role];
  return { ...cfg, llm: { ...cfg.llm, roles: { ...cfg.llm.roles, [role]: { ...rm, ...(offer ? { offer } : {}) } } } };
}
