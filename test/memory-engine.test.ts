// The memory tools in both engines, from the same handlers: the open engine's ToolImpls through runAgent against a scripted model, and the Claude Agent SDK's in-process
// server (the real SDK module, its `query` replaced). A session gives them; a call with none gets none; the last turn of procedures and the wrap-up drop them; a sub-agent
// may read and never writes into the principal's folder.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryParams = { prompt: unknown; options: Record<string, any> };
const calls: QueryParams[] = [];
let sdkBroken = false;

vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => {
  const real = await original<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    createSdkMcpServer: (...args: Parameters<typeof real.createSdkMcpServer>) => {
      if (sdkBroken) throw new Error('the SDK could not build a server');
      return real.createSdkMcpServer(...args);
    },
    query: (p: QueryParams) => {
      calls.push(p);
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's1' };
        yield { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' }, total_cost_usd: 0 };
      })();
    },
  };
});

import { obj, runAgent, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import type { PoolMember } from '../src/main/engine/open/pool';
import { restRegistry } from '../src/main/engine/open/rest';
import { memoryMcpServer, memorySubagentGuard, memoryToolImpls } from '../src/main/memory/engineTool';
import { MEMORY_MCP_SERVER, memoryMcpToolName, memoryToolNames, type MemoryTools } from '../src/main/memory/tools';
import { procedureToolNames } from '../src/main/procedures/tools';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import type { Activity } from '../src/shared/config/types';
import { type Fake, type FakeRequest, type Step, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';
import { installEnvSecret } from './helpers/config';
import { memoryWorld, type MemoryWorld } from './helpers/memory';

let fake: Fake;
let root: string;
let w: MemoryWorld;

const names = (chat: FakeRequest): string[] => ((chat.body as Record<string, any>).tools as { function: { name: string } }[]).map((t) => t.function.name).sort();
const toolNames = (i: number): string[] => names(fake.chats()[i]);
const toolResults = (i: number): Record<string, string> => Object.fromEntries(((fake.chats()[i].body as Record<string, any>).messages as { role: string; tool_call_id: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m.content]));
const reader = () => newAgent({ id: 'reader', permission: 'read', tracker: 'read', shell: 'none', model: { role: null, provider: 'local', model: 'qwen3:8b' } });

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'memory-engine-'));
  await installEnvSecret('llm.anthropic');
  const { updateConfig } = await import('../src/main/workspaceConfig');
  fake = await fakeOpenAI((req) => {
    const script: Record<number, ReturnType<typeof toolStep>> = {
      1: toolStep([
        { id: 'a', name: 'memory_save', args: { kind: 'decision', title: 'Use the queue', text: 'Retries go through the queue.' } },
        { id: 'b', name: 'memory_read', args: { id: 'sys:version' } },
        { id: 'c', name: 'memory_delete', args: { id: 'm-00000001' } },
      ]),
      2: toolStep([{ id: 'd', name: 'memory_list', args: { query: 'queue' } }, { id: 'e', name: 'memory_remove', args: { id: 'm-00000001' } }]),
    };
    return script[req.n] ?? toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]);
  });
  updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
    return c;
  });
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  w = memoryWorld();
  calls.length = 0;
  sdkBroken = false;
});

