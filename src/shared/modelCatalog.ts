// Reads what a provider's model listing (`GET {baseUrl}/models`) says about each model: price, context window and capabilities. Pure, so the
// connection test, the wizard and the tests share it. Nothing here is standard to the OpenAI protocol; a listing with neither format below
// gives every model with all facts unknown (null), and the caller must treat null as "not said", never as "no".
import type { ModelOffer } from './config/types';

/** US dollars per million tokens. `cacheRead` is null when the listing has no price for cached input. */
export interface CatalogPrice {
  input: number;
  output: number;
  cacheRead: number | null;
}

export interface CatalogModel {
  id: string;
  contextWindow: number | null;
  price: CatalogPrice | null;
  /** Accepts an image in a message. */
  vision: boolean | null;
  /** Calls tools. */
  tools: boolean | null;
  /** Answers to a response schema (structured output). */
  structured: boolean | null;
  reasoning: boolean | null;
  /** The provider caches the prompt. */
  cache: boolean | null;
  /** Takes `reasoning_effort`. */
  effort: boolean | null;
  /** Served in the flex tier. Only the provider's richer listing says (see `mergeRich`). */
  flex: boolean | null;
  /** When the provider retires the model, in seconds since 1970; only the richer listing says. */
  deprecated: number | null;
  /** The model the provider says replaces it. */
  replacedBy: string | null;
}

/** The most models kept from one listing (a hosted catalog can list hundreds). */
export const MAX_CATALOG_MODELS = 300;

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite, non-negative number from a number or a numeric string; null otherwise (the aggregators use "-1" for a price that varies). */
function amount(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function windowOf(v: unknown): number | null {
  const n = amount(v);
  return n !== null && n > 0 ? Math.floor(n) : null;
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : null);

const unknownModel = (id: string): CatalogModel => ({ id, contextWindow: null, price: null, vision: null, tools: null, structured: null, reasoning: null, cache: null, effort: null, flex: null, deprecated: null, replacedBy: null });

/**
 * Format (a): `data[].metadata` of an OpenAI-compatible server that publishes it. Checked against a live provider: `context_length`, `pricing` with
 * `input_tokens`, `output_tokens` and `cache_read_tokens` in US dollars per million tokens, and `tags` such as `vision`, `prompt_cache` and `reasoning`.
 * The tag list is the provider's own list of what a model can do, so a tag that is absent says no for those three; `tools` and `structured-output` are
 * only believed when present (a list that does not carry them does not say they are missing).
 */
function fromMetadata(id: string, meta: Raw): CatalogModel {
  const out = unknownModel(id);
  out.contextWindow = windowOf(meta.context_length);
  const p = meta.pricing;
  if (isObj(p)) {
    const input = amount(p.input_tokens);
    const output = amount(p.output_tokens);
    if (input !== null && output !== null) out.price = { input, output, cacheRead: amount(p.cache_read_tokens) };
  }
  const tags = strings(meta.tags);
  if (tags) {
    out.vision = tags.includes('vision');
    out.reasoning = tags.includes('reasoning');
    out.cache = tags.includes('prompt_cache');
    out.effort = tags.includes('reasoning_effort');
    if (tags.includes('tools') || tags.includes('tool_use') || tags.includes('function_calling')) out.tools = true;
    if (tags.includes('structured-output') || tags.includes('structured_output') || tags.includes('json')) out.structured = true;
  }
  if (out.cache === null && out.price?.cacheRead != null) out.cache = true;
  return out;
}

/**
 * Format (b): the model listing of a model aggregator. Written from its public documentation and NOT checked against the service: `pricing.prompt`,
 * `pricing.completion` and `pricing.input_cache_read` are strings in US dollars per token ("-1" means a price that varies), `context_length` is at the root,
 * `architecture.input_modalities` lists `image` for a vision model, and `supported_parameters` lists `tools`, `structured_outputs` or `response_format`, and
 * `reasoning`. Both lists are complete in the documentation, so a name that is absent says no.
 */
function fromAggregator(id: string, m: Raw): CatalogModel {
  const out = unknownModel(id);
  out.contextWindow = windowOf(m.context_length) ?? (isObj(m.top_provider) ? windowOf(m.top_provider.context_length) : null);
  const p = m.pricing;
  if (isObj(p)) {
    const perToken = (v: unknown): number | null => {
      const n = amount(v);
      return n === null ? null : n * 1_000_000;
    };
    const input = perToken(p.prompt);
    const output = perToken(p.completion);
    if (input !== null && output !== null) out.price = { input, output, cacheRead: perToken(p.input_cache_read) };
  }
  const arch = isObj(m.architecture) ? m.architecture : null;
  const modalities = arch ? strings(arch.input_modalities) : null;
  if (modalities) out.vision = modalities.includes('image');
  const params = strings(m.supported_parameters);
  if (params) {
    out.tools = params.includes('tools');
    out.structured = params.includes('structured_outputs') || params.includes('response_format');
    out.reasoning = params.includes('reasoning') || params.includes('include_reasoning');
    out.effort = params.includes('reasoning_effort');
  }
  if (out.price?.cacheRead != null) out.cache = true;
  return out;
}

/** The aggregator's listing is told apart by its shape: per-token prices as text, or a parameter list, at the root of the entry. */
function isAggregatorShape(m: Raw): boolean {
  if (Array.isArray(m.supported_parameters) || isObj(m.architecture)) return true;
  return isObj(m.pricing) && ('prompt' in m.pricing || 'completion' in m.pricing);
}

/** One entry of `data` (or `models`) of a listing. Null when it has no id. */
export function parseCatalogEntry(raw: unknown): CatalogModel | null {
  if (!isObj(raw)) return null;
  const id = String(raw.id ?? raw.name ?? raw.model ?? '').trim();
  if (!id) return null;
  if (isObj(raw.metadata)) return fromMetadata(id, raw.metadata);
  if (isAggregatorShape(raw)) return fromAggregator(id, raw);
  return unknownModel(id);
}

/** The listing as facts per model; never throws, whatever the server sent. */
export function parseCatalog(raw: unknown): CatalogModel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const entry of raw) {
    const m = parseCatalogEntry(entry);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= MAX_CATALOG_MODELS) break;
  }
  // A server that marks `reasoning_effort` on no model at all does not use the tag: there a model that reasons is taken as one that takes the effort. The person
  // corrects a wrong guess on the entry.
  if (!out.some((m) => m.effort === true)) for (const m of out) m.effort = m.reasoning;
  return out;
}

