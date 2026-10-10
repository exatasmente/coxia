import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { LlmProvider, ModelRef, WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage, t } from '../src/shared/i18n';
import { effortSetting, obsoleteIn, withEffort, withFeatures, withMark, withPresetFeatures, withRoleOffer } from '../src/renderer/src/wizard/poolEdit';

// What the provider offers, as the person sees and changes it: the server features of a provider, the effort per activity, the marks and the obsolete warning of a
// model. Static renders, like the other screens of the wizard; the clicks are the pure edits tested below.

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { PoolEditor } = await import('../src/renderer/src/wizard/PoolEditor');
const { EffortFields, ProviderFeaturesBox } = await import('../src/renderer/src/wizard/ProviderFeatures');
const { ModelsStep } = await import('../src/renderer/src/wizard/steps/ModelsStep');

afterEach(() => setLanguage('pt-BR'));

const ref = (model: string, extra: Partial<ModelRef> = {}): ModelRef => ({ provider: 'p1', model, ...extra });
const provider = (id: string, baseUrl = 'https://example.com/v1', extra: Partial<LlmProvider> = {}): LlmProvider => ({ id, kind: 'openai-compatible', engine: 'open', baseUrl, options: {}, secretRef: null, envFile: null, models: ['model-a'], capabilities: null, structured: 'auto', headers: {}, maxOutputTokens: null, temperature: null, timeoutMs: null, legacyCustomEndpoint: false, ...extra });
const config = (p: LlmProvider = provider('p1')): WorkspaceConfig => {
  const c = neutralConfig();
  c.llm.providers = [p];
  for (const r of Object.keys(c.llm.roles) as (keyof typeof c.llm.roles)[]) c.llm.roles[r] = { provider: p.id, model: 'own' };
  return c;
};
const DEEPINFRA = 'https://api.deepinfra.com/v1/openai';
const ON = { serviceTier: true, failFast: true, reasoningEffort: true };

describe('the pure edits', () => {
  it('turns a feature on and off, keeps only what is on, and leaves no empty block', () => {
    const c = config();
    const on = withFeatures(c, 'p1', { serviceTier: true, catalogUrl: ' https://example.com/models/list ' });
    expect(on.llm.providers[0].features).toEqual({ serviceTier: true, catalogUrl: 'https://example.com/models/list' });
    const off = withFeatures(withFeatures(on, 'p1', { serviceTier: false }), 'p1', { catalogUrl: '  ' });
    expect(off.llm.providers[0]).not.toHaveProperty('features');
    // the configuration it was given is not touched
    expect(c.llm.providers[0]).not.toHaveProperty('features');
  });

  it('uses the preset\'s features only for a provider at the preset\'s address, and only when asked', () => {
    const di = config(provider('di', DEEPINFRA));
    expect(di.llm.providers[0]).not.toHaveProperty('features');
    expect(withPresetFeatures(di, 'di').llm.providers[0].features).toMatchObject({ ...ON, catalogUrl: 'https://api.deepinfra.com/models/list' });
    const other = config();
    expect(withPresetFeatures(other, 'p1')).toBe(other);
    expect(withPresetFeatures(other, 'gone')).toBe(other);
    // a choice the person already made is replaced by the preset's, as the button says
    const mine = withFeatures(di, 'di', { failFast: true });
    expect(withPresetFeatures(mine, 'di').llm.providers[0].features).toMatchObject(ON);
  });

  it('shows the proposal for an activity and writes only what differs from it', () => {
    const c = config();
    expect(['explore', 'edit', 'shell', 'screen', 'write'].map((a) => effortSetting(c, a as never))).toEqual(['low', 'medium', 'low', 'default', 'default']);
    const high = withEffort(c, 'shell', 'high');
    expect(high.llm.effort).toEqual({ shell: 'high' });
    expect(effortSetting(high, 'shell')).toBe('high');
    // back to the proposal: nothing left in the file
    expect(withEffort(high, 'shell', 'low').llm).not.toHaveProperty('effort');
    // "the model's own" where there is a proposal has to be written; where there is none it is the proposal
    expect(withEffort(c, 'explore', 'default').llm.effort).toEqual({ explore: 'default' });
    expect(withEffort(c, 'write', 'default').llm).not.toHaveProperty('effort');
    expect(withEffort(c, 'write', 'none').llm.effort).toEqual({ write: 'none' });
  });

  it('sets and clears a mark by hand, leaving no empty offer, and keeps the retirement', () => {
    const r = ref('model-a', { offer: { deprecated: 1790000000 } });
    const marked = withMark(r, 'flex', true);
    expect(marked.offer).toEqual({ deprecated: 1790000000, flex: true });
    expect(withMark(withMark(marked, 'flex', false), 'effort', false).offer).toEqual({ deprecated: 1790000000 });
    expect(withMark(ref('model-a', { offer: { flex: true } }), 'flex', false)).toEqual(ref('model-a'));
    expect(r.offer).toEqual({ deprecated: 1790000000 });
  });

  it('lists the obsolete models the draft uses, once each, with the substitute', () => {
    const c = config();
    c.llm.roles.deep = { provider: 'p1', model: 'own', offer: { deprecated: 1790000000, replacedBy: 'model-b' }, fallbacks: [ref('model-c', { offer: { deprecated: 2000000000 } }), ref('own', { offer: { deprecated: 1790000000, replacedBy: 'model-b' } })], activities: { edit: [ref('model-c', { offer: { deprecated: 2000000000 } })] } };
    expect(obsoleteIn(c, 'p1')).toEqual([
      { where: 'p1 · own', model: 'own', at: 1790000000, replacedBy: 'model-b' },
      { where: 'p1 · model-c', model: 'model-c', at: 2000000000, replacedBy: null },
    ]);
    expect(obsoleteIn(c, 'p2')).toEqual([]);
    expect(withRoleOffer(c, 'deep', undefined).llm.roles.deep).not.toHaveProperty('offer');
    expect(withRoleOffer(c, 'deep', { flex: true }).llm.roles.deep).toMatchObject({ offer: { flex: true }, fallbacks: expect.any(Array) });
  });
});

