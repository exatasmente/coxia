import { describe, expect, it } from 'vitest';
import { STAGE_PROFILE, catalogHasFacts, estimateStageCost, parseCatalog, parseCatalogEntry } from '../src/shared/modelCatalog';

// The listing of a server that publishes `metadata`; prices in US dollars per million tokens.
const withMetadata = (id: string, meta: object) => ({ id, object: 'model', metadata: meta });

describe('parseCatalog: the OpenAI-compatible listing with metadata', () => {
  it('reads context, the three prices and the tags', () => {
    const [m] = parseCatalog([
      withMetadata('model-a', { context_length: 131072, pricing: { input_tokens: 0.3, output_tokens: 1.2, cache_read_tokens: 0.06 }, tags: ['vision', 'prompt_cache', 'reasoning'] }),
    ]);
    expect(m).toEqual({ id: 'model-a', contextWindow: 131072, price: { input: 0.3, output: 1.2, cacheRead: 0.06 }, vision: true, tools: null, structured: null, reasoning: true, cache: true });
  });

  it('takes a tag list as complete for vision, reasoning and cache, but never reads a missing tools tag as "no tools"', () => {
    const [m] = parseCatalog([withMetadata('model-a', { context_length: 64000, tags: ['prompt_cache'] })]);
    expect(m).toMatchObject({ vision: false, reasoning: false, cache: true, tools: null, structured: null, price: null });
    const [t] = parseCatalog([withMetadata('model-b', { tags: ['tools', 'structured-output'] })]);
    expect(t).toMatchObject({ tools: true, structured: true, contextWindow: null });
  });

  it('has no cache price when the listing has none', () => {
    const [m] = parseCatalog([withMetadata('model-a', { pricing: { input_tokens: 0.1, output_tokens: 0.4 } })]);
    expect(m.price).toEqual({ input: 0.1, output: 0.4, cacheRead: null });
  });

  it('ignores a price that is not a number and a window that is not positive', () => {
    const [m] = parseCatalog([withMetadata('model-a', { context_length: 0, pricing: { input_tokens: 'many', output_tokens: 1 } })]);
    expect(m).toMatchObject({ contextWindow: null, price: null });
  });
});

// Written from the public documentation of a model aggregator, not checked against the service (see modelCatalog.ts).
describe('parseCatalog: the aggregator listing, told apart by its shape', () => {
  const aggregator = {
    id: 'org/model-b:free',
    context_length: 200000,
    pricing: { prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.00000006' },
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['tools', 'structured_outputs', 'reasoning', 'temperature'],
  };

  it('converts a price per token to a price per million tokens', () => {
    const [m] = parseCatalog([aggregator]);
    expect(m.price?.input).toBeCloseTo(0.3, 9);
    expect(m.price?.output).toBeCloseTo(1.2, 9);
    expect(m.price?.cacheRead).toBeCloseTo(0.06, 9);
    expect(m).toMatchObject({ id: 'org/model-b:free', contextWindow: 200000, vision: true, tools: true, structured: true, reasoning: true, cache: true });
  });

  it('reads a missing capability in the parameter list as a no, and a text-only model as no vision', () => {
    const [m] = parseCatalog([{ ...aggregator, architecture: { input_modalities: ['text'] }, supported_parameters: ['temperature', 'response_format'] }]);
    expect(m).toMatchObject({ vision: false, tools: false, structured: true, reasoning: false });
  });

  it('takes a price of "-1" (it varies) as no price, and the window from top_provider when the root has none', () => {
    const [m] = parseCatalog([{ id: 'model-c', pricing: { prompt: '-1', completion: '-1' }, top_provider: { context_length: 64000 }, supported_parameters: [] }]);
    expect(m.price).toBeNull();
    expect(m.contextWindow).toBe(64000);
  });
});

describe('parseCatalog: what it must survive', () => {
  it('gives every fact as unknown for a listing with only ids', () => {
    const catalog = parseCatalog([{ id: 'model-a' }, { name: 'model-b' }]);
    expect(catalog.map((m) => m.id)).toEqual(['model-a', 'model-b']);
    expect(catalog[0]).toEqual({ id: 'model-a', contextWindow: null, price: null, vision: null, tools: null, structured: null, reasoning: null, cache: null });
    expect(catalogHasFacts(catalog)).toBe(false);
  });

  it('does not throw on anything else and skips entries without an id, repeats and non-objects', () => {
    expect(parseCatalog(undefined)).toEqual([]);
    expect(parseCatalog('nope')).toEqual([]);
    expect(parseCatalog([null, 3, 'x', [], {}, { id: '' }, { id: 'model-a', metadata: 'oops' }, { id: 'model-a' }])).toEqual([expect.objectContaining({ id: 'model-a' })]);
    expect(parseCatalogEntry({ id: 'm', metadata: { pricing: 5, tags: 'vision' } })).toMatchObject({ id: 'm', price: null, vision: null });
  });

  it('keeps at most 300 models', () => {
    expect(parseCatalog(Array.from({ length: 450 }, (_, i) => ({ id: `m-${i}` })))).toHaveLength(300);
  });
});

describe('estimateStageCost', () => {
  it('charges cached input at the cache price', () => {
    expect(estimateStageCost({ price: { input: 0.3, output: 1.2, cacheRead: 0.06 } })).toBeCloseTo(0.15984, 6);
  });

  it('charges cached input at the input price when the listing has no cache price: the cheaper list price can cost more', () => {
    const noCache = estimateStageCost({ price: { input: 0.1, output: 0.4, cacheRead: null } });
    expect(noCache).toBeCloseTo(0.21728, 6);
    expect(noCache).toBeGreaterThan(estimateStageCost({ price: { input: 0.3, output: 1.2, cacheRead: 0.06 } })!);
  });

  it('is null without a price, and uses the profile it is given', () => {
    expect(estimateStageCost({ price: null })).toBeNull();
    expect(estimateStageCost({ price: { input: 1, output: 2, cacheRead: null } }, { cachedIn: 1, freshIn: 1, out: 1 })).toBe(4);
    expect(STAGE_PROFILE).toEqual({ cachedIn: 2.05, freshIn: 0.06, out: 0.0157 });
  });
});
