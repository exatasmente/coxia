import { describe, expect, it } from 'vitest';
import { type CatalogModel, STAGE_PROFILE, catalogHasFacts, estimateStageCost, mergeRich, parseCatalog, parseCatalogEntry, parseRichCatalog, retirementsOf } from '../src/shared/modelCatalog';

// The listing of a server that publishes `metadata`; prices in US dollars per million tokens.
const withMetadata = (id: string, meta: object) => ({ id, object: 'model', metadata: meta });

describe('parseCatalog: the OpenAI-compatible listing with metadata', () => {
  it('reads context, the three prices and the tags', () => {
    const [m] = parseCatalog([
      withMetadata('model-a', { context_length: 131072, pricing: { input_tokens: 0.3, output_tokens: 1.2, cache_read_tokens: 0.06 }, tags: ['vision', 'prompt_cache', 'reasoning'] }),
    ]);
    expect(m).toEqual({ id: 'model-a', contextWindow: 131072, price: { input: 0.3, output: 1.2, cacheRead: 0.06 }, vision: true, tools: null, structured: null, reasoning: true, cache: true, effort: true, flex: null, deprecated: null, replacedBy: null });
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
    expect(catalog[0]).toEqual({ id: 'model-a', contextWindow: null, price: null, vision: null, tools: null, structured: null, reasoning: null, cache: null, effort: null, flex: null, deprecated: null, replacedBy: null });
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

describe('the reasoning effort tag', () => {
  it('is read from the `reasoning_effort` tag where the listing uses it, and a model without it does not take the effort', () => {
    const [a, b, c] = parseCatalog([
      withMetadata('model-a', { tags: ['reasoning', 'reasoning_effort'] }),
      withMetadata('model-b', { tags: ['reasoning'] }),
      withMetadata('model-c', { tags: ['vision'] }),
    ]);
    expect([a.effort, b.effort, c.effort]).toEqual([true, false, false]);
  });

  it('where no model carries the tag (a server that does not use it), a model that reasons is taken as one that takes the effort', () => {
    const [a, b, c] = parseCatalog([withMetadata('model-a', { tags: ['reasoning'] }), withMetadata('model-b', { tags: ['vision'] }), { id: 'model-c' }]);
    expect([a.effort, b.effort, c.effort]).toEqual([true, false, null]);
  });

  it('is read from the parameters of the aggregator listing', () => {
    const [a, b] = parseCatalog([
      { id: 'model-a', context_length: 64000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools', 'reasoning', 'reasoning_effort'] },
      { id: 'model-b', context_length: 64000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools', 'reasoning'] },
    ]);
    expect([a.effort, b.effort]).toEqual([true, false]);
  });
});

describe('the richer listing', () => {
  // Entries as the provider publishes them: `model_name`, `tags`, `deprecated` (seconds since 1970) and `replaced_by`, which are null for a model in service.
  const rich = [
    { model_name: 'model-a', tags: ['openai', 'flex', 'tools', 'structured-output'], deprecated: null, replaced_by: null },
    { model_name: 'model-b', tags: ['openai'], deprecated: null, replaced_by: null },
    { model_name: 'model-old', tags: ['openai', 'tools'], deprecated: 1781217521, replaced_by: 'model-a' },
    { model_name: 'model-gone', tags: [], deprecated: 1700000000, replaced_by: '' },
    { model_name: 'model-c', tags: ['structured_output'] },
  ];

  it('reads the flex and schema tags, the tool tag, the retirement date and the substitute', () => {
    const got = parseRichCatalog(rich);
    expect(got.find((m) => m.id === 'model-a')).toEqual({ id: 'model-a', flex: true, tools: true, structured: true, deprecated: null, replacedBy: null });
    expect(got.find((m) => m.id === 'model-old')).toMatchObject({ flex: false, tools: true, deprecated: 1781217521, replacedBy: 'model-a' });
    expect(got.find((m) => m.id === 'model-gone')).toMatchObject({ deprecated: 1700000000, replacedBy: null });
    expect(got.find((m) => m.id === 'model-c')?.structured).toBe(true);
  });

  it('does not throw on anything else, and skips what has no name or repeats one', () => {
    expect(parseRichCatalog(undefined)).toEqual([]);
    expect(parseRichCatalog({ data: [] })).toEqual([]);
    expect(parseRichCatalog([null, 3, 'x', {}, { model_name: '' }, { model_name: 'm', deprecated: 'soon', tags: 'flex' }, { model_name: 'm' }])).toEqual([{ id: 'm', flex: false, tools: false, structured: false, deprecated: null, replacedBy: null }]);
  });

  it('lists the retired models by id, the ones the standard listing no longer shows included', () => {
    expect(retirementsOf(parseRichCatalog(rich))).toEqual({ 'model-old': { at: 1781217521, replacedBy: 'model-a' }, 'model-gone': { at: 1700000000, replacedBy: null } });
  });

  it('adds flex and the retirement to the models of the standard listing, and the tags only ever to true', () => {
    const base = parseCatalog([withMetadata('model-a', { tags: ['reasoning'] }), withMetadata('model-b', { tags: ['reasoning'] }), withMetadata('model-old', { tags: [] }), withMetadata('model-other', { tags: [] })]);
    const merged = mergeRich(base, parseRichCatalog(rich));
    const by = (id: string): CatalogModel => merged.find((m) => m.id === id)!;
    // the tool and schema tags clear the "unverified" of a model the standard listing said nothing of
    expect(by('model-a')).toMatchObject({ flex: true, tools: true, structured: true, deprecated: null });
    // a tag the richer listing does not carry is not a no
    expect(by('model-b')).toMatchObject({ flex: false, tools: null, structured: null });
    expect(by('model-old')).toMatchObject({ deprecated: 1781217521, replacedBy: 'model-a', tools: true });
    // a model the richer listing does not know stays as it was
    expect(by('model-other')).toEqual(base.find((m) => m.id === 'model-other'));
    // the richer listing never turns off what the standard one said
    const said = parseCatalog([withMetadata('model-b', { tags: ['tools'] })]);
    expect(mergeRich(said, parseRichCatalog([{ model_name: 'model-b', tags: [] }]))[0].tools).toBe(true);
  });
});
