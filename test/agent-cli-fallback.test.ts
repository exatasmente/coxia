// An agent call whose provider refuses for budget, through the real runAgent and the SDK path with the SDK mocked: a listed agent finishes on the signed-in
// Claude Code CLI with one more call, the CLI's own limit is read from the structured event, and its use is a subscription's. No model, no network, no ~/.claude.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Msg = Record<string, unknown>;
const calls: { options: Record<string, any> }[] = [];
let scripts: Msg[][] = [];
let testWorkspace = false;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    calls.push({ options });
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

vi.mock('../src/main/workspace', async (load) => ({ ...(await load<typeof import('../src/main/workspace')>()), isTestWorkspace: () => testWorkspace }));

import { runAgent, obj, str } from '../src/main/agents';
import { ProviderBudgetError } from '../src/main/engine/contract';
import { newAgent } from '../src/shared/config/team';
import { neutralConfig } from '../src/shared/config';
import type { CliFallbackConfig } from '../src/shared/config/types';
import { addReport, emptyUsage, type UsageReport } from '../src/shared/runs/usage';
import { installEnvSecret } from './helpers/config';

const schema = obj({ fala: str });
const init = (from?: string) => ({ type: 'system', subtype: 'init', session_id: 's1', ...(from ? { apiKeySource: from } : {}) });
const refused = () => [init('ANTHROPIC_API_KEY'), { type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 403 Key limit exceeded (monthly limit)' }] } }, { type: 'result', subtype: 'success', session_id: 's1' }];
const answered = (cost = 0.3) => [
  init('/login managed key'),
  { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'text', text: 'ok' }] } },
  { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' }, total_cost_usd: cost },
];
const limited = (status: string, resetsAt?: number) => [
  init('/login managed key'),
  { type: 'rate_limit_event', rate_limit_info: { status, rateLimitType: 'five_hour', ...(resetsAt === undefined ? {} : { resetsAt }) }, uuid: 'u', session_id: 's1' },
  { type: 'result', subtype: 'success', session_id: 's1' },
];

/** A keyed provider every role uses, and a keyless one (the signed-in CLI) the fallback goes to. */
async function install(fallback: CliFallbackConfig, roleProvider = 'paid'): Promise<void> {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  const first = c.llm.providers[0];
  c.llm.providers = [{ ...first, id: 'paid' }, { ...first, id: 'cli', secretRef: null, models: ['sonnet', 'opus'] }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: roleProvider }])) as typeof c.llm.roles;
  c.llm.cliFallback = fallback;
  saveConfig(c);
}

async function ask(id = 'refiner'): Promise<{ result: unknown; reports: UsageReport[] }> {
  const reports: UsageReport[] = [];
  const cwd = mkdtempSync(join(tmpdir(), 'cli-fallback-'));
  const result = await runAgent({ agent: newAgent({ id, permission: 'read' }), prompt: 'p', schema, system: 'sys', cwd, label: id, maxTurns: 3, onUsage: (u) => void reports.push(u as UsageReport) }).catch((e: unknown) => e);
  return { result, reports };
}

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
  process.env.ANTHROPIC_API_KEY = 'shell-key-not-real';
});

beforeEach(() => {
  calls.length = 0;
  scripts = [];
  testWorkspace = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a listed agent whose provider refuses for budget', () => {
  it('finishes on the signed-in CLI with one more call, without any API key, as subscription use', async () => {
    await install({ enabled: true, agents: ['refiner'] });
    scripts = [refused(), answered()];
    const { result, reports } = await ask();
    expect(result).toMatchObject({ data: { fala: 'ok' } });
    expect(calls).toHaveLength(2);
    expect(calls[1].options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(calls[0].options.env.ANTHROPIC_API_KEY).toBeTruthy();
    const total = reports.reduce((u, r) => addReport(u, r), emptyUsage());
    expect(total).toMatchObject({ promptTokens: 100, completionTokens: 10, calls: 1, costUsd: null, subscriptionCalls: 1 });
  });

  it('waits on the CLI\'s own limit with the reset time of the structured event (seconds or ms), never a third call', async () => {
    await install({ enabled: true, agents: ['refiner'] });
    for (const resetsAt of [1_900_000_000, 1_900_000_000_000]) {
      calls.length = 0;
      scripts = [refused(), limited('rejected', resetsAt)];
      const { result } = await ask();
      expect(result).toBeInstanceOf(ProviderBudgetError);
      expect(result).toMatchObject({ provider: 'cli', until: 1_900_000_000_000 });
      expect(calls).toHaveLength(2);
    }
  });

  it('keeps waiting on the original refusal when the CLI fails some other way', async () => {
    await install({ enabled: true, agents: ['refiner'] });
    scripts = [refused(), [init(), { type: 'result', subtype: 'error_during_execution', session_id: 's1' }]];
    const { result } = await ask();
    expect(result).toBeInstanceOf(ProviderBudgetError);
    expect(result).toMatchObject({ provider: 'paid', until: null });
  });
});

describe('a refusal for budget that waits as today', () => {
  it('for an agent not listed, with the fallback off, or in a test workspace', async () => {
    for (const [fallback, test, id] of [[{ enabled: true, agents: ['deep'] }, false, 'refiner'], [{ enabled: false, agents: ['refiner'] }, false, 'refiner'], [{ enabled: true, agents: ['refiner'] }, true, 'refiner']] as const) {
      await install({ enabled: fallback.enabled, agents: [...fallback.agents] });
      testWorkspace = test;
      calls.length = 0;
      scripts = [refused(), answered()];
      const { result } = await ask(id);
      expect(result).toBeInstanceOf(ProviderBudgetError);
      expect(result).toMatchObject({ provider: 'paid' });
      expect(calls).toHaveLength(1);
    }
  });

  it('never for a failure that is not a budget refusal', async () => {
    await install({ enabled: true, agents: ['refiner'] });
    scripts = [[init(), { type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 401 invalid api key' }] } }, { type: 'result', subtype: 'success', session_id: 's1' }], answered()];
    const { result } = await ask();
    expect(result).not.toBeInstanceOf(ProviderBudgetError);
    expect(calls).toHaveLength(1);
  });
});

describe('a keyless anthropic provider used directly', () => {
  it('is subscription use when the CLI says its login authenticated the call, and keeps the API cost when a key did', async () => {
    await install({ enabled: false, agents: [] }, 'cli');
    scripts = [answered(0.4)];
    const login = (await ask()).reports.reduce((u, r) => addReport(u, r), emptyUsage());
    expect(login).toMatchObject({ costUsd: null, subscriptionCalls: 1 });
    scripts = [[init('ANTHROPIC_API_KEY'), ...answered(0.4).slice(1)]];
    const key = (await ask()).reports.reduce((u, r) => addReport(u, r), emptyUsage());
    expect(key.costUsd).toBe(0.4);
    expect(key.subscriptionCalls).toBeUndefined();
  });

  it('reads the limit from the event: a warning does not stop the call, a rejection waits until the reset', async () => {
    await install({ enabled: false, agents: [] }, 'cli');
    scripts = [[init('/login managed key'), { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day' }, uuid: 'u', session_id: 's1' }, ...answered().slice(1)]];
    expect((await ask()).result).toMatchObject({ data: { fala: 'ok' } });
    scripts = [limited('rejected', 1_900_000_000)];
    expect((await ask()).result).toMatchObject({ provider: 'cli', until: 1_900_000_000_000 });
  });
});
