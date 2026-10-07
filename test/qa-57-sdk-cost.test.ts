// QA black-box for issue 57: what the SDK's figure becomes once it is recorded on a stage and said on the timeline, per provider.
// The SDK is mocked, the provider config is pointed at each endpoint, and the record is passed through the real usage view. No model, no host, no network.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Msg = Record<string, unknown>;
let script: Msg[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {
    for (const m of script) yield m;
  })(),
}));

import { runAgent, obj, str } from '../src/main/agents';
import { newAgent } from '../src/shared/config/team';
import { neutralConfig } from '../src/shared/config';
import type { LlmProvider } from '../src/shared/config/types';
import { addReport, emptyUsage, type UsageReport } from '../src/shared/runs/usage';
import type { StageUsage } from '../src/shared/runs/types';
import { usageParams } from '../src/shared/runs/view';
import { installEnvSecret } from './helpers/config';

const reader = newAgent({ id: 'refiner', permission: 'read' });
const schema = obj({ fala: str });

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(() => {
  script = [];
});

/** Points the agent's provider at an endpoint of the test's choosing, so each kind can be exercised without a real host. */
async function pointProviderAt(provider: Partial<LlmProvider> & Pick<LlmProvider, 'kind' | 'baseUrl'>): Promise<void> {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], ...provider, id: 'llm-target' }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
}

/** Runs one SDK call whose result carries only a whole-call cost, and returns the reports the stage would record. */
async function sdkReports(usd: number): Promise<UsageReport[]> {
  const cwd = mkdtempSync(join(tmpdir(), 'qa57-'));
  script = [
    { type: 'system', subtype: 'init', session_id: 's1' },
    { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' }, total_cost_usd: usd },
  ];
  const reports: UsageReport[] = [];
  await runAgent({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7, onUsage: (u) => void reports.push(u as UsageReport) });
  return reports;
}

/** What the timeline would say for a stage whose only report is the SDK's whole-call figure: the cost text and whether it is called an estimate. */
function timelineAfter(reports: UsageReport[]): { cost: string | null; estimated: boolean } {
  const total: StageUsage = reports.reduce((u, r) => addReport(u, r), emptyUsage());
  const p = usageParams(total, 'en');
  return { cost: p.cost, estimated: p.estimated };
}

describe('the cost a stage shows after an SDK call, per provider', () => {
  it('shows the SDK figure as the charged cost on Anthropic\'s own API', async () => {
    await pointProviderAt({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' });
    const reports = await sdkReports(0.0123);
    expect(reports).toEqual([{ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.0123 }]);
    expect(timelineAfter(reports)).toEqual({ cost: '$0.0123', estimated: false });
  });

  it('shows the same figure marked as an estimate on a provider that is not Anthropic\'s own API, never as charged', async () => {
    const cases: (Partial<LlmProvider> & Pick<LlmProvider, 'kind' | 'baseUrl'>)[] = [
      { kind: 'anthropic', baseUrl: 'https://gateway.example.com', legacyCustomEndpoint: true },
      { kind: 'bedrock', baseUrl: '' },
      { kind: 'vertex', baseUrl: '' },
      { kind: 'foundry', baseUrl: '' },
    ];
    for (const provider of cases) {
      await pointProviderAt(provider);
      const reports = await sdkReports(51.55);
      expect(reports, provider.kind).toEqual([{ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 51.55, costEstimated: true }]);
      // the figure is still shown, and the timeline calls it an estimate rather than an amount charged
      expect(timelineAfter(reports), provider.kind).toEqual({ cost: '$51.55', estimated: true });
    }
  });

  // Criterion 3's case: a result the SDK sends with no cost figure. The SDK's own types declare `total_cost_usd` a required `number`, so this is not a shape it
  // produces; the test pins what would happen if it did — no report, no cost, and no estimated figure standing in for it.
  it('records no cost at all when the SDK result carries no total_cost_usd', async () => {
    await pointProviderAt({ kind: 'bedrock', baseUrl: '' });
    const cwd = mkdtempSync(join(tmpdir(), 'qa57-nocost-'));
    script = [{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } }];
    const reports: UsageReport[] = [];
    await runAgent({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7, onUsage: (u) => void reports.push(u as UsageReport) });
    const total = reports.reduce((u, r) => addReport(u, r), emptyUsage());
    expect({ reports, cost: usageParams(total, 'en').cost, estimated: usageParams(total, 'en').estimated }).toEqual({ reports: [], cost: null, estimated: false });
  });

  it('keeps the tokens the SDK already records when the cost is marked an estimate', async () => {
    await pointProviderAt({ kind: 'bedrock', baseUrl: '' });
    const cwd = mkdtempSync(join(tmpdir(), 'qa57-tok-'));
    script = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 40 }, content: [{ type: 'text', text: 'ok' }] } },
      { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' }, total_cost_usd: 0.5 },
    ];
    const reports: UsageReport[] = [];
    await runAgent({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7, onUsage: (u) => void reports.push(u as UsageReport) });
    const total = reports.reduce((u, r) => addReport(u, r), emptyUsage());
    expect({ promptTokens: total.promptTokens, completionTokens: total.completionTokens, cachedTokens: total.cachedTokens }).toEqual({ promptTokens: 140, completionTokens: 10, cachedTokens: 40 });
    expect(usageParams(total, 'en').estimated).toBe(true);
  });
});
