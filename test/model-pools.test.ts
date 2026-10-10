import { describe, expect, it } from 'vitest';
import type { ScoreOverrides } from '../src/shared/config/types';
import { type CatalogModel, mergeRich, parseRichCatalog } from '../src/shared/modelCatalog';
import { MIN_SUGGESTED_CONTEXT, rankForActivity, suggestPools } from '../src/shared/modelPools';
import { FLOORS, SCORE_ENTRIES, SCORE_TABLE_VERSION, floorFor, normalizeModelId, scoreFor } from '../src/shared/modelScores';

// Neutral models. `cost` is the input price: the output is twice it, no cache price, so the stage cost grows with it.
const model = (id: string, input: number | null, over: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  contextWindow: 128000,
  price: input === null ? null : { input, output: input * 2, cacheRead: null },
  vision: false,
  tools: true,
  structured: true,
  reasoning: false,
  cache: false,
  effort: null,
  flex: null,
  deprecated: null,
  replacedBy: null,
  ...over,
});
const ids = (list: { ref: { model: string } }[]) => list.map((r) => r.ref.model);
const opts = { provider: 'p1' };

// Floors above the scores of the fixtures below, so the stronger model passes and the cheaper one does not.
const strict: ScoreOverrides = { floors: { shell: 90, edit: 70 }, models: { 'model-a': { shell: 90.6, edit: 74.2, screen: 80.8 }, 'model-b': { shell: 87.6, edit: 67.9, screen: 80.8 } } };

describe('rankForActivity', () => {
  it('orders explore and write by the price of a typical stage, ties by id', () => {
    const list = [model('model-c', 0.5), model('model-b', 0.2), model('model-a', 0.2), model('model-z', null)];
    expect(ids(rankForActivity(list, 'explore', opts))).toEqual(['model-a', 'model-b', 'model-c', 'model-z']);
    expect(ids(rankForActivity(list, 'write', opts))).toEqual(['model-a', 'model-b', 'model-c', 'model-z']);
  });

  it('puts the models that reach the floor first, by price, then the ones under it, then the ones without a score', () => {
    const list = [model('model-a', 0.5), model('model-b', 0.2), model('model-c', 0.1), model('model-d', 0.05)];
    const overrides: ScoreOverrides = { floors: { shell: 85 }, models: { 'model-a': { shell: 90.6 }, 'model-b': { shell: 87.6 }, 'model-c': { shell: 80 } } };
    const ranked = rankForActivity(list, 'shell', { ...opts, scoreOverrides: overrides });
    // b and a pass (b is cheaper), c is under the floor, d has no score although it is the cheapest.
    expect(ids(ranked)).toEqual(['model-b', 'model-a', 'model-c', 'model-d']);
    expect(ranked.map((r) => r.belowFloor)).toEqual([false, false, true, false]);
    expect(ranked.map((r) => r.score)).toEqual([87.6, 90.6, 80, null]);
  });

  it('lets the stronger and dearer model ahead of the cheaper one when the floor sits between them (shell and edit)', () => {
    const list = [model('model-b', 0.2), model('model-a', 0.3)];
    expect(ids(rankForActivity(list, 'shell', { ...opts, scoreOverrides: strict }))).toEqual(['model-a', 'model-b']);
    expect(ids(rankForActivity(list, 'edit', { ...opts, scoreOverrides: strict }))).toEqual(['model-a', 'model-b']);
    // explore has no floor: the price alone orders it.
    expect(ids(rankForActivity(list, 'explore', { ...opts, scoreOverrides: strict }))).toEqual(['model-b', 'model-a']);
  });

  it('can leave out what is under the floor', () => {
    const list = [model('model-a', 0.3), model('model-b', 0.2)];
    expect(ids(rankForActivity(list, 'shell', { ...opts, scoreOverrides: strict, dropBelowFloor: true }))).toEqual(['model-a']);
  });

  it('lists screen only for a model that takes images, the cheapest with a score first', () => {
    const list = [model('model-a', 0.5, { vision: true }), model('model-b', 0.2, { vision: true }), model('model-c', 0.1, { vision: false }), model('model-d', 0.05, { vision: null }), model('model-e', 0.01, { vision: true })];
    const ranked = rankForActivity(list, 'screen', { ...opts, scoreOverrides: { models: { 'model-a': { screen: 80.8 }, 'model-b': { screen: 80.8 } } } });
    // e is the cheapest but has no score: it comes after the two that pass.
    expect(ids(ranked)).toEqual(['model-b', 'model-a', 'model-e']);
  });

  it('keeps out a model without tools or structured output, and one with a small or unknown context', () => {
    const list = [
      model('model-a', 0.1),
      model('no-tools', 0.01, { tools: false }),
      model('no-schema', 0.01, { structured: false }),
      model('small', 0.01, { contextWindow: MIN_SUGGESTED_CONTEXT - 1 }),
      model('unknown-window', 0.01, { contextWindow: null }),
      model('exactly', 0.2, { contextWindow: MIN_SUGGESTED_CONTEXT }),
    ];
    expect(ids(rankForActivity(list, 'write', opts))).toEqual(['model-a', 'exactly']);
  });

  it('keeps a model whose tools or structured output the listing did not say, and marks it unverified', () => {
    const [r] = rankForActivity([model('model-a', 0.1, { tools: null, structured: null })], 'write', opts);
    expect(r.unverified).toEqual(['tools', 'structured']);
    expect(rankForActivity([model('model-a', 0.1)], 'write', opts)[0].unverified).toEqual([]);
  });

  it('the tool and schema tags of the richer listing clear the unverified mark of a model the standard listing said nothing of', () => {
    const base = [model('model-a', 0.1, { tools: null, structured: null }), model('model-b', 0.2, { tools: null, structured: null })];
    const merged = mergeRich(base, parseRichCatalog([{ model_name: 'model-a', tags: ['tools', 'structured-output'] }, { model_name: 'model-b', tags: ['tools'] }]));
    const ranked = rankForActivity(merged, 'write', opts);
    expect(ranked.map((r) => [r.ref.model, r.unverified])).toEqual([['model-a', []], ['model-b', ['structured']]]);
  });

  it('carries the offer of the catalog into the entry: only what is true, and a retirement with its substitute', () => {
    const [r] = rankForActivity([model('model-a', 0.1, { flex: true, effort: false, deprecated: 1790000000, replacedBy: 'model-b' })], 'write', opts);
    expect(r.ref.offer).toEqual({ flex: true, deprecated: 1790000000, replacedBy: 'model-b' });
    expect(rankForActivity([model('model-a', 0.1, { flex: false, effort: null })], 'write', opts)[0].ref).not.toHaveProperty('offer');
  });

  it('carries what the listing said into the entry', () => {
    const [r] = rankForActivity([model('model-a', 0.1, { vision: true, reasoning: true, contextWindow: 64000 })], 'write', opts);
    expect(r.ref).toEqual({ provider: 'p1', model: 'model-a', images: true, contextWindow: 64000, echoReasoning: true });
    expect(r.cost).toBeCloseTo(2.05 * 0.1 + 0.06 * 0.1 + 0.0157 * 0.2, 9);
  });

  it('applies the overrides of the person: a floor and a score', () => {
    const list = [model('model-a', 0.3), model('model-b', 0.2)];
    // The table does not know these fictitious ids: both are unscored and the price decides.
    expect(ids(rankForActivity(list, 'shell', opts))).toEqual(['model-b', 'model-a']);
    const ranked = rankForActivity(list, 'shell', { ...opts, scoreOverrides: { models: { 'model-a': { shell: 95 } } } });
    expect(ids(ranked)).toEqual(['model-a', 'model-b']);
    expect(ranked[0].source).toBe('override');
  });
});

