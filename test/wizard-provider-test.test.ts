import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { WIZARD_CHANNELS } from '../src/shared/wizard';
import { type Fake, type FakeRequest, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', getAppPath: () => '/nowhere' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {} }));

const { saveConfig, reloadConfig } = await import('../src/main/workspaceConfig');
const { wizard } = await import('../src/main/wizard');

// The test of a provider reads its richer listing (flex, retirement); the test of one more model of the pool does not.

const capable = (req: FakeRequest) => {
  if (req.body?.tools) return toolStep([{ name: 'echo', args: { text: 'ola' } }]);
  if (req.body?.response_format) return textStep('{"answer":"ok","n":1}');
  return textStep('ok');
};
const rich = [
  { model_name: 'fake-model', tags: ['flex', 'tools'], deprecated: null, replaced_by: null },
  { model_name: 'retired-model', tags: [], deprecated: 1781217521, replaced_by: 'fake-model' },
];

let fake: Fake | null = null;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

const withProvider = (f: Fake): WorkspaceConfig => {
  const c = neutralConfig();
  c.llm.providers = [{ id: 'p1', kind: 'openai-compatible', engine: 'open', baseUrl: f.url, options: {}, secretRef: null, envFile: null, models: ['fake-model'], capabilities: null, structured: 'auto', headers: {}, maxOutputTokens: null, temperature: null, timeoutMs: null, legacyCustomEndpoint: false, features: { catalogUrl: f.richUrl } }];
  for (const r of Object.keys(c.llm.roles) as (keyof typeof c.llm.roles)[]) c.llm.roles[r] = { provider: 'p1', model: 'fake-model' };
  return c;
};
const listingReads = (f: Fake): number => f.requests.filter((q) => q.url.endsWith('/models/list')).length;
const test = (...args: unknown[]) => handlers.get(WIZARD_CHANNELS.providerTest)!('p1', ...args) as Promise<{ ok: boolean; deprecations?: Record<string, unknown>; catalog: { id: string; flex?: boolean }[] }>;

beforeEach(async () => {
  fake = await fakeOpenAI(capable, { models: [{ id: 'fake-model' }], rich });
  saveConfig(withProvider(fake));
  wizard({ handle: (channel, fn) => handlers.set(channel, fn as never), notify: vi.fn(), emit: vi.fn(), job: vi.fn() });
});
afterEach(async () => {
  await fake?.close();
  fake = null;
  handlers.clear();
  reloadConfig();
});

describe('the provider test and the richer listing', () => {
  it('reads it when the provider card asks, even with a model named', async () => {
    const r = await test('fake-model', { rich: true });
    expect(r.ok).toBe(true);
    expect(listingReads(fake!)).toBe(1);
    expect(r.catalog[0]).toMatchObject({ id: 'fake-model', flex: true });
    expect(r.deprecations).toHaveProperty('retired-model');
  });

  it('does not read it for the test of one model', async () => {
    const r = await test('fake-model', { rich: false });
    expect(r.ok).toBe(true);
    expect(listingReads(fake!)).toBe(0);
    expect(r.deprecations).toBeUndefined();
  });

  it('keeps reading it when no model is named', async () => {
    await test();
    expect(listingReads(fake!)).toBe(1);
  });
});