describe('the open engine', () => {
  it('offers the four tools to a writing session, runs them through it, and answers an unknown tool as no tool of this agent', async () => {
    const s = await w.session({ agent: 'reader' });
    const before = fake.chats().length;
    const r = await runAgent<{ fala: string }>({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, memoryTools: s.tools }, []);
    expect(r.data).toEqual({ fala: 'done' });
    expect(toolNames(before)).toEqual(expect.arrayContaining(['memory_list', 'memory_read', 'memory_remove', 'memory_save']));
    expect(toolNames(before)).not.toContain('memory_delete');
    const first = toolResults(before + 1);
    expect(first.a).toBe('Saved m-00000001 at revision 1.');
    expect(first.b).toContain('Version: unknown');
    expect(first.c).not.toContain('Saved');
    const second = toolResults(before + 2);
    expect(second.d).toContain('m-00000001 decision: Use the queue');
    expect(second.e).toBe('Removed m-00000001.');
    expect(w.audits.map((a) => a.target)).toEqual(['memory:save', 'memory:remove']);
  });

  it('offers a reading session the two reads only', async () => {
    const s = await w.session({ agent: 'reader', writes: false });
    const before = fake.chats().length;
    await runAgent({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, memoryTools: s.tools }, []);
    expect(toolNames(before).filter((n) => n.startsWith('memory_'))).toEqual(['memory_list', 'memory_read']);
  });

  it('is not offered to a call that has no session', async () => {
    const before = fake.chats().length;
    await runAgent({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6 }, []);
    expect(toolNames(before).filter((n) => n.startsWith('memory_'))).toEqual([]);
  });

  it('the last turn of procedures keeps the procedure tools and drops the memory\'s', async () => {
    const s = await w.session({ agent: 'reader' });
    const procedures = { list: async () => ({ text: '' }), get: async () => ({ text: '' }), save: async () => ({ text: '' }), stale: async () => ({ text: '' }) };
    const before = fake.chats().length;
    await runAgent({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 3, memoryTools: s.tools, procedures, procedureOnly: true }, []);
    expect(toolNames(before).filter((n) => n !== 'final_answer')).toEqual([...procedureToolNames({})].sort());
  });

  it('the one-turn wrap-up of a call that ran out of turns strips them with every other tool', async () => {
    const stuck = await fakeOpenAI((req) => (req.n <= 2 ? toolStep([{ id: `l${req.n}`, name: 'memory_list', args: {} }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'partial' } }])));
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'stuck', kind: 'openai-compatible', baseUrl: stuck.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'reader', permission: 'read', tracker: 'read', shell: 'none', model: { role: null, provider: 'stuck', model: 'qwen3:8b' } });
      const s = await w.session({ agent: 'reader' });
      const r = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 2, wrapUp: true, memoryTools: s.tools }, []);
      expect(r.partial).toBe(true);
      expect(names(stuck.chats()[0])).toContain('memory_list');
      const last = stuck.chats().length - 1;
      expect(last).toBeGreaterThanOrEqual(2);
      expect(names(stuck.chats()[last]).filter((n) => n.startsWith('memory_'))).toEqual([]);
    } finally {
      await stuck.close();
    }
  });

  it('the ToolImpls carry the schema of the table, the explore tag on the reads and principalOnly on the writes, and cut a long answer', async () => {
    const tools: MemoryTools = { list: async () => ({ text: 'x'.repeat(500) }), read: async () => ({ text: 'r' }), save: async () => ({ text: 's' }), remove: async () => ({ text: 'd' }) };
    const impls = memoryToolImpls(tools);
    expect(impls.map((i) => i.name)).toEqual(memoryToolNames(tools));
    expect(Object.fromEntries(impls.map((i) => [i.name, [i.activity ?? null, i.principalOnly ?? false]]))).toEqual({
      memory_list: ['explore', false],
      memory_read: ['explore', false],
      memory_save: [null, true],
      memory_remove: [null, true],
    });
    const r = await impls[0].run({}, { outputMax: 100 } as never);
    expect(r.render(r.response).length).toBeLessThan(500);
    expect(memoryToolImpls({ list: tools.list, read: tools.read }).map((i) => i.name)).toEqual(['memory_list', 'memory_read']);
  });
});