describe('suggestPools', () => {
  const catalog = [model('model-a', 0.3, { vision: true }), model('model-b', 0.2, { vision: true }), model('model-c', 0.1), model('model-d', 0.4)];

  it('starts each role on the provider with the cheapest model and keeps its model of today at its place by cost', () => {
    const s = suggestPools(catalog, { ...opts, roles: { turn: { provider: 'p1', model: 'model-d' }, deep: { provider: 'p1', model: 'model-c' } } });
    expect(ids(s.write)).toEqual(['model-c', 'model-b', 'model-a', 'model-d']);
    expect(s.roles.turn?.lead.model).toBe('model-c');
    expect(s.roles.turn?.fallbacks?.map((r) => r.model)).toEqual(['model-b', 'model-a', 'model-d']);
    expect(s.roles.deep?.lead.model).toBe('model-c');
    expect(s.roles.deep?.fallbacks?.map((r) => r.model)).toEqual(['model-b', 'model-a', 'model-d']);
    expect(s.roles.reply).toBeUndefined();
  });

  it('adds a list for an activity only where it differs from the default one', () => {
    const none = suggestPools(catalog, { ...opts, roles: { turn: { provider: 'p1', model: 'model-c' } } });
    // Only screen differs: it needs a model with images, and edit and shell have no score to reorder them.
    expect(Object.keys(none.activities)).toEqual(['screen']);
    const noImages = suggestPools(catalog.map((m) => ({ ...m, vision: false })), { ...opts, roles: { turn: { provider: 'p1', model: 'model-c' } } });
    expect(noImages.activities).toEqual({});
    expect(noImages.roles.turn?.activities).toBeUndefined();
    const s = suggestPools(catalog, { ...opts, scoreOverrides: strict, roles: { turn: { provider: 'p1', model: 'model-c' } } });
    expect(Object.keys(s.activities).sort()).toEqual(['edit', 'screen', 'shell']);
    expect(ids(s.activities.shell!)).toEqual(['model-a', 'model-b', 'model-c', 'model-d']);
    expect(ids(s.activities.screen!)).toEqual(['model-b', 'model-a']);
    expect(s.roles.turn?.activities?.screen?.map((r) => r.model)).toEqual(['model-b', 'model-a']);
  });

  it('is empty for a listing that says nothing, and never exceeds the size', () => {
    const bare = suggestPools([{ id: 'model-a', contextWindow: null, price: null, vision: null, tools: null, structured: null, reasoning: null, cache: null, effort: null, flex: null, deprecated: null, replacedBy: null }], opts);
    expect(bare.write).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => model(`m-${String(i).padStart(2, '0')}`, 0.1 + i / 100));
    const s = suggestPools(many, { ...opts, roles: { turn: { provider: 'p1', model: 'own' } } });
    expect(s.write).toHaveLength(4);
    expect(s.roles.turn?.lead.model).toBe('m-00');
    // The role's model of today is not in the listing: it stays, last.
    expect(s.roles.turn?.fallbacks?.map((r) => r.model)).toEqual(['m-01', 'm-02', 'own']);
    const late = suggestPools(many, { ...opts, roles: { turn: { provider: 'p1', model: 'm-09' } } });
    expect(late.roles.turn?.fallbacks?.map((r) => r.model)).toEqual(['m-01', 'm-02', 'm-09']);
  });
});

