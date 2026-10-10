// The start of a call on a role with spares (#213): the first model of the list that is not resting opens the session, the Claude SDK included; a busy refusal of the
// SDK before any tool ran starts the call again on the next model, and after a tool ran it fails as it always did; a refusal by budget stays a wait on the provider that
// refused. The SDK is a stub that plays a script per call; no model, no network.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: string; options: Record<string, unknown> }[] = [];
let scripts: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    calls.push({ prompt, options });
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

import { askAgent, obj, runAgent, str } from '../src/main/agents';
import { activityLog } from '../src/main/activity';
import { ProviderBudgetError, ProviderBusyError, type PoolNotice } from '../src/main/engine/contract';
import { restRegistry } from '../src/main/engine/open/rest';
import { memberKey } from '../src/main/modelPick';
import { rc } from '../src/main/workspaceConfig';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');
const { updateConfig } = await import('../src/main/workspaceConfig');
updateConfig((c) => {
  c.llm.providers.push(newProvider({ id: 'sdk-a', kind: 'anthropic', baseUrl: 'https://a.example.com' }), newProvider({ id: 'sdk-b', kind: 'anthropic', baseUrl: 'https://b.example.com' }));
  return c;
});

const init = (id: string) => ({ type: 'system', subtype: 'init', session_id: id });
const says = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const uses = (name: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } });
const result = (subtype: string, id: string, structured?: unknown) => ({ type: 'result', subtype, session_id: id, ...(structured === undefined ? {} : { structured_output: structured }) });
const done = (id: string) => [init(id), result('success', id, { fala: 'ok' })];

const schema = obj({ fala: str });
const pooled = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'sdk-a', model: 'model-a', fallbacks: [{ provider: 'sdk-b', model: 'model-b' }] } });
const lone = newAgent({ id: 'lone', permission: 'read', model: { role: null, provider: 'sdk-a', model: 'model-a' } });
const asked = (agent = pooled, extra: Partial<Parameters<typeof runAgent>[0]> = {}) => {
  const notices: PoolNotice[] = [];
  const out = runAgent<{ fala: string }>({ agent, prompt: 'p', schema, system: 'sys', cwd: process.cwd(), label: agent.id, maxTurns: 3, onPool: (n) => notices.push(n), ...extra });
  return { out, notices };
};
const modelOf = (n: number) => calls[n].options.model;
const keyOf = (id: string) => memberKey(rc().agentModel(newAgent({ id: 'x', model: { role: null, provider: id, model: id === 'sdk-a' ? 'model-a' : 'model-b' } }).model));

beforeEach(() => {
  calls.length = 0;
  scripts = [];
  restRegistry.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the start of a call with spares', () => {
  it('opens on the first model and says nothing when it is free, and reports the engine that answered', async () => {
    scripts = [done('s1')];
    const { out, notices } = asked();
    const r = await out;
    expect(r.data).toEqual({ fala: 'ok' });
    expect(modelOf(0)).toBe('model-a');
    expect(notices).toEqual([]);
    expect(r.engine).toBe('claude-sdk');
  });

  it('skips a model that rests, opens on the next, and says so with the time the first is back', async () => {
    const back = restRegistry.rest(keyOf('sdk-a'), 120_000);
    scripts = [done('s1')];
    const { out, notices } = asked();
    await out;
    expect(calls).toHaveLength(1);
    expect(modelOf(0)).toBe('model-b');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ from: { label: 'model-a', provider: 'sdk-a' }, to: { label: 'model-b', provider: 'sdk-b' }, reason: 'resting', until: back, activity: 'write' });
  });

  it('opens on the model of the write list when the role has one for it, and keeps the whole pool for the engine', async () => {
    const agent = newAgent({ id: 'writer', permission: 'read', model: { role: null, provider: 'sdk-a', model: 'model-a', fallbacks: [{ provider: 'sdk-b', model: 'model-b' }], activities: { write: [{ provider: 'sdk-b', model: 'model-b' }] } } });
    scripts = [done('s1')];
    await asked(agent).out;
    expect(modelOf(0)).toBe('model-b');
  });

  it('fails naming the pool, touching no model, when every model of it rests', async () => {
    restRegistry.rest(keyOf('sdk-a'), 60_000);
    restRegistry.rest(keyOf('sdk-b'), 120_000);
    const error = await asked().out.catch((e) => e as Error);
    expect(error).toBeInstanceOf(ProviderBusyError);
    expect((error as ProviderBusyError).models).toEqual(['model-a', 'model-b']);
    expect((error as ProviderBusyError).until).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('is exactly the same as before for a role with one model, even when that model rests elsewhere', async () => {
    restRegistry.rest(keyOf('sdk-a'), 60_000);
    scripts = [done('s1')];
    const { out, notices } = asked(lone);
    const r = await out;
    expect(modelOf(0)).toBe('model-a');
    expect(notices).toEqual([]);
    expect(r.engine).toBe('claude-sdk');
  });
});

