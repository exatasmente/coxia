// How a team agent is run: the options the Claude SDK gets for a reader and for an agent that writes, and the same agent on the open engine.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown> | ((options: Record<string, any>) => Promise<void>);
const calls: { prompt: string; options: Record<string, any> }[] = [];
let script: Msg[] = [];
// When set, each call of the SDK takes the next script (a call and the resume that follows it).
let queue: Msg[][] | null = null;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, any> }) => {
    calls.push({ prompt, options });
    const mine = queue ? (queue.shift() ?? []) : script;
    return (async function* () {
      for (const m of mine) {
        if (typeof m === 'function') await m(options);
        else yield m;
      }
    })();
  },
}));

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityLog, withActivityContext } from '../src/main/activity';
import { runAgent, obj, str } from '../src/main/agents';
import { confinedHooks } from '../src/main/runner/hooks';
import { newAgent } from '../src/shared/config/team';
import { neutralConfig } from '../src/shared/config';
import type { LlmProvider } from '../src/shared/config/types';
import { installEnvSecret } from './helpers/config';

const done = (data: unknown): Msg[] => [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'result', subtype: 'success', session_id: 's1', structured_output: data },
];

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(async () => {
  calls.length = 0;
  queue = null;
  script = done({ fala: 'ok' });
  await pointProviderAt({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' });
});

const reader = newAgent({ id: 'refiner', permission: 'read' });
const writer = newAgent({ id: 'developer', permission: 'worktree' });
const schema = obj({ fala: str });

/** Points the agent's provider at a base URL of the test's choosing, so the SDK path can be exercised for each kind of endpoint. */
async function pointProviderAt(provider: Partial<LlmProvider> & Pick<LlmProvider, 'kind' | 'baseUrl'>): Promise<void> {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], ...provider, id: 'llm-target' }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
}

/** The result message the SDK sends at the end of a call, carrying only what the whole call cost. */
const sdkCost = (usd: number): Msg[] => [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' }, total_cost_usd: usd },
];

