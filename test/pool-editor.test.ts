import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { LlmProvider, ModelRef, WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage, t } from '../src/shared/i18n';
import type { CatalogModel } from '../src/shared/modelCatalog';
import { suggestPools } from '../src/shared/modelPools';
import {
  addEntry,
  applyCatalogOffer,
  applySuggestion,
  entryFacts,
  listOf,
  moveEntry,
  poolListCount,
  removeEntry,
  rolesOnProvider,
  withFloor,
  withList,
  withModelFacts,
  withModelScore,
  withOverrides,
  withProbed,
  withRolePool,
  withoutLead,
} from '../src/renderer/src/wizard/poolEdit';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { PoolEditor } = await import('../src/renderer/src/wizard/PoolEditor');
const { SuggestedPool } = await import('../src/renderer/src/wizard/SuggestedPool');
const { ModelsStep } = await import('../src/renderer/src/wizard/steps/ModelsStep');

afterEach(() => setLanguage('pt-BR'));

const ref = (model: string, provider = 'p1'): ModelRef => ({ provider, model });
const models = (...ids: string[]) => ids.map((m) => ref(m));
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
const provider = (id: string, list: string[] = []): LlmProvider => ({ id, kind: 'openai-compatible', engine: 'open', baseUrl: 'https://example.com/v1', options: {}, secretRef: null, envFile: null, models: list, capabilities: null, structured: 'auto', headers: {}, maxOutputTokens: null, temperature: null, timeoutMs: null, legacyCustomEndpoint: false });
const withProviders = (...ids: string[]): WorkspaceConfig => {
  const c = neutralConfig();
  c.llm.providers = ids.map((id) => provider(id, ['model-a']));
  for (const r of Object.keys(c.llm.roles) as (keyof typeof c.llm.roles)[]) c.llm.roles[r] = { provider: ids[0], model: 'own' };
  return c;
};

