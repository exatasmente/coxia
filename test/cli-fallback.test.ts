// The budget fallback on the signed-in Claude Code CLI, the pure parts: who may fall back and where, the single retry, the reset time of the CLI's limit, the
// environment that leaves only the CLI's login, the subscription use, the validation note and the phone's refusal. Fakes only; nothing of ~/.claude.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fallbackTarget, resetMs, withBudgetFallback, type FallbackDeps } from '../src/main/cliFallback';
import type { ResolvedRole } from '../src/main/config-resolve';
import { EngineBusyError, MaxTurnsError, ProviderBudgetError, budgetResetText, type Run } from '../src/main/engine/contract';
import { sdkEnv } from '../src/main/llm-core';
import { dueForProbe } from '../src/main/runner/budget';
import { webAccess } from '../src/main/webPolicy';
import { neutralConfig } from '../src/shared/config';
import { fallbackListed, isSignedIn, signedInProvider } from '../src/shared/config/signedIn';
import type { LlmConfig, LlmProvider } from '../src/shared/config/types';
import { validateConfig } from '../src/shared/config/validate';
import { addReport, emptyUsage, mergeUsage } from '../src/shared/runs/usage';
import { usageParams } from '../src/shared/runs/view';

const keyed = (): LlmProvider => ({ ...neutralConfig().llm.providers[0], id: 'paid' });
const keyless = (over: Partial<LlmProvider> = {}): LlmProvider => ({ ...keyed(), id: 'cli', secretRef: null, models: ['sonnet', 'opus'], ...over });
const llm = (over: Partial<LlmConfig> = {}): Pick<LlmConfig, 'providers' | 'cliFallback'> => ({ providers: [keyed(), keyless()], cliFallback: { enabled: true, agents: ['deep', 'developer'] }, ...over });
const base = { test: false, agentId: 'developer', refused: 'paid', model: 'opus' };

describe('the signed-in Claude Code CLI', () => {
  it('is an anthropic provider on the SDK with no key and no custom endpoint', () => {
    expect(isSignedIn(keyless())).toBe(true);
    expect(isSignedIn(keyed())).toBe(false);
    expect(isSignedIn(keyless({ engine: 'open' }))).toBe(false);
    expect(isSignedIn(keyless({ legacyCustomEndpoint: true }))).toBe(false);
    expect(isSignedIn(keyless({ kind: 'bedrock' }))).toBe(false);
    expect(signedInProvider({ providers: [keyed()] })).toBeNull();
    expect(signedInProvider({ providers: [keyed(), keyless()] })?.id).toBe('cli');
  });

  it('is named in validation as a note that the CLI login is used, never an error and never a missing key', () => {
    const c = neutralConfig();
    c.llm.providers = [keyless({ id: c.llm.providers[0].id })];
    const r = validateConfig(c);
    expect(r.ok).toBe(true);
    const note = r.warnings.find((w) => w.path.endsWith('secretRef'));
    expect(note?.message).toMatch(/signed-in Claude Code CLI/);
    expect(note?.message).not.toMatch(/no API key/);
  });

  it('warns, without failing, about an unknown agent in the list and a fallback with no keyless provider', () => {
    const c = neutralConfig();
    c.llm.cliFallback = { enabled: true, agents: ['deep', 'nobody'] };
    const r = validateConfig(c);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['llm.cliFallback.agents[1]', 'llm.cliFallback']));
    expect(r.warnings.map((w) => w.path)).not.toContain('llm.cliFallback.agents[0]');
  });
});