describe('runAgent on the Claude SDK', () => {
  it('reports the use of each response once, even when its blocks come as several messages, and the cost the SDK gives at the end', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-usage-'));
    const use = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 10 };
    script = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', session_id: 's1', message: { id: 'm1', usage: use, content: [{ type: 'text', text: 'looking' }] } },
      { type: 'assistant', session_id: 's1', message: { id: 'm1', usage: use, content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a' } }] } },
      { type: 'assistant', session_id: 's1', message: { id: 'm2', usage: { input_tokens: 50, output_tokens: 5 }, content: [{ type: 'text', text: 'done' }] } },
      { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' }, total_cost_usd: 0.0123 },
    ];
    const reports: unknown[] = [];
    let beats = 0;
    await runAgent({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7, onUsage: (u) => void reports.push(u), beat: () => void beats++ });
    expect(reports).toEqual([
      { promptTokens: 410, completionTokens: 20, cachedTokens: 300 },
      { promptTokens: 50, completionTokens: 5, cachedTokens: 0 },
      { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.0123 },
    ]);
    expect(beats).toBe(5);
  });

  it('takes the SDK figure as the charged cost only on Anthropic\'s own API', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cost-api-'));
    script = sdkCost(0.0123);
    const reports: unknown[] = [];
    await runAgent({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7, onUsage: (u) => void reports.push(u) });
    expect(reports).toEqual([{ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.0123 }]);
  });

  it('marks the SDK figure as an estimate on any provider that is not Anthropic\'s own API', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cost-other-'));
    const cases: (Partial<LlmProvider> & Pick<LlmProvider, 'kind' | 'baseUrl'>)[] = [
      { kind: 'anthropic', baseUrl: 'https://gateway.example.com', legacyCustomEndpoint: true },
      { kind: 'bedrock', baseUrl: '' },
      { kind: 'vertex', baseUrl: '' },
      { kind: 'foundry', baseUrl: '' },
    ];
    for (const provider of cases) {
      await pointProviderAt(provider);
      script = sdkCost(51.55);
      const reports: unknown[] = [];
      await runAgent({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7, onUsage: (u) => void reports.push(u) });
      expect(reports, provider.kind).toEqual([{ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 51.55, costEstimated: true }]);
    }
  });

  it('gives a reader the tools of the ceremonies: no Edit, no Write, no network', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-read-'));
    const r = await runAgent<{ fala: string }>({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7 });
    expect(r.data).toEqual({ fala: 'ok' });
    const o = calls[0].options;
    expect(o.cwd).toBe(cwd);
    expect(o.maxTurns).toBe(7);
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']));
    expect(o.allowedTools).not.toContain('Edit');
    expect(o.systemPrompt.append).toBe('sys');
  });

  it('gives an agent that writes Edit and Write, its own hooks and only the commands it was given', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    mkdirSync(join(root, 'src'));
    const hooks = confinedHooks({ root, commands: ['npm test'] });
    const abort = new AbortController();
    await runAgent({ agent: writer, prompt: 'p', schema, system: 'sys', cwd: root, label: 'developer', maxTurns: 50, confine: { root, hooks }, abort }, ['npm test']);
    const o = calls[0].options;
    expect(o.cwd).toBe(root);
    expect(o.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(npm test)']);
    expect(o.disallowedTools).not.toContain('Edit');
    expect(o.disallowedTools).not.toContain('Write');
    expect(o.disallowedTools).not.toContain('Bash');
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch', 'NotebookEdit']));
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.abortController).toBe(abort);
    const matchers = (o.hooks.PreToolUse as { matcher: string }[]).map((g) => g.matcher);
    expect(matchers).toEqual(['Edit|Write|MultiEdit|NotebookEdit', 'Read|Grep|Glob', 'Bash', 'WebFetch|WebSearch']);
  });

  it('shows in the live activity, under the run, what the hooks refuse, and tells the runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    const denied: string[] = [];
    const hooks = confinedHooks({ root, commands: ['npm test'], onDenied: (d) => denied.push(`${d.tool}:${d.code}`) });
    script = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      async (options: Record<string, any>) => {
        const run = (group: { matcher: string; hooks: ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<unknown>)[] }, input: Record<string, unknown>) => group.hooks[0](input, undefined, { signal: new AbortController().signal });
        const pre = options.hooks.PreToolUse as { matcher: string; hooks: never[] }[];
        await run(pre[0] as never, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/etc/cron.d/x', content: 'x' }, cwd: root });
        await run(pre[2] as never, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf .' }, cwd: root });
        await run(pre[2] as never, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: root });
      },
      { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } },
    ] as never;
    activityLog.clear();
    await withActivityContext('run:r-test-0002', () => runAgent({ agent: writer, prompt: 'p', schema, system: 's', cwd: root, label: 'developer', maxTurns: 5, confine: { root, hooks } }, ['npm test']));
    const blocked = activityLog.get('run:r-test-0002').filter((e) => e.state === 'blocked');
    expect(blocked.map((e) => e.label)).toEqual(['Bloqueado: Write /etc/cron.d/x', 'Bloqueado: Bash rm -rf .']);
    expect(denied).toEqual(['Write:outside', 'Bash:command']);
  });

  it('removes the credential-looking variables from every command of an agent that writes, and says nothing of the others', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    const hooks = confinedHooks({ root, commands: ['npm test'] });
    let seen: Record<string, any>[] = [];
    script = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      async (options: Record<string, any>) => {
        const bash = (options.hooks.PreToolUse as { matcher: string; hooks: ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<Record<string, any>>)[] }[]).find((g) => g.matcher === 'Bash') as { hooks: ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<Record<string, any>>)[] };
        for (const command of ['npm test', 'rm -rf .']) seen.push(await bash.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: root }, undefined, { signal: new AbortController().signal }));
      },
      { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } },
    ] as never;
    await runAgent({ agent: writer, prompt: 'p', schema, system: 's', cwd: root, label: 'developer', maxTurns: 5, confine: { root, hooks } }, ['npm test']);
    // the SDK process itself keeps the key it needs to reach the model
    expect(calls[0].options.env.ANTHROPIC_API_KEY).toBe('test-key-not-real');
    const [allowed, refused] = seen.map((o) => o.hookSpecificOutput);
    expect(allowed.permissionDecision).toBe('allow');
    expect(allowed.updatedInput.command).toMatch(/^env (-u \w+ )+npm test$/);
    expect(allowed.updatedInput.command).toContain('-u ANTHROPIC_API_KEY');
    expect(refused.permissionDecision).toBe('deny');
    seen = [];
  });

  it('turns the shell off for an agent that writes when it was given no command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    await runAgent({ agent: writer, prompt: 'p', schema, system: 's', cwd: root, label: 'developer', maxTurns: 5, confine: { root, hooks: confinedHooks({ root, commands: [] }) } }, []);
    expect(calls[0].options.disallowedTools).toContain('Bash');
    expect(calls[0].options.allowedTools.some((t: string) => t.startsWith('Bash'))).toBe(false);
  });

  it('does not take a half answer for a finished stage: running out of turns is an error', async () => {
    script = [{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'result', subtype: 'error_max_turns', session_id: 's1' }];
    await expect(runAgent({ agent: reader, prompt: 'p', schema, system: 's', cwd: tmpdir(), label: 'refiner', maxTurns: 2 })).rejects.toThrow(/error_max_turns/);
    expect(calls).toHaveLength(1);
  });

  describe('a call that answers a message and may run out of turns (wrapUp)', () => {
    const turnsOut = (id = 's1'): Msg[] => [{ type: 'system', subtype: 'init', session_id: id }, { type: 'result', subtype: 'error_max_turns', session_id: id }];
    const call = (extra: Record<string, unknown> = {}) => ({ agent: reader, prompt: 'p', schema, system: 's', cwd: tmpdir(), label: 'refiner', maxTurns: 20, wrapUp: true, ...extra });

    it('resumes the same session once, with no tool and 2 turns, and marks what comes back as partial', async () => {
      queue = [turnsOut(), done({ fala: 'what I have' })];
      const r = await runAgent<{ fala: string }>(call());
      expect(r).toMatchObject({ data: { fala: 'what I have' }, partial: true });
      expect(calls).toHaveLength(2);
      const [first, again] = calls;
      expect(first.options.maxTurns).toBe(20);
      expect(first.options.resume).toBeUndefined();
      expect(again.options).toMatchObject({ resume: 's1', maxTurns: 2, tools: [], allowedTools: [] });
      expect(again.options.outputFormat).toEqual(first.options.outputFormat);
      expect(again.options.mcpServers).toBeUndefined();
      expect(again.options.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash']));
      expect(again.prompt).not.toBe('p');
    });

    it('keeps the failure, with the reason, when the wrap-up fails too', async () => {
      queue = [turnsOut(), [{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'result', subtype: 'error_during_execution', session_id: 's1' }]];
      await expect(runAgent(call())).rejects.toThrow(/step limit[\s\S]*partial answer[\s\S]*error_during_execution|limite de passos[\s\S]*error_during_execution/);
      expect(calls).toHaveLength(2);
    });

    it('fails with no second call when the session is unknown', async () => {
      queue = [[{ type: 'result', subtype: 'error_max_turns', session_id: '' }]];
      await expect(runAgent(call())).rejects.toThrow(/step limit|limite de passos/);
      expect(calls).toHaveLength(1);
    });

    it('is never done for a call that did not ask for it (a stage)', async () => {
      queue = [turnsOut()];
      await expect(runAgent(call({ wrapUp: undefined }))).rejects.toThrow(/error_max_turns/);
      expect(calls).toHaveLength(1);
    });
  });
});