describe('a busy refusal of the SDK', () => {
  it('rests the model and starts again on the next when no tool ran, saying so', async () => {
    scripts = [[init('s1'), says('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), result('success', 's1')], done('s2')];
    const { out, notices } = asked();
    const r = await out;
    expect(r.data).toEqual({ fala: 'ok' });
    expect(calls.map((_, n) => modelOf(n))).toEqual(['model-a', 'model-b']);
    expect(restRegistry.resting(keyOf('sdk-a'))).toBe(true);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ from: { label: 'model-a' }, to: { label: 'model-b' }, reason: 'overloaded' });
    expect(notices[0].until).toBe(restRegistry.until(keyOf('sdk-a')));
  });

  it('reads a 429 as a rate limit and a 5xx as a server error', async () => {
    scripts = [[init('s1'), says('API Error: 429 rate_limit_error: slow down'), result('success', 's1')], done('s2')];
    const first = asked();
    await first.out;
    expect(first.notices[0].reason).toBe('rate_limit');
    restRegistry.clear();
    scripts = [[init('s3'), says('API Error: 500 internal error'), result('success', 's3')], done('s4')];
    const second = asked();
    await second.out;
    expect(second.notices[0].reason).toBe('server');
  });

  it('fails as it always did, resting the model, when a tool already ran', async () => {
    scripts = [[init('s1'), uses('Read'), says('API Error: 529 overloaded_error'), result('success', 's1')], done('s2')];
    const error = await asked().out.catch((e) => e as Error);
    expect(error).not.toBeInstanceOf(ProviderBusyError);
    expect((error as Error).message).toMatch(/^agent failed:.*overloaded_error/);
    expect(calls).toHaveLength(1);
    expect(restRegistry.resting(keyOf('sdk-a'))).toBe(true);
  });

  it('counts the structured answer as no tool', async () => {
    scripts = [[init('s1'), uses('StructuredOutput'), says('API Error: 503 unavailable'), result('success', 's1')], done('s2')];
    await asked().out;
    expect(calls).toHaveLength(2);
  });

  it('fails naming the pool when the next model refuses too, and not before every one was tried', async () => {
    scripts = [
      [init('s1'), says('API Error: 529 overloaded_error'), result('success', 's1')],
      [init('s2'), says('API Error: 429 rate_limit_error'), result('success', 's2')],
    ];
    const error = await asked().out.catch((e) => e as Error);
    expect(error).toBeInstanceOf(ProviderBusyError);
    expect((error as ProviderBusyError).models).toEqual(['model-a', 'model-b']);
    expect(calls).toHaveLength(2);
  });

  it('is the old failure, and rests nothing, for a role with one model', async () => {
    scripts = [[init('s1'), says('API Error: 529 overloaded_error'), result('success', 's1')]];
    const error = await asked(lone).out.catch((e) => e as Error);
    expect(error).not.toBeInstanceOf(ProviderBusyError);
    expect((error as Error).message).toMatch(/^agent failed:.*overloaded_error/);
    expect(restRegistry.resting(keyOf('sdk-a'))).toBe(false);
  });

  it('does not take a refusal by budget for a busy model: it stays a wait, on the provider that refused', async () => {
    restRegistry.rest(keyOf('sdk-a'), 60_000);
    scripts = [[init('s1'), says('API Error: 429 monthly limit exceeded, add credit'), result('success', 's1')], done('s2')];
    const error = await asked().out.catch((e) => e as Error);
    expect(error).toBeInstanceOf(ProviderBudgetError);
    // The first model rested, so the second one is the provider that refused.
    expect((error as ProviderBudgetError).provider).toBe('sdk-b');
    expect(calls).toHaveLength(1);
    expect(restRegistry.resting(keyOf('sdk-b'))).toBe(false);
  });
});

describe('a round that continues a session', () => {
  it('stays on the engine that holds it, picking the first model of that engine that does not rest', async () => {
    restRegistry.rest(keyOf('sdk-a'), 60_000);
    scripts = [done('s1')];
    const { out } = asked(pooled, { resume: { session: 'earlier', engine: 'claude-sdk' } });
    const r = await out;
    expect(modelOf(0)).toBe('model-b');
    expect(r.engine).toBe('claude-sdk');
  });

  it('runs the round as the role alone when no model of the pool belongs to that engine', async () => {
    const agent = newAgent({ id: 'mixed', permission: 'read', model: { role: null, provider: 'sdk-a', model: 'model-a', fallbacks: [{ provider: 'sdk-b', model: 'model-b' }] } });
    scripts = [done('s1')];
    const { out } = asked(agent, { resume: { session: 'earlier', engine: 'open' } });
    // There is no open server to reach: what matters is that the round did not open a session of the SDK.
    await out.catch(() => undefined);
    expect(calls).toHaveLength(0);
  });
});

describe('a ceremony of a role with spares', () => {
  const ceremony = () => askAgent<{ fala: string }>('deep', 'Pergunta', schema, { maxTurns: 3 });
  const withSpares = () =>
    updateConfig((c) => {
      c.llm.roles.deep = { ...c.llm.roles.deep, provider: 'sdk-a', model: 'model-a', fallbacks: [{ provider: 'sdk-b', model: 'model-b' }] };
      return c;
    });

  it('opens on the next model when the first rests, and shows it on the live line, since a ceremony has no thread', async () => {
    withSpares();
    restRegistry.rest(keyOf('sdk-a'), 120_000);
    activityLog.clear();
    scripts = [done('s1')];
    await ceremony();
    expect(modelOf(0)).toBe('model-b');
    const line = activityLog.get(null).find((e) => e.kind === 'tool' && e.label.includes('model-b'));
    expect(line?.label).toContain('model-a');
  });

  it('starts again on the next model when the SDK says the first was busy before any tool', async () => {
    withSpares();
    scripts = [[init('s1'), says('API Error: 529 overloaded_error'), result('success', 's1')], done('s2')];
    await ceremony();
    expect(calls.map((_, n) => modelOf(n))).toEqual(['model-a', 'model-b']);
  });

  it('resumes a session that ran out of turns on the model that opened it', async () => {
    withSpares();
    restRegistry.rest(keyOf('sdk-a'), 120_000);
    scripts = [[init('s1'), result('error_max_turns', 's1')], [init('s1'), result('success', 's1', { fala: 'partial' })]];
    const r = await ceremony();
    expect(r.partial).toBe(true);
    expect(calls.map((_, n) => modelOf(n))).toEqual(['model-b', 'model-b']);
    expect(calls[1].options.resume).toBe('s1');
  });
});