describe('where a refusal for budget goes', () => {
  it('to the keyless provider, with the same model when it lists it and its first otherwise', () => {
    expect(fallbackTarget({ ...base, llm: llm() })).toEqual({ provider: 'cli', model: 'opus' });
    expect(fallbackTarget({ ...base, llm: llm(), model: 'deepseek' })).toEqual({ provider: 'cli', model: 'sonnet' });
  });

  it('nowhere when the fallback is off or absent, the agent is not listed, the workspace is a test one, or no keyless provider exists', () => {
    expect(fallbackTarget({ ...base, llm: llm({ cliFallback: { enabled: false, agents: ['developer'] } }) })).toBeNull();
    expect(fallbackTarget({ ...base, llm: llm({ cliFallback: undefined }) })).toBeNull();
    expect(fallbackTarget({ ...base, llm: llm(), agentId: 'reviewer' })).toBeNull();
    expect(fallbackTarget({ ...base, llm: llm(), test: true })).toBeNull();
    expect(fallbackTarget({ ...base, llm: llm({ providers: [keyed()] }) })).toBeNull();
    expect(fallbackListed({ cliFallback: { enabled: false, agents: ['developer'] } }, 'developer')).toBe(false);
  });

  it('nowhere when the refusal came from the fallback itself, or a session of the open engine is continued', () => {
    expect(fallbackTarget({ ...base, llm: llm(), refused: 'cli' })).toBeNull();
    expect(fallbackTarget({ ...base, llm: llm(), resumeEngine: 'open' })).toBeNull();
    expect(fallbackTarget({ ...base, llm: llm(), resumeEngine: 'claude-sdk' })).toEqual({ provider: 'cli', model: 'opus' });
  });
});

describe('the single retry', () => {
  const primary = { providerId: 'paid', model: 'opus', role: 'deep', modelRole: 'deep', engine: 'claude-sdk' } as ResolvedRole;
  const deps = (over: Partial<FallbackDeps> = {}): FallbackDeps => ({ llm: () => llm(), test: () => false, resolve: (provider, model) => ({ ...primary, providerId: provider, model }), ...over });
  const ok: Run<string> = { data: 'done', sessionId: 's', sources: [] };
  const refusal = new ProviderBudgetError('paid', 'claude-sdk', 'Key limit exceeded');

  it('runs once more on the signed-in CLI, with only its login, and says so', async () => {
    const retry = vi.fn(async (_t: ResolvedRole) => ok);
    const told: string[] = [];
    const r = await withBudgetFallback({ agentId: 'developer', primary, onFallback: (p) => told.push(p) }, () => Promise.reject(refusal), retry, deps());
    expect(r.data).toBe('done');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0]).toMatchObject({ providerId: 'cli', model: 'opus', loginOnly: true });
    expect(told).toEqual(['cli']);
  });

  it('waits as today for an agent not listed, in a test workspace, or on any failure that is not a budget refusal', async () => {
    const retry = vi.fn(async () => ok);
    await expect(withBudgetFallback({ agentId: 'reviewer', primary }, () => Promise.reject(refusal), retry, deps())).rejects.toBe(refusal);
    await expect(withBudgetFallback({ agentId: 'developer', primary }, () => Promise.reject(refusal), retry, deps({ test: () => true }))).rejects.toBe(refusal);
    const busy = new EngineBusyError('agent failed: overloaded', 'overloaded', false);
    await expect(withBudgetFallback({ agentId: 'developer', primary }, () => Promise.reject(busy), retry, deps())).rejects.toBe(busy);
    const turns = new MaxTurnsError('s', []);
    await expect(withBudgetFallback({ agentId: 'developer', primary }, () => Promise.reject(turns), retry, deps())).rejects.toBe(turns);
    expect(retry).not.toHaveBeenCalled();
  });

  it('gives the fallback\'s own limit, with its reset time, and never a third call', async () => {
    const own = new ProviderBudgetError('cli', 'claude-sdk', 'five_hour', 1_900_000_000_000);
    const retry = vi.fn(async () => Promise.reject(own));
    await expect(withBudgetFallback({ agentId: 'developer', primary }, () => Promise.reject(refusal), retry, deps())).rejects.toBe(own);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the original refusal, with the reason beside it, when the CLI fails some other way (missing, signed out)', async () => {
    const retry = vi.fn(async () => Promise.reject(new Error('agent failed: Invalid API key · Please run /login')));
    const e = await withBudgetFallback({ agentId: 'developer', primary }, () => Promise.reject(refusal), retry, deps()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProviderBudgetError);
    expect((e as ProviderBudgetError).provider).toBe('paid');
    expect((e as ProviderBudgetError).detail).toContain('Key limit exceeded');
    expect((e as ProviderBudgetError).detail).toContain('Please run /login');
  });
});