describe('the server features of a provider', () => {
  const box = (p: LlmProvider, c: WorkspaceConfig = config(p)) => renderToStaticMarkup(createElement(ProviderFeaturesBox, { provider: p, cfg: c, setCfg: () => undefined }));

  it('shows the three switches off for a provider without them, and the address field empty', () => {
    setLanguage('en');
    const out = box(provider('p1'));
    expect(out).toContain('Server features');
    for (const label of ['Flex tier on the stages', 'Refuse at once when a model is busy', 'Reasoning effort per activity']) expect(out).toContain(label);
    expect(out).not.toContain('checked=""');
    expect(out).not.toContain('Use the preset');
  });

  it('shows the ones that are on, and offers the preset\'s only to a provider at the preset\'s address', () => {
    setLanguage('en');
    const di = provider('di', DEEPINFRA, { features: { serviceTier: true, catalogUrl: 'https://api.deepinfra.com/models/list' } });
    const out = box(di);
    expect((out.match(/checked=""/g) ?? [])).toHaveLength(1);
    expect(out).toContain('value="https://api.deepinfra.com/models/list"');
    expect(out).toContain('Use the preset&#x27;s');
  });

  it('says what is wrong with an address that is not the provider\'s own origin, in both languages', () => {
    setLanguage('en');
    const bad = provider('p1', 'https://example.com/v1', { features: { catalogUrl: 'https://elsewhere.example.net/models/list' } });
    expect(box(bad)).toContain('same origin');
    setLanguage('pt-BR');
    expect(box(bad)).toContain('mesma origem');
    expect(box(provider('p1', 'https://example.com/v1', { features: { catalogUrl: 'ftp://example.com/x' } }))).toContain('http://');
  });

  it('is on the card of an open-engine provider in the models step and not on a Claude one', () => {
    setLanguage('en');
    const props = (cfg: WorkspaceConfig) => ({ cfg, setCfg: () => undefined, view: { secrets: [], storage: {} }, refreshView: async () => ({}), reload: async () => undefined, avail: null, goTo: () => undefined });
    const open = renderToStaticMarkup(createElement(ModelsStep, props(config()) as never));
    expect(open).toContain('Server features');
    expect(open).toContain('Reasoning effort');
    const sdk = config(provider('c1', 'https://api.anthropic.com', { kind: 'anthropic', engine: 'claude-sdk' }));
    expect(renderToStaticMarkup(createElement(ModelsStep, props(sdk) as never))).not.toContain('Server features');
  });
});