/** What the catalog says of a model that the config keeps with its entry (`ModelOffer`): only what is known to be true, and the retirement. Undefined when it says nothing. */
export function offerOf(m: Pick<CatalogModel, 'flex' | 'effort' | 'deprecated' | 'replacedBy'>): ModelOffer | undefined {
  const offer: ModelOffer = {
    ...(m.flex === true ? { flex: true } : {}),
    ...(m.effort === true ? { effort: true } : {}),
    ...(m.deprecated !== null ? { deprecated: m.deprecated } : {}),
    ...(m.deprecated !== null && m.replacedBy ? { replacedBy: m.replacedBy } : {}),
  };
  return Object.keys(offer).length ? offer : undefined;
}

// ---- the richer listing -------------------------------------------------------------------------------------------------------------

/** What the provider's richer listing says of one model: the tags the standard listing does not carry, and the retirement. */
export interface RichModel {
  id: string;
  flex: boolean;
  /** The listing tags the model for tool calls. Absent from the tags says nothing (the standard listing may know better). */
  tools: boolean;
  structured: boolean;
  deprecated: number | null;
  replacedBy: string | null;
}

/** The most entries read from a richer listing. */
export const MAX_RICH_MODELS = 2000;

/** The richer listing: an array of `{ model_name, tags, deprecated, replaced_by }`. Never throws. Written from the provider's published reference and a saved copy of its answer. */
export function parseRichCatalog(raw: unknown): RichModel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RichModel[] = [];
  for (const entry of raw) {
    if (!isObj(entry)) continue;
    const id = String(entry.model_name ?? entry.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const tags = strings(entry.tags) ?? [];
    const when = amount(entry.deprecated);
    out.push({
      id,
      flex: tags.includes('flex'),
      tools: tags.includes('tools'),
      structured: tags.includes('structured-output') || tags.includes('structured_output'),
      deprecated: when !== null && when > 0 ? Math.floor(when) : null,
      replacedBy: typeof entry.replaced_by === 'string' && entry.replaced_by.trim() ? entry.replaced_by.trim() : null,
    });
    if (out.length >= MAX_RICH_MODELS) break;
  }
  return out;
}

/** When a model is retired and what replaces it. */
export interface Retirement {
  at: number;
  replacedBy: string | null;
}

/** The most retirements kept from one listing. */
export const MAX_RETIREMENTS = 500;

/** The models the richer listing marks as retired, by id, including the ones the standard listing no longer shows. */
export function retirementsOf(rich: readonly RichModel[]): Record<string, Retirement> {
  const out: Record<string, Retirement> = {};
  let n = 0;
  for (const m of rich) {
    if (m.deprecated === null) continue;
    out[m.id] = { at: m.deprecated, replacedBy: m.replacedBy };
    if (++n >= MAX_RETIREMENTS) break;
  }
  return out;
}

/**
 * The standard listing with what the richer one adds: the flex tag and the retirement, and the tool and structured-output tags, which clear a model's "unverified" mark
 * (only to true: a tag the richer listing does not carry is not a no). Models the richer listing does not know stay as they were.
 */
export function mergeRich(catalog: readonly CatalogModel[], rich: readonly RichModel[]): CatalogModel[] {
  const by = new Map(rich.map((r) => [r.id, r]));
  return catalog.map((m) => {
    const r = by.get(m.id);
    if (!r) return m;
    return { ...m, flex: r.flex, deprecated: r.deprecated, replacedBy: r.replacedBy, ...(r.tools ? { tools: true } : {}), ...(r.structured ? { structured: true } : {}) };
  });
}

/** True when the listing said something about any model beyond its id (otherwise there is nothing to suggest from). */
export const catalogHasFacts = (catalog: readonly CatalogModel[]): boolean =>
  catalog.some((m) => m.price !== null || m.contextWindow !== null || m.vision !== null || m.tools !== null || m.structured !== null);

/**
 * A typical implementation stage, in millions of tokens, from a real run: input that came from the prompt cache, input that did not, and output. The cache
 * is most of the input, which is why a model with a cheap cached price can cost less per stage than one with a lower list price.
 */
export const STAGE_PROFILE = { cachedIn: 2.05, freshIn: 0.06, out: 0.0157 } as const;

export interface StageProfile {
  cachedIn: number;
  freshIn: number;
  out: number;
}

/** US dollars of one typical stage; cached input is charged at the input price when the listing has no cache price. Null without a price. */
export function estimateStageCost(m: Pick<CatalogModel, 'price'>, profile: StageProfile = STAGE_PROFILE): number | null {
  if (!m.price) return null;
  const { input, output, cacheRead } = m.price;
  return profile.cachedIn * (cacheRead ?? input) + profile.freshIn * input + profile.out * output;
}