describe('the shipped score table', () => {
  it('is versioned and carries the floors of the maintainer', () => {
    expect(SCORE_TABLE_VERSION).toBe(2);
    expect(FLOORS).toEqual({ shell: 90, edit: 70, screen: 70 });
    expect(floorFor('shell', { floors: { shell: 90 } })).toBe(90);
    expect(floorFor('explore')).toBeNull();
  });

  it('matches by normalized id, so an aggregator id finds the same model', () => {
    expect(normalizeModelId('DeepSeek/DeepSeek-V4.1-Flash:free')).toBe('deepseek-v4.1-flash');
    for (const id of ['deepseek-ai/DeepSeek-V4.1-Flash', 'deepseek/deepseek-v4.1-flash', 'deepseek-v4.1-flash:free']) {
      expect(scoreFor(id, 'shell')?.score).toBe(90.6);
      expect(scoreFor(id, 'edit')?.score).toBe(74.2);
      expect(scoreFor(id, 'screen')).toBeNull();
    }
    expect(scoreFor('XiaomiMiMo/MiMo-V2.6-Flash', 'screen')).toEqual({ score: 80.8, source: { benchmark: 'OSWorld-Verified', origin: 'self-reported' } });
    expect(scoreFor('mimo-v2.6-flash', 'edit')?.score).toBe(67.9);
    expect(scoreFor('model-a', 'shell')).toBeNull();
  });

  it('names the source of every score, and marks the third-party comparison', () => {
    for (const e of SCORE_ENTRIES) for (const a of Object.keys(e.scores)) expect(e.sources[a as keyof typeof e.sources], `${e.names[0]} ${a}`).toBeTruthy();
    expect(scoreFor('zai-org/GLM-5.3-Flash', 'shell')).toEqual({ score: 84.3, source: { benchmark: 'Terminal-Bench 2.1', origin: 'third-party' } });
    expect(scoreFor('zai-org/GLM-5.3-Flash', 'edit')?.source).toEqual({ benchmark: 'DeepSWE v1.1', origin: 'third-party' });
    expect((scoreFor('deepseek-ai/DeepSeek-V4.1-Flash', 'shell')?.source as { origin: string }).origin).toBe('self-reported');
  });

  it('puts the stronger model first for shell and edit with the shipped floors, and the cheapest with images first for screen', () => {
    // Costs in the order of the listing the maintainer chose from: the cheapest has images and the lower scores.
    const list = [
      model('XiaomiMiMo/MiMo-V2.6-Flash', 0.1, { vision: true }),
      model('deepseek-ai/DeepSeek-V4.1-Flash', 0.2, { vision: true }),
      model('zai-org/GLM-5.3-Flash', 0.3, { vision: true }),
    ];
    const shell = rankForActivity(list, 'shell', opts);
    expect(ids(shell)).toEqual(['deepseek-ai/DeepSeek-V4.1-Flash', 'XiaomiMiMo/MiMo-V2.6-Flash', 'zai-org/GLM-5.3-Flash']);
    expect(shell.map((r) => r.belowFloor)).toEqual([false, true, true]);
    expect(ids(rankForActivity(list, 'edit', opts))).toEqual(['deepseek-ai/DeepSeek-V4.1-Flash', 'XiaomiMiMo/MiMo-V2.6-Flash', 'zai-org/GLM-5.3-Flash']);
    expect(ids(rankForActivity(list, 'screen', opts))[0]).toBe('XiaomiMiMo/MiMo-V2.6-Flash');
    expect(ids(rankForActivity(list, 'write', opts))[0]).toBe('XiaomiMiMo/MiMo-V2.6-Flash');
  });
});
