import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config/defaults';
import type { LlmProvider } from '../src/shared/config/types';
import { validateConfig } from '../src/shared/config/validate';
import { OPEN_PRESETS, WIZARD_STEPS, buildProvider, capabilityWarnings, emptyProgress, needsSdk, parseProgress, parseRemote, recommendModel, recommendRoles, uniqueId, visibleSteps } from '../src/shared/wizard';

describe('wizard steps', () => {
  it('shows the SDK step only when a provider runs on the SDK engine', () => {
    const c = neutralConfig();
    expect(needsSdk(c)).toBe(true);
    expect(visibleSteps(c)).toEqual([...WIZARD_STEPS]);
    const open = buildProvider({ kind: 'openai-compatible', preset: 'ollama', baseUrl: OPEN_PRESETS[4].baseUrl, options: {}, model: 'qwen3:8b' }, [], false);
    const only = { ...c, llm: { ...c.llm, providers: [open] } };
    expect(needsSdk(only)).toBe(false);
    expect(visibleSteps(only)).not.toContain('sdk');
    expect(visibleSteps(only)).toHaveLength(WIZARD_STEPS.length - 1);
  });

  it('reads a stored progress defensively', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    expect(parseProgress(null, now)).toEqual(emptyProgress(now));
    expect(parseProgress({ step: 'nope', done: ['models', 'x'], skipped: 5 }, now)).toMatchObject({ step: 'language', done: ['models'], skipped: [] });
    expect(parseProgress({ step: 'docs', done: ['language', 'models'], skipped: ['sdk'], updatedAt: 'then' }, now)).toEqual({ step: 'docs', done: ['language', 'models'], skipped: ['sdk'], updatedAt: 'then' });
  });
});

describe('providers', () => {
  it('builds a valid provider for every kind, with a reference and no secret value', () => {
    const base = { preset: 'custom' as const, baseUrl: '', options: {}, model: '' };
    const drafts = [
      { ...base, kind: 'anthropic' as const },
      { ...base, kind: 'bedrock' as const, options: { region: 'us-east-1', profile: ' ' } },
      { ...base, kind: 'vertex' as const, options: { project: 'p', region: 'global' } },
      { ...base, kind: 'foundry' as const, options: { resource: 'r' } },
      { ...base, kind: 'openai-compatible' as const, preset: 'openrouter' as const, baseUrl: 'https://openrouter.ai/api/v1/', model: 'x/y' },
    ];
    const providers: LlmProvider[] = [];
    for (const d of drafts) providers.push(buildProvider(d, providers.map((p) => p.id), d.kind !== 'vertex'));
    expect(providers.map((p) => p.id)).toEqual(['anthropic', 'bedrock', 'vertex', 'foundry', 'openrouter']);
    expect(providers.map((p) => p.engine)).toEqual(['claude-sdk', 'claude-sdk', 'claude-sdk', 'claude-sdk', 'open']);
    expect(providers[1].options).toEqual({ region: 'us-east-1' });
    expect(providers[2].secretRef).toBeNull();
    expect(providers[0].secretRef).toBe('llm.anthropic');
    expect(providers[4].baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(providers[4].models[0]).toBe('x/y');
    const config = { ...neutralConfig(), llm: { providers, roles: Object.fromEntries(Object.keys(neutralConfig().llm.roles).map((r) => [r, { provider: 'anthropic', model: 'haiku' }])) } };
    const checked = validateConfig(config);
    expect(checked.errors).toEqual([]);
    expect(JSON.stringify(config)).not.toMatch(/sk-/);
  });

  it('keeps ids unique', () => {
    expect(uniqueId('OpenAI', ['openai'])).toBe('openai-2');
    expect(uniqueId('openai', ['openai', 'openai-2'])).toBe('openai-3');
    expect(uniqueId('!!!', [])).toBe('item');
  });

  it('every preset points at a root URL, and local ones need no key', () => {
    for (const p of OPEN_PRESETS) if (p.id !== 'custom') expect(p.baseUrl).toMatch(/^https?:\/\//);
    expect(OPEN_PRESETS.find((p) => p.id === 'ollama')).toMatchObject({ baseUrl: 'http://localhost:11434/v1', local: true, keyRequired: false });
    expect(OPEN_PRESETS.find((p) => p.id === 'lmstudio')).toMatchObject({ baseUrl: 'http://localhost:1234/v1', local: true });
  });
});

describe('role recommendations', () => {
  it('picks light models for the frequent roles and a strong one for the deep role', () => {
    const p = { id: 'x', models: ['acme-large-v2', 'acme-mini', 'plain'] };
    expect(recommendModel(p, 'fast')).toBe('acme-mini');
    expect(recommendModel(p, 'cheap')).toBe('acme-mini');
    expect(recommendModel(p, 'strong')).toBe('acme-large-v2');
    expect(recommendModel({ models: [] }, 'fast')).toBeNull();
    expect(recommendModel({ models: ['only'] }, 'strong')).toBe('only');
  });

  it('uses the Claude aliases on Anthropic and assigns every role', () => {
    const c = neutralConfig();
    const r = recommendRoles(c.llm.providers);
    expect(r?.deep).toEqual({ provider: 'anthropic', model: 'sonnet' });
    expect(r?.turn.model).toBe('haiku');
    expect(r?.fix.model).toBe('haiku');
    expect(recommendRoles([])).toBeNull();
  });

  it('warns about what the probe found', () => {
    expect(capabilityWarnings(null)).toEqual(['untested']);
    expect(capabilityWarnings({ chat: true, tools: true, jsonSchema: true, streaming: true, reasoning: false, contextWindow: 32768 })).toEqual([]);
    expect(capabilityWarnings({ chat: true, tools: false, jsonSchema: false, streaming: true, reasoning: false, contextWindow: 8192 })).toEqual(['no-tools', 'small-context', 'no-json-schema']);
    expect(capabilityWarnings({ chat: true, tools: true, jsonSchema: true, streaming: true, reasoning: false, contextWindow: 4096 })).toEqual(['tiny-context']);
    expect(capabilityWarnings({ chat: true, tools: true, jsonSchema: true, streaming: true, reasoning: false, contextWindow: null })).toEqual([]);
  });
});

describe('parseRemote', () => {
  it('reads the three shapes a remote comes in', () => {
    expect(parseRemote('git@gitlab.example.com:group/sub/app.git')).toEqual({ host: 'gitlab.example.com', projectPath: 'group/sub/app', kind: 'gitlab' });
    expect(parseRemote('https://github.com/acme/tool.git')).toEqual({ host: 'github.com', projectPath: 'acme/tool', kind: 'github' });
    expect(parseRemote('https://user:pw@bitbucket.org/team/repo')).toEqual({ host: 'bitbucket.org', projectPath: 'team/repo', kind: 'bitbucket' });
    expect(parseRemote('ssh://git@git.corp.local:2222/a/b.git')).toMatchObject({ host: 'git.corp.local', projectPath: 'a/b', kind: 'gitlab' });
  });

  it('refuses what is not a remote', () => {
    expect(parseRemote('')).toBeNull();
    expect(parseRemote(null)).toBeNull();
    expect(parseRemote('/some/local/path')).toBeNull();
    expect(parseRemote('https://github.com/')).toBeNull();
  });
});