describe('the Claude Agent SDK server', () => {
  const handlerOf = (server: Record<string, any>, name: string) => server[MEMORY_MCP_SERVER].instance._registeredTools[name].handler as (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }>;

  it('is one in-process server named coxia_memory with the same tools, over the same handlers as the open engine', async () => {
    const seen: [string, unknown][] = [];
    const tools: MemoryTools = {
      list: async (i) => (seen.push(['list', i]), { text: 'L' }),
      read: async (i) => (seen.push(['read', i]), { text: 'R' }),
      save: async (i) => (seen.push(['save', i]), { text: 'S' }),
      remove: async (i) => (seen.push(['remove', i]), { text: 'D' }),
    };
    const server = (await memoryMcpServer(tools)) as Record<string, any>;
    expect(Object.keys(server)).toEqual(['coxia_memory']);
    expect(server.coxia_memory.type).toBe('sdk');
    expect(Object.keys(server.coxia_memory.instance._registeredTools)).toEqual(memoryToolNames(tools));
    const impls = memoryToolImpls(tools);
    for (const name of memoryToolNames(tools)) {
      const viaSdk = await handlerOf(server, name)({ id: 'm-1' }, {});
      const viaOpen = await impls.find((i) => i.name === name)!.run({ id: 'm-1' }, { outputMax: 1000 } as never);
      expect(viaSdk.content[0].text).toBe(viaOpen.render(viaOpen.response));
    }
    expect(seen).toHaveLength(8);
    const reads = (await memoryMcpServer({ list: tools.list, read: tools.read })) as Record<string, any>;
    expect(Object.keys(reads.coxia_memory.instance._registeredTools)).toEqual(['memory_list', 'memory_read']);
    expect(memoryToolNames(tools).map(memoryMcpToolName)).toEqual(memoryToolNames(tools).map((n) => `mcp__coxia_memory__${n}`));
  });

  it('is built when the SDK is loadable and null when it is not', async () => {
    const tools: MemoryTools = { list: async () => ({ text: '' }), read: async () => ({ text: '' }) };
    sdkBroken = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await memoryMcpServer(tools)).toBeNull();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('a session\'s call is offered the server and the names, with the hook that keeps a sub-agent from writing; a reader gets no hook; a call without a session gets nothing', async () => {
    const sdkReader = newAgent({ id: 'reader', permission: 'read' });
    const writer = await w.session({ agent: 'reader' });
    await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, memoryTools: writer.tools });
    expect(Object.keys(calls[0].options.mcpServers ?? {})).toContain('coxia_memory');
    expect(calls[0].options.allowedTools).toEqual(expect.arrayContaining(memoryToolNames(writer.tools!).map(memoryMcpToolName)));
    // the agent stays read-only: the app's tools are an addition to what it is allowed, not a way around it
    expect(calls[0].options.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write']));
    const guard = (calls[0].options.hooks.PreToolUse as { matcher: string }[]).find((h) => h.matcher.includes('memory_save'));
    expect(guard?.matcher).toBe('mcp__coxia_memory__memory_save|mcp__coxia_memory__memory_remove');
    calls.length = 0;
    const readOnly = await w.session({ agent: 'reader', writes: false });
    await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, memoryTools: readOnly.tools });
    expect(calls[0].options.allowedTools.filter((n: string) => n.includes('memory'))).toEqual(['mcp__coxia_memory__memory_list', 'mcp__coxia_memory__memory_read']);
    expect(((calls[0].options.hooks.PreToolUse ?? []) as { matcher: string }[]).some((h) => h.matcher.includes('memory_save'))).toBe(false);
    calls.length = 0;
    await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6 });
    expect(Object.keys(calls[0].options.mcpServers ?? {})).not.toContain('coxia_memory');
    expect(calls[0].options.allowedTools.filter((n: string) => n.includes('memory'))).toEqual([]);
  });

  it('the last turn of procedures turns the built-ins off and keeps no memory server', async () => {
    const writer = newAgent({ id: 'writer', permission: 'worktree', shell: 'sandbox', allowedCommands: ['npm test'] });
    const procedures = { list: async () => ({ text: '' }), get: async () => ({ text: '' }), save: async () => ({ text: '' }), stale: async () => ({ text: '' }) };
    const s = await w.session({ agent: 'writer' });
    await runAgent({ agent: writer, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'writer', maxTurns: 3, procedures, memoryTools: s.tools, procedureOnly: true, confine: { root, hooks: {} } as never }, ['npm test']);
    expect(Object.keys(calls[0].options.mcpServers)).toEqual(['coxia_procedures']);
    expect(calls[0].options.allowedTools.filter((n: string) => n.includes('memory'))).toEqual([]);
  });

  it('a server that cannot be built does not stop the call: the thread says the tools are not there, once', async () => {
    sdkBroken = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const notes: string[] = [];
      const sdkReader = newAgent({ id: 'reader', permission: 'read' });
      const s = await w.session({ agent: 'reader', note: (code) => notes.push(code) });
      const r = await runAgent<{ fala: string }>({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, memoryTools: s.tools });
      expect(r.data).toEqual({ fala: 'ok' });
      expect(Object.keys(calls[0].options.mcpServers ?? {})).not.toContain('coxia_memory');
      expect(calls[0].options.allowedTools.filter((n: string) => n.includes('memory'))).toEqual([]);
      expect(calls[0].options.hooks.PreToolUse?.some((h: { matcher: string }) => h.matcher.includes('memory_save')) ?? false).toBe(false);
      // another attempt (a retry on another model of the pool, or another call of the session) rebuilds the server and says nothing more
      await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, memoryTools: s.tools });
      expect(notes).toEqual(['runner.sharedMemory.toolsMissing']);
    } finally {
      log.mockRestore();
    }
  });

  it('the sub-agent hook refuses the write tools when the input carries an agent_id and allows them without one', async () => {
    const input = (extra: Record<string, unknown>) => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__coxia_memory__memory_save', tool_input: {}, ...extra }) as never;
    const ctx = { signal: new AbortController().signal };
    const refused = (await memorySubagentGuard(input({ agent_id: 'sub-1' }), undefined, ctx)) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(refused.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(refused.hookSpecificOutput?.permissionDecisionReason).toContain('Only the agent whose folder it is writes');
    expect(await memorySubagentGuard(input({}), undefined, ctx)).toEqual({});
    expect(await memorySubagentGuard({ hook_event_name: 'PostToolUse', agent_id: 'sub-1' } as never, undefined, ctx)).toEqual({});
  });
});