describe('the reset time of the CLI\'s usage limit', () => {
  it('is read as seconds or milliseconds, and nothing when absent', () => {
    expect(resetMs(1_900_000_000)).toBe(1_900_000_000_000);
    expect(resetMs(1_900_000_000_000)).toBe(1_900_000_000_000);
    expect(resetMs(undefined)).toBeNull();
    expect(resetMs(0)).toBeNull();
    expect(resetMs('soon')).toBeNull();
  });

  it('keeps the sweep from asking before it, and is said in the waiting reason', () => {
    expect(dueForProbe({ engine: 'claude-sdk', reason: '', since: '' }, 0)).toBe(true);
    expect(dueForProbe({ engine: 'claude-sdk', reason: '', since: '', until: 2_000 }, 1_000)).toBe(false);
    expect(dueForProbe({ engine: 'claude-sdk', reason: '', since: '', until: 2_000 }, 2_000)).toBe(true);
    expect(budgetResetText(new Date(2030, 0, 1, 14, 30).getTime())).toMatch(/14:30|2:30/);
  });
});

describe('the environment of a call on the fallback', () => {
  const target = { kind: 'anthropic' as const, baseUrl: 'https://api.anthropic.com', options: {} };
  const env = { ANTHROPIC_API_KEY: 'from-the-shell', PATH: '/usr/bin' };

  it('has no API key, so only the CLI login can authenticate it', () => {
    const out = sdkEnv({ target, base: env, secret: null, profile: {}, vcsHost: null, loginOnly: true });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });

  it('is unchanged without the flag: a keyless provider still lets a key of the shell through, as before', () => {
    expect(sdkEnv({ target, base: env, secret: null, profile: {}, vcsHost: null }).ANTHROPIC_API_KEY).toBe('from-the-shell');
  });
});

describe('subscription use', () => {
  it('counts tokens and calls apart, and never a cost', () => {
    let u = addReport(emptyUsage(), { promptTokens: 100, completionTokens: 10, cachedTokens: 0, subscription: true });
    u = addReport(u, { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.5, subscription: true });
    expect(u).toMatchObject({ promptTokens: 100, completionTokens: 10, calls: 1, costUsd: null, subscriptionCalls: 1 });
    const merged = mergeUsage(u, addReport(emptyUsage(), { promptTokens: 5, completionTokens: 5, cachedTokens: 0, costUsd: 0.01 }));
    expect(merged).toMatchObject({ calls: 2, costUsd: 0.01, subscriptionCalls: 1 });
    expect(usageParams(u, 'en')).toMatchObject({ cost: null, subscription: '1' });
    expect(usageParams(emptyUsage(), 'en').subscription).toBeNull();
  });
});

describe('the configuration document', () => {
  it('describes the mode in both languages and no longer says a subscription login is never offered', () => {
    const doc = readFileSync(join(import.meta.dirname, '../docs/configuration.md'), 'utf8');
    expect(doc).not.toContain('Login de assinatura do claude.ai nunca é oferecido');
    expect(doc).not.toContain('A claude.ai subscription login is never offered');
    expect(doc).toContain('CLI do Claude Code já logado');
    expect(doc).toContain('signed-in Claude Code CLI');
    expect(doc).toContain('llm.cliFallback');
  });
});

describe('the paired phone', () => {
  it('is refused the channels that change the fallback (the config ones)', () => {
    for (const channel of ['config:save', 'config:import', 'config:secret']) expect(webAccess(channel)).toBe('deny');
  });
});