describe('the edits of a pool list', () => {
  it('moves an entry one place, and leaves the list alone at the ends', () => {
    const list = models('a', 'b', 'c');
    expect(moveEntry(list, 2, -1).map((r) => r.model)).toEqual(['a', 'c', 'b']);
    expect(moveEntry(list, 0, 1).map((r) => r.model)).toEqual(['b', 'a', 'c']);
    expect(moveEntry(list, 0, -1)).toBe(list);
    expect(moveEntry(list, 2, 1)).toBe(list);
    expect(list.map((r) => r.model)).toEqual(['a', 'b', 'c']);
  });

  it('removes an entry', () => {
    expect(removeEntry(models('a', 'b', 'c'), 1).map((r) => r.model)).toEqual(['a', 'c']);
  });

  it('adds an entry at the end, and says what is wrong when it cannot', () => {
    const providers = ['p1', 'p2'];
    expect(addEntry(models('a'), { provider: 'p2', model: ' b ' }, providers)).toEqual({ list: [ref('a'), ref('b', 'p2')] });
    expect(addEntry([], { provider: 'p1', model: '' }, providers)).toEqual({ problem: 'empty' });
    expect(addEntry([], { provider: 'p1', model: 'two words' }, providers)).toEqual({ problem: 'empty' });
    expect(addEntry([], { provider: 'gone', model: 'a' }, providers)).toEqual({ problem: 'provider' });
    expect(addEntry(models('a'), { provider: 'p1', model: 'a' }, providers)).toEqual({ problem: 'duplicate' });
    // The same name on another provider is another model.
    expect(addEntry(models('a'), { provider: 'p2', model: 'a' }, providers)).toEqual({ list: [ref('a'), ref('a', 'p2')] });
    // The role's own model is not a reserve.
    expect(addEntry([], { provider: 'p1', model: 'own' }, providers, ref('own'))).toEqual({ problem: 'duplicate' });
    expect(addEntry(models('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), { provider: 'p1', model: 'i' }, providers)).toEqual({ problem: 'max' });
  });

  it('keeps a pool without an empty list: the field leaves it', () => {
    const pool = withList({}, 'fallbacks', models('a'));
    expect(pool).toEqual({ fallbacks: [ref('a')] });
    expect(withList(pool, 'fallbacks', [])).toEqual({});
    const byActivity = withList(pool, 'shell', models('s'));
    expect(listOf(byActivity, 'shell')).toEqual([ref('s')]);
    expect(withList(byActivity, 'shell', [])).toEqual({ fallbacks: [ref('a')] });
    expect(poolListCount(byActivity)).toBe(2);
  });

  it('drops the reserve that became the role\'s own model', () => {
    expect(withoutLead({ fallbacks: models('a', 'own') }, ref('own'))).toEqual({ fallbacks: [ref('a')] });
    expect(withoutLead({ fallbacks: models('own') }, ref('own'))).toEqual({});
  });
});

describe('using the suggestion changes only the draft', () => {
  const catalog = [model('model-a', 0.3), model('model-b', 0.2), model('own', 0.5)];

  it('puts the suggested pools on the roles of the provider, and leaves the other roles and the original untouched', () => {
    const cfg = withProviders('p1', 'p2');
    cfg.llm.roles.fix = { provider: 'p2', model: 'other', fallbacks: models('keep', 'me') };
    const before = JSON.stringify(cfg);
    const suggestion = suggestPools(catalog, { provider: 'p1', roles: rolesOnProvider(cfg, 'p1') });
    const next = applySuggestion(cfg, suggestion);
    // The cheapest becomes the role's model; the model of today stays in the pool, at its place by cost.
    expect(next.llm.roles.turn.model).toBe('model-b');
    expect(next.llm.roles.turn.provider).toBe('p1');
    expect(next.llm.roles.turn.fallbacks?.map((r) => r.model)).toEqual(['model-a', 'own']);
    expect(next.llm.roles.fix).toEqual({ provider: 'p2', model: 'other', fallbacks: models('keep', 'me') });
    // A new object: the config the screen was drawn from is not edited, so nothing is saved by this call.
    expect(JSON.stringify(cfg)).toBe(before);
    expect(next).not.toBe(cfg);
  });

  it('replaces the pool a role had', () => {
    const cfg = withProviders('p1');
    cfg.llm.roles.turn = { provider: 'p1', model: 'own', fallbacks: models('old'), activities: { shell: models('old-shell') } };
    const next = applySuggestion(cfg, suggestPools(catalog, { provider: 'p1', roles: rolesOnProvider(cfg, 'p1') }));
    expect(next.llm.roles.turn.model).toBe('model-b');
    expect(next.llm.roles.turn.fallbacks?.map((r) => r.model)).toEqual(['model-a', 'own']);
    expect(next.llm.roles.turn.activities).toBeUndefined();
  });

  it('finds the roles whose model is on the provider', () => {
    const cfg = withProviders('p1', 'p2');
    cfg.llm.roles.deep = { provider: 'p2', model: 'x' };
    expect(Object.keys(rolesOnProvider(cfg, 'p1')).sort()).toEqual(['fix', 'reply', 'teams', 'turn']);
    expect(rolesOnProvider(cfg, 'p2')).toEqual({ deep: ref('x', 'p2') });
  });

  it('sets the pool of one role and keeps its own model and facts', () => {
    const cfg = withProviders('p1');
    cfg.llm.roles.turn = { provider: 'p1', model: 'own', images: true, fallbacks: models('old') };
    const next = withRolePool(cfg, 'turn', { fallbacks: models('new') });
    expect(next.llm.roles.turn).toEqual({ provider: 'p1', model: 'own', images: true, fallbacks: [ref('new')] });
    expect(withRolePool(next, 'turn', {}).llm.roles.turn).toEqual({ provider: 'p1', model: 'own', images: true });
  });
});

describe('floors and scores the person sets', () => {
  it('writes a floor and takes it back to the table\'s', () => {
    const o = withFloor(undefined, 'shell', 90);
    expect(o).toEqual({ floors: { shell: 90 } });
    expect(withFloor(o, 'shell', null)).toBeUndefined();
    expect(withFloor(o, 'shell', 140)).toBe(o);
  });

  it('writes the score of a model under its normalized id, and clears it', () => {
    const o = withModelScore(undefined, 'Org/Model-A:free', 'edit', 70);
    expect(o).toEqual({ models: { 'model-a': { edit: 70 } } });
    expect(withModelScore(o, 'model-a', 'shell', 80)).toEqual({ models: { 'model-a': { edit: 70, shell: 80 } } });
    expect(withModelScore(o, 'model-a', 'edit', null)).toBeUndefined();
    expect(withModelScore(o, 'model-a', 'edit', -1)).toBe(o);
  });

  it('puts the overrides on the config, and takes the field off when there are none', () => {
    const cfg = withProviders('p1');
    const on = withOverrides(cfg, { floors: { edit: 70 } });
    expect(on.llm.scoreOverrides).toEqual({ floors: { edit: 70 } });
    expect('scoreOverrides' in withOverrides(on, undefined).llm).toBe(false);
  });
});

describe('what a test of one model writes into the draft', () => {
  it('marks every entry of that model, the role\'s own included', () => {
    const cfg = withProviders('p1', 'p2');
    cfg.llm.roles.turn = { provider: 'p1', model: 'own', fallbacks: [ref('m'), ref('m', 'p2')], activities: { screen: [ref('m')] } };
    const next = withModelFacts(cfg, 'p1', 'm', { images: true, contextWindow: 64000, reasoning: true });
    expect(next.llm.roles.turn.fallbacks).toEqual([{ provider: 'p1', model: 'm', images: true, contextWindow: 64000, echoReasoning: true }, ref('m', 'p2')]);
    expect(next.llm.roles.turn.activities?.screen).toEqual([{ provider: 'p1', model: 'm', images: true, contextWindow: 64000, echoReasoning: true }]);
    expect(withModelFacts(cfg, 'p1', 'own', { images: false }).llm.roles.turn).toMatchObject({ model: 'own', images: false });
    expect(cfg.llm.roles.turn.fallbacks?.[0]).toEqual(ref('m'));
  });

  it('writes the probe\'s findings over the listing entry of the tested model only', () => {
    const catalog = [model('a', 0.1, { tools: null, structured: null }), model('b', 0.1, { tools: null })];
    const probed = [model('a', 0.1, { tools: true, structured: false, vision: true }), model('b', 0.1)];
    const next = withProbed(catalog, probed, 'a');
    expect(next[0]).toMatchObject({ tools: true, structured: false, vision: true });
    expect(next[1]).toBe(catalog[1]);
    expect(withProbed(catalog, probed, 'zzz')).toBe(catalog);
  });

  it('reads the facts of an entry: cost from the listing, the window from the entry first, scores for the list\'s activity', () => {
    const catalog = [model('model-a', 0.3, { tools: null })];
    const o = { models: { 'model-a': { shell: 91, edit: 71 } } };
    const f = entryFacts({ ...ref('model-a'), contextWindow: 50000 }, catalog, 'shell', o);
    expect(f.cost).toBeCloseTo(2.05 * 0.3 + 0.06 * 0.3 + 0.0157 * 0.6, 9);
    expect(f.contextWindow).toBe(50000);
    expect(f.scores.map((s) => [s.activity, s.found.score])).toEqual([['shell', 91]]);
    expect(f.unverified).toEqual(['tools']);
    expect(entryFacts(ref('model-a'), catalog, 'fallbacks', o).scores.map((s) => s.activity)).toEqual(['shell', 'edit']);
    expect(entryFacts(ref('other'), undefined, 'write')).toEqual({ cost: null, contextWindow: null, scores: [], unverified: [] });
  });
});

describe('the editor as the person sees it', () => {
  const providers = [provider('p1', ['model-a', 'model-b']), provider('p2')];
  const html = (value: object, extra: object = {}) => renderToStaticMarkup(createElement(PoolEditor, { providers, primary: ref('own'), value, onChange: () => undefined, ...extra }));

  it('shows the role\'s model first, the reserves in order and an empty list for every kind of work', () => {
    setLanguage('en');
    const out = html({ fallbacks: models('model-a', 'model-b') });
    expect(out.indexOf('p1 · own')).toBeGreaterThan(-1);
    expect(out.indexOf('p1 · own')).toBeLessThan(out.indexOf('p1 · model-a'));
    expect(out.indexOf('p1 · model-a')).toBeLessThan(out.indexOf('p1 · model-b'));
    for (const a of ['Reading and searching', 'Writing and editing code', 'Command output', 'Virtual screen', 'Start of a stage and documents']) expect(out).toContain(a);
    expect(out).toContain('Move p1 · model-a down');
    expect(out).toMatch(/aria-label="Move p1 · model-a up"[^>]*disabled/);
    expect(out).toContain('Reserve models');
  });

  it('shows the price, the context and the score with its source and "self-reported" or "third-party"', () => {
    setLanguage('en');
    const catalogs = { p1: [model('deepseek-ai/DeepSeek-V4.1-Flash', 0.3), model('zai-org/GLM-5.3-Flash', 0.1, { tools: null })] };
    const out = html({ fallbacks: models('deepseek-ai/DeepSeek-V4.1-Flash', 'zai-org/GLM-5.3-Flash') }, { catalogs });
    expect(out).toContain('about $0.642 per stage');
    expect(out).toContain('128,000 tokens of context');
    expect(out).toContain('Command output: 90.6 (Terminal-Bench 2.1, self-reported)');
    expect(out).toContain('Writing and editing code: 74.2 (DeepSWE v1.1, self-reported)');
    expect(out).toContain('Command output: 84.3 (Terminal-Bench 2.1, third-party)');
    expect(out).toContain('tools unverified');
  });

  it('shows a score the person set as theirs, and renders in Portuguese', () => {
    setLanguage('pt-BR');
    const out = html({ fallbacks: models('model-a') }, { overrides: { models: { 'model-a': { shell: 77 } } } });
    expect(out).toContain('Saída de comando: 77 (definida por você)');
    expect(out).toContain('Modelos de reserva');
  });

  it('offers "Test this model" only when it is given a way to test', () => {
    setLanguage('en');
    expect(html({ fallbacks: models('model-a') })).not.toContain('Test this model');
    expect(html({ fallbacks: models('model-a') }, { onTest: () => undefined })).toContain('Test this model');
  });
});

describe('the suggestion panel', () => {
  const p1 = provider('p1', ['model-a']);
  const cfg = withProviders('p1');
  const panel = (catalog: CatalogModel[], c: WorkspaceConfig = cfg) =>
    renderToStaticMarkup(createElement(SuggestedPool, { provider: p1, catalog, cfg: c, setCfg: () => undefined, onTest: () => undefined, testing: null }));

  it('lists the models by the cost of a stage, with the floors and the button that only fills the draft', () => {
    setLanguage('en');
    const out = panel([model('model-a', 0.3), model('model-b', 0.2), model('small', 0.01, { contextWindow: 8000 })]);
    expect(out).toContain('Suggested pool');
    expect(out.indexOf('model-b')).toBeLessThan(out.indexOf('model-a'));
    expect(out).not.toContain('>small<');
    expect(out).toContain('Use the suggestion');
    expect(out).toContain('Nothing is saved until you save');
    expect(out).toContain('app&#x27;s table: 90');
    expect(out).toContain('Test this model');
  });

  it('puts the models that reach a floor first, with the score, its source and the vendor\'s own word', () => {
    setLanguage('en');
    const out = panel([model('XiaomiMiMo/MiMo-V2.6-Flash', 0.4, { vision: true }), model('plain', 0.1, { vision: true })]);
    const screen = out.slice(out.indexOf('aria-label="Virtual screen"'));
    expect(screen.indexOf('MiMo-V2.6-Flash')).toBeLessThan(screen.indexOf('plain'));
    expect(screen).toContain('Virtual screen: 80.8 (OSWorld-Verified, self-reported)');
  });

  it('says there is nothing to suggest from a listing without facts, and from one where nothing qualifies', () => {
    setLanguage('en');
    const bare: CatalogModel = { id: 'model-a', contextWindow: null, price: null, vision: null, tools: null, structured: null, reasoning: null, cache: null, effort: null, flex: null, deprecated: null, replacedBy: null };
    expect(panel([bare])).toContain('carries no price or capabilities');
    expect(panel([model('small', 0.1, { contextWindow: 4000 })])).toContain('No model in the listing qualifies');
  });

  it('cannot place the suggestion where no role uses the provider', () => {
    setLanguage('en');
    const other = withProviders('p2');
    const out = panel([model('model-a', 0.3)], other);
    expect(out).toContain('No role uses p1');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Use the suggestion/);
  });
});

describe('the models step', () => {
  const step = (cfg: WorkspaceConfig): string => {
    const props = { cfg, setCfg: () => undefined, view: { secrets: [], storage: {} }, refreshView: async () => ({}), reload: async () => undefined, avail: null, goTo: () => undefined };
    return renderToStaticMarkup(createElement(ModelsStep, props as never));
  };

  it('puts the reserve editor under every role, open for the role that has a pool, and with the saved reserves in it', () => {
    setLanguage('en');
    const cfg = withProviders('p1');
    cfg.llm.roles.deep = { provider: 'p1', model: 'own', fallbacks: models('model-b'), activities: { shell: models('model-a') } };
    const out = step(cfg);
    expect((out.match(/<summary>Reserve models \(\d\)<\/summary>/g) ?? [])).toHaveLength(5);
    expect(out).toContain('<summary>Reserve models (2)</summary>');
    expect(out).toContain('p1 · model-b');
    expect(out).toContain('p1 · model-a');
    // A workspace without pools shows the editors closed and empty: nothing there changes the role.
    const plain = step(withProviders('p1'));
    expect(plain).not.toContain('<details class="wz-details" open="">');
    expect(plain).toContain('No reserves: the model above is the only one.');
  });
});

describe('what the catalog says of the models, written on the draft', () => {
  const cat = (id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({ id, contextWindow: 64000, price: null, vision: null, tools: null, structured: null, reasoning: null, cache: null, effort: null, flex: null, deprecated: null, replacedBy: null, ...over });
  const config = (): WorkspaceConfig => {
    const c = withProviders('p1', 'p2');
    c.llm.roles.deep = { provider: 'p1', model: 'model-a', fallbacks: [ref('model-b'), ref('model-a', 'p2')], activities: { shell: [ref('model-b'), ref('model-c')] } };
    c.agents.team.push({ id: 'own', name: 'Own', job: '', model: { role: null, provider: 'p1', model: 'model-b', fallbacks: [ref('model-a')] }, stages: [], permission: 'read', tracker: 'none', shell: 'none', autonomous: false, turnsTo: null, instructions: '', system: false });
    return c;
  };
  const catalog = [cat('model-a', { flex: true, effort: true }), cat('model-b', { flex: false, effort: true, deprecated: 1790000000, replacedBy: 'model-c' })];

  it('writes the offer on every entry of that provider: the role\'s model, its reserves, the lists of an activity and the agents with a model of their own', () => {
    const next = applyCatalogOffer(config(), 'p1', catalog);
    const deep = next.llm.roles.deep;
    expect(deep.offer).toEqual({ flex: true, effort: true });
    expect(deep.fallbacks?.[0].offer).toEqual({ effort: true, deprecated: 1790000000, replacedBy: 'model-c' });
    expect(deep.activities?.shell?.[0].offer).toEqual({ effort: true, deprecated: 1790000000, replacedBy: 'model-c' });
    const own = next.agents.team.find((a) => a.id === 'own')!.model;
    expect(own.offer).toEqual({ effort: true, deprecated: 1790000000, replacedBy: 'model-c' });
    expect(own.fallbacks?.[0].offer).toEqual({ flex: true, effort: true });
  });

  it('leaves another provider\'s entries, a model the catalog does not know and an agent on a role alone, and never changes a model', () => {
    const before = config();
    const next = applyCatalogOffer(before, 'p1', catalog);
    expect(next.llm.roles.deep.fallbacks?.[1]).toEqual(ref('model-a', 'p2'));
    expect(next.llm.roles.deep.activities?.shell?.[1]).toEqual(ref('model-c'));
    expect(next.llm.roles.turn).toEqual(before.llm.roles.turn);
    expect(next.agents.team.find((a) => a.id === 'developer')).toEqual(before.agents.team.find((a) => a.id === 'developer'));
    expect(next.llm.roles.deep.model).toBe('model-a');
    expect(next.llm.roles.deep.fallbacks?.map((r) => r.model)).toEqual(['model-b', 'model-a']);
    // the configuration it was given is not touched
    expect(before.llm.roles.deep.offer).toBeUndefined();
  });

  it('a test writes it again: what the catalog no longer says leaves the entry, and a model with nothing to say has no offer', () => {
    const first = applyCatalogOffer(config(), 'p1', catalog);
    const again = applyCatalogOffer(first, 'p1', [cat('model-a'), cat('model-b')]);
    expect(again.llm.roles.deep).not.toHaveProperty('offer');
    expect(again.llm.roles.deep.fallbacks?.[0]).toEqual(ref('model-b'));
  });

  it('a model the standard listing no longer shows still gets its retirement from the richer one, and keeps what it had otherwise', () => {
    const c = config();
    c.llm.roles.deep.fallbacks = [{ ...ref('model-old'), offer: { flex: true } }];
    const next = applyCatalogOffer(c, 'p1', catalog, { 'model-old': { at: 1781217521, replacedBy: null } });
    expect(next.llm.roles.deep.fallbacks?.[0].offer).toEqual({ flex: true, deprecated: 1781217521 });
  });

  it('is what a suggestion starts with: an entry suggested from a listing with the offer carries it', () => {
    const s = suggestPools([cat('model-a', { tools: true, structured: true, flex: true, effort: true, price: { input: 0.1, output: 0.2, cacheRead: null } })], { provider: 'p1', roles: rolesOnProvider(config(), 'p1') });
    expect(s.write[0].ref.offer).toEqual({ flex: true, effort: true });
  });
});