describe('the effort per activity', () => {
  const fields = (c: WorkspaceConfig) => renderToStaticMarkup(createElement(EffortFields, { cfg: c, setCfg: () => undefined }));

  it('has one selector per activity, showing the proposal when the file says nothing', () => {
    setLanguage('en');
    const out = fields(config());
    expect((out.match(/<select/g) ?? [])).toHaveLength(5);
    expect(out).toContain('Effort for Reading and searching');
    const selected = (id: string) => out.match(new RegExp(`id="effort-${id}"[^>]*>(?:<option[^>]*>[^<]*</option>)*`))?.[0].match(/<option value="(\w+)" selected/)?.[1];
    expect(['explore', 'edit', 'shell', 'screen', 'write'].map(selected)).toEqual(['low', 'medium', 'low', 'default', 'default']);
  });

  it('shows what the workspace chose, in Portuguese too', () => {
    setLanguage('pt-BR');
    const c = withEffort(config(), 'write', 'high');
    const out = fields(c);
    expect(out).toContain('Esforço de raciocínio');
    expect(out).toContain('Do modelo');
    expect(out).toMatch(/id="effort-write"[^>]*>(?:<option[^>]*>[^<]*<\/option>)*/);
  });
});

describe('the marks and the warning on the rows of a pool', () => {
  const providers = [provider('p1', 'https://example.com/v1', { features: ON })];
  const html = (value: object, extra: object = {}) => renderToStaticMarkup(createElement(PoolEditor, { providers, primary: ref('own'), value, onChange: () => undefined, ...extra }));

  it('shows the flex and effort marks on the row, pressed where the catalog said so, as buttons the person can press', () => {
    setLanguage('en');
    const out = html({ fallbacks: [ref('model-a', { offer: { flex: true } })] });
    expect(out).toMatch(/aria-label="p1 · model-a: served in the flex tier"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="p1 · model-a: served in the flex tier"/);
    expect(out).toMatch(/aria-pressed="false"[^>]*aria-label="p1 · model-a: takes the reasoning effort"|aria-label="p1 · model-a: takes the reasoning effort"[^>]*aria-pressed="false"/);
    expect(out).toContain('>flex<');
    expect(out).toContain('>effort<');
  });

  it('shows the marks of the role\'s own model, edited only when it is given a way to', () => {
    setLanguage('en');
    const own = { primary: ref('own', { offer: { effort: true } }) };
    expect(html({}, own)).toMatch(/<button[^>]*aria-pressed="true"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-pressed="true"/);
    expect(html({}, { ...own, onPrimary: () => undefined })).not.toMatch(/<button[^>]*wz-chip-btn[^>]*disabled=""/);
  });

  it('shows no mark for a feature the provider does not have', () => {
    setLanguage('en');
    const bare = [provider('p1')];
    const out = renderToStaticMarkup(createElement(PoolEditor, { providers: bare, primary: ref('own'), value: { fallbacks: [ref('model-a', { offer: { flex: true, effort: true } })] }, onChange: () => undefined }));
    expect(out).not.toContain('>flex<');
    expect(out).not.toContain('>effort<');
  });

  it('warns that a model is obsolete, with the date and the substitute, for a date past and one to come; only a warning', () => {
    setLanguage('en');
    const past = html({ fallbacks: [ref('model-a', { offer: { deprecated: 1790000000, replacedBy: 'model-b' } })] });
    expect(past).toMatch(/obsolete since [^;]+; substitute: model-b/);
    const later = html({ fallbacks: [ref('model-a', { offer: { deprecated: 4000000000 } })] });
    expect(later).toMatch(/obsolete from [^<;]+</);
    expect(later).not.toContain('substitute');
    setLanguage('pt-BR');
    expect(html({ fallbacks: [ref('model-a', { offer: { deprecated: 1790000000, replacedBy: 'model-b' } })] })).toMatch(/obsoleto desde [^;]+; substituto: model-b/);
  });

  it('warns under the role in the models step when the role\'s own model is obsolete, and changes nothing', () => {
    setLanguage('en');
    const cfg = config();
    cfg.llm.roles.deep = { provider: 'p1', model: 'own', offer: { deprecated: 1790000000, replacedBy: 'model-b' } };
    const props = { cfg, setCfg: () => undefined, view: { secrets: [], storage: {} }, refreshView: async () => ({}), reload: async () => undefined, avail: null, goTo: () => undefined };
    const out = renderToStaticMarkup(createElement(ModelsStep, props as never));
    expect(out).toContain('The provider marks models you use as obsolete. Nothing is changed for you.');
    expect(cfg.llm.roles.deep.model).toBe('own');
  });
});