describe('sub-agents of the open engine', () => {
  let dir: string;
  let fakes: Fake[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-sub-'));
    mkdirSync(join(dir, 'sessions'));
    restRegistry.clear();
  });
  afterEach(async () => {
    await Promise.all(fakes.map((f) => f.close()));
    fakes = [];
    restRegistry.clear();
    rmSync(dir, { recursive: true, force: true });
  });

  async function server(script: Step[] | ((req: FakeRequest) => Step)): Promise<Fake> {
    const f = await fakeOpenAI(script);
    fakes.push(f);
    return f;
  }
  const member = (f: Fake, name: string): PoolMember => ({ key: `key-${name}`, label: `model-${name}`, model: `model-${name}`, provider: `prov-${name}`, client: new ChatClient({ baseUrl: f.url, model: `model-${name}`, retryDelayMs: 0, maxRetries: 0 }) });
  const system = (r: FakeRequest): string => String(((r.body?.messages ?? []) as { role: string; content: unknown }[]).find((m) => m.role === 'system')?.content ?? '');

  async function principal(mode: 'delegate' | 'fallback' | 'switch', primary: PoolMember, over: Partial<OpenRunParams> = {}, activities?: Partial<Record<Activity, PoolMember[]>>) {
    const s = await w.session();
    const tools = memoryToolImpls(s.tools!);
    return runOpen<string>({
      role: 'deep',
      prompt: 'main task',
      client: primary.client,
      pool: { name: 'deep', primary: { key: primary.key, label: primary.label, provider: primary.provider }, fallbacks: [], activities, mode },
      cwd: dir,
      allowedTools: ['Agent', ...tools.map((t) => t.name)],
      extraTools: tools,
      docs: {},
      maxTurns: 8,
      sessionsDir: join(dir, 'sessions'),
      ripgrep: 'off',
      systemAppend: 'PRINCIPAL-ONLY INDEX SECTION: 40 lines of the memory',
      ...over,
    });
  }

  it('a sub-agent of a kind gets the two reads and neither write tool, and no index in its system text', async () => {
    const a = await server([toolStep([{ id: 'c1', name: 'Agent', args: { description: 'go', prompt: 'look it up', kind: 'explore' } }]), textStep('principal done')]);
    const b = await server((req) => (req.body?.messages.at(-1).role === 'tool' ? textStep('found it') : toolStep([{ id: 'c2', name: 'memory_list', args: {} }])));
    await principal('delegate', member(a, 'a'), {}, { explore: [member(b, 'b')] });
    expect(names(b.chats()[0])).toEqual(['memory_list', 'memory_read']);
    expect(system(a.chats()[0])).toContain('PRINCIPAL-ONLY INDEX SECTION');
    expect(system(b.chats()[0])).not.toContain('PRINCIPAL-ONLY INDEX SECTION');
    // the principal has all four
    expect(names(a.chats()[0])).toEqual(expect.arrayContaining(['memory_list', 'memory_read', 'memory_remove', 'memory_save']));
    // the sub-agent's read ran through the session
    const back = (b.chats()[1].body?.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool');
    expect(back[0].content).toContain('sys:version');
  });

  it('a plain sub-agent (no kinds) inherits the principal\'s tools and loses the write tools by name', async () => {
    const a = await server([toolStep([{ id: 'c1', name: 'Agent', args: { description: 'go', prompt: 'look it up' } }]), textStep('principal done')]);
    // fallback mode: `Agent` is a plain read-only sub-agent on the principal's own model, so one server answers both
    await principal('fallback', member(a, 'a'));
    const sub = a.chats().find((c) => system(c).includes('sub-agent') || (c.body?.messages as { role: string; content: string }[]).some((m) => m.role === 'user' && m.content === 'look it up'));
    expect(sub).toBeDefined();
    expect(names(sub as FakeRequest).filter((n) => n.startsWith('memory_'))).toEqual(['memory_list', 'memory_read']);
    expect(system(sub as FakeRequest)).not.toContain('PRINCIPAL-ONLY INDEX SECTION');
  });

  it('in switch mode the turn after a memory_read runs on the explore list, because the read is an exploring step', async () => {
    const a = await server([toolStep([{ id: 'c1', name: 'memory_read', args: { id: 'sys:version' } }]), textStep('should not be asked')]);
    const b = await server([textStep('answered on the explore model')]);
    const events: unknown[] = [];
    const r = await principal('switch', member(a, 'a'), { events: { onSwitch: (e) => events.push(e) } }, { explore: [member(b, 'b')] });
    expect(r.data).toBe('answered on the explore model');
    expect(a.chats()).toHaveLength(1);
    expect(b.chats()).toHaveLength(1);
    expect(events).toMatchObject([{ reason: 'activity', activity: 'explore' }]);
  });
});
