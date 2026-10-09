// The procedure tools in both engines, from the same handlers: the open engine's ToolImpls through runAgent against a scripted model, and the Claude Agent SDK's in-process
// server (the real SDK module, its `query` replaced). A reading agent is offered them; a call with none gets none; a server that cannot be built does not stop the call.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { procedureMcpServer, procedureToolImpls } from '../src/main/procedures/engineTool';
import { createProcedureSession, type ProcedureSession } from '../src/main/procedures/session';
import { createProcedureStore } from '../src/main/procedures/store';
import { PROCEDURE_TOOLS, PROCEDURE_TOOL_NAMES, PROCEDURES_MCP_SERVER, procedureMcpToolName, type ProcedureTools } from '../src/main/procedures/tools';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';
import { installEnvSecret } from './helpers/config';

let fake: Fake;
let root: string;
let ws: string;
let notes: string[];

const record = { kind: 'repo', key: 'api', title: 'Run the end-to-end tests', steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite' }] };

function session(): ProcedureSession {
  let n = 0;
  const store = createProcedureStore(ws, { hex: () => (++n).toString(16).padStart(8, '0') });
  return createProcedureSession(
    { store, note: (code) => notes.push(code) },
    { writer: { by: 'reader', surface: 'stage', stage: 'development', permission: 'read', shell: 'none' }, workspaceRepos: ['api'], select: { repos: ['api'], stageKind: 'development', tools: [], hosts: [], language: 'en' } },
  );
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'procedures-engine-'));
  await installEnvSecret('llm.anthropic');
  const { updateConfig } = await import('../src/main/workspaceConfig');
  fake = await fakeOpenAI((req) => {
    const script: Record<number, ReturnType<typeof toolStep>> = {
      1: toolStep([
        { id: 'a', name: 'procedures_save', args: record },
        { id: 'b', name: 'procedures_get', args: { id: 'p-00000001' } },
        { id: 'c', name: 'procedures_delete', args: { id: 'p-00000001' } },
      ]),
      2: toolStep([{ id: 'd', name: 'procedures_stale', args: { id: 'p-00000001', step: 2 } }, { id: 'e', name: 'procedures_list', args: {} }]),
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
  ws = mkdtempSync(join(tmpdir(), 'procedures-engine-ws-'));
  notes = [];
  calls.length = 0;
  sdkBroken = false;
});

const reader = () => newAgent({ id: 'reader', permission: 'read', tracker: 'read', shell: 'none', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
const toolNames = (i: number): string[] => ((fake.chats()[i].body as Record<string, any>).tools as { function: { name: string } }[]).map((t) => t.function.name).sort();
const toolResults = (i: number): Record<string, string> => Object.fromEntries(((fake.chats()[i].body as Record<string, any>).messages as { role: string; tool_call_id: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m.content]));

describe('the open engine', () => {
  it('offers the four tools to a reading agent, runs them through the session, and answers an unknown tool as no tool of this agent', async () => {
    const s = session();
    const before = fake.chats().length;
    const r = await runAgent<{ fala: string }>({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, procedures: s.tools }, []);
    expect(r.data).toEqual({ fala: 'done' });
    expect(toolNames(before)).toEqual(expect.arrayContaining([...PROCEDURE_TOOL_NAMES]));
    expect(toolNames(before)).not.toContain('procedures_delete');
    const first = toolResults(before + 1);
    expect(first.a).toMatch(/^Saved p-00000001 at revision 1/);
    expect(first.b).toContain('Revision 1');
    expect(first.b).toContain('1. Start the stack');
    expect(first.c).not.toContain('Saved');
    expect(first.c).not.toContain('Revision');
    const second = toolResults(before + 2);
    expect(second.d).toContain('Marked p-00000001 as failing at step 2');
    expect(second.e).toContain('p-00000001 · repo · api · Run the end-to-end tests · failing');
    expect(s.finish('done')).toEqual([{ id: 'p-00000001', revision: 1, title: 'Run the end-to-end tests', outcome: 'failed' }]);
    expect(notes).toEqual(['runner.procedures.saved', 'runner.procedures.stale', 'runner.procedures.usedFailed']);
  });

  it('is not offered to a call that has no session of work', async () => {
    const before = fake.chats().length;
    await runAgent({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6 }, []);
    expect(toolNames(before).filter((n) => n.startsWith('procedures_'))).toEqual([]);
  });

  it('the one-turn wrap-up of a call that ran out of turns strips them with every other tool', async () => {
    const stuck = await fakeOpenAI((req) => (req.n <= 2 ? toolStep([{ id: `l${req.n}`, name: 'procedures_list', args: {} }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'partial' } }])));
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'stuck', kind: 'openai-compatible', baseUrl: stuck.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'reader', permission: 'read', tracker: 'read', shell: 'none', model: { role: null, provider: 'stuck', model: 'qwen3:8b' } });
      const r = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 2, wrapUp: true, procedures: session().tools }, []);
      expect(r.partial).toBe(true);
      const names = (i: number): string[] => ((stuck.chats()[i].body as Record<string, any>).tools as { function: { name: string } }[]).map((t) => t.function.name);
      expect(names(0)).toContain('procedures_list');
      const last = stuck.chats().length - 1;
      expect(last).toBeGreaterThanOrEqual(2);
      expect(names(last).filter((n) => n.startsWith('procedures_'))).toEqual([]);
    } finally {
      await stuck.close();
    }
  });

  it('a procedure-only call offers the procedure tools and no other: not the shell, not a runner tool, whatever the agent is allowed', async () => {
    const writer = newAgent({ id: 'writer', permission: 'worktree', tracker: 'read', shell: 'sandbox', allowedCommands: ['npm test'], model: { role: null, provider: 'local', model: 'qwen3:8b' } });
    const exec = { description: 'sandbox', exec: async () => ({ exitCode: 0, output: '', timedOut: false, ms: 1 }), log: [], close: async () => undefined } as never;
    const runnerTools = [{ name: 'SendMessage', description: 'x', parameters: { type: 'object', properties: {} }, run: async () => ({ response: '', render: () => '' }) }] as never;
    const s = session();
    const before = fake.chats().length;
    // the same call, with everything the stage has: it is offered the shell and the runner tool
    await runAgent({ agent: writer, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'writer', maxTurns: 3, procedures: s.tools, exec, runnerTools, release: async () => '', attachments: { thread: 't', refs: [] } }, []);
    expect(toolNames(before)).toEqual(expect.arrayContaining(['Shell', 'SendMessage']));
    const only = fake.chats().length;
    await runAgent({ agent: writer, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'writer', maxTurns: 3, procedures: s.tools, procedureOnly: true, exec, runnerTools, release: async () => '', attachments: { thread: 't', refs: [] } }, ['npm test']);
    expect(toolNames(only).filter((n) => n !== 'final_answer')).toEqual([...PROCEDURE_TOOL_NAMES].sort());
    // the system text carries no documentation index of the repository
    expect(JSON.stringify((fake.chats()[only].body as Record<string, any>).messages)).not.toContain('Shell');
  });

  it('a procedure-only call still reaches the handlers: a tool the model calls is answered', async () => {
    const own = await fakeOpenAI((req) => (req.n === 1 ? toolStep([{ id: 'a', name: 'procedures_save', args: record }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }])));
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'own', kind: 'openai-compatible', baseUrl: own.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'reader', permission: 'read', tracker: 'read', shell: 'none', model: { role: null, provider: 'own', model: 'qwen3:8b' } });
      const r = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 3, procedures: session().tools, procedureOnly: true }, []);
      expect(r.data).toEqual({ fala: 'done' });
      const results = ((own.chats()[1].body as Record<string, any>).messages as { role: string; tool_call_id: string; content: string }[]).filter((m) => m.role === 'tool');
      expect(results[0].content).toMatch(/^Saved p-00000001/);
    } finally {
      await own.close();
    }
  });

  it('the ToolImpls carry the schema of the table and cut a long answer', async () => {
    const tools: ProcedureTools = { list: async () => ({ text: 'x'.repeat(500) }), get: async () => ({ text: 'g' }), save: async () => ({ text: 's' }), stale: async () => ({ text: 't' }) };
    const impls = procedureToolImpls(tools);
    expect(impls.map((i) => i.name)).toEqual(PROCEDURE_TOOLS.map((t) => t.name));
    expect(impls.map((i) => i.parameters)).toEqual(PROCEDURE_TOOLS.map((t) => t.schema));
    const r = await impls[0].run({}, { outputMax: 100 } as never);
    expect(r.render(r.response).length).toBeLessThan(500);
  });
});

describe('the Claude Agent SDK server', () => {
  const handlerOf = (server: Record<string, any>, name: string) => server[PROCEDURES_MCP_SERVER].instance._registeredTools[name].handler as (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }>;

  it('is one in-process server named coxia_procedures with the same four tools, over the same handlers as the open engine', async () => {
    const seen: [string, unknown][] = [];
    const tools: ProcedureTools = {
      list: async (i) => (seen.push(['list', i]), { text: 'L' }),
      get: async (i) => (seen.push(['get', i]), { text: 'G' }),
      save: async (i) => (seen.push(['save', i]), { text: 'S' }),
      stale: async (i) => (seen.push(['stale', i]), { text: 'T' }),
    };
    const server = (await procedureMcpServer(tools)) as Record<string, any>;
    expect(Object.keys(server)).toEqual(['coxia_procedures']);
    expect(server.coxia_procedures.type).toBe('sdk');
    expect(Object.keys(server.coxia_procedures.instance._registeredTools)).toEqual(PROCEDURE_TOOL_NAMES);
    const impls = procedureToolImpls(tools);
    for (const name of PROCEDURE_TOOL_NAMES) {
      const viaSdk = await handlerOf(server, name)({ id: 'p-1' }, {});
      const viaOpen = await impls.find((i) => i.name === name)!.run({ id: 'p-1' }, { outputMax: 1000 } as never);
      expect(viaSdk.content[0].text).toBe(viaOpen.render(viaOpen.response));
    }
    expect(seen).toHaveLength(8);
    expect(PROCEDURE_TOOL_NAMES.map(procedureMcpToolName)).toEqual(PROCEDURE_TOOL_NAMES.map((n) => `mcp__coxia_procedures__${n}`));
  });

  it('is built when the SDK is loadable and null when it is not', async () => {
    const tools: ProcedureTools = { list: async () => ({ text: '' }), get: async () => ({ text: '' }), save: async () => ({ text: '' }), stale: async () => ({ text: '' }) };
    sdkBroken = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await procedureMcpServer(tools)).toBeNull();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('a reading agent is offered the server and its tool names, and a call without a session is not', async () => {
    const sdkReader = newAgent({ id: 'reader', permission: 'read' });
    await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, procedures: session().tools });
    expect(Object.keys(calls[0].options.mcpServers ?? {})).toContain('coxia_procedures');
    expect(calls[0].options.allowedTools).toEqual(expect.arrayContaining(PROCEDURE_TOOL_NAMES.map(procedureMcpToolName)));
    // the agent stays read-only: the app's tools are an addition to what it is allowed, not a way around it
    expect(calls[0].options.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write']));
    calls.length = 0;
    await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6 });
    expect(Object.keys(calls[0].options.mcpServers ?? {})).not.toContain('coxia_procedures');
    expect(calls[0].options.allowedTools.filter((n: string) => n.includes('procedures'))).toEqual([]);
  });

  it('a procedure-only call turns the built-in tools off and keeps the in-process server, allowed by name and nothing else', async () => {
    const writer = newAgent({ id: 'writer', permission: 'worktree', shell: 'sandbox', allowedCommands: ['npm test'] });
    const exec = { description: 'sandbox', exec: async () => ({ exitCode: 0, output: '', timedOut: false, ms: 1 }), log: [], close: async () => undefined } as never;
    const runnerTools = [{ name: 'SendMessage', description: 'x', parameters: { type: 'object', properties: {} }, run: async () => ({ response: '', render: () => '' }) }] as never;
    const confine = { root, hooks: {} } as never;
    await runAgent({ agent: writer, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'writer', maxTurns: 3, procedures: session().tools, procedureOnly: true, exec, runnerTools, confine, release: async () => '' }, ['npm test']);
    const o = calls[0].options;
    expect(o.tools).toEqual([]);
    expect(o.strictMcpConfig).toBe(true);
    expect(Object.keys(o.mcpServers)).toEqual(['coxia_procedures']);
    expect(o.allowedTools).toEqual(PROCEDURE_TOOL_NAMES.map(procedureMcpToolName));
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.maxTurns).toBe(3);
    expect(o.resume).toBeUndefined();
    // a call that is not procedure-only leaves the built-ins as they were
    calls.length = 0;
    await runAgent({ agent: writer, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'writer', maxTurns: 3, procedures: session().tools });
    expect(calls[0].options.tools).toBeUndefined();
    expect(calls[0].options.strictMcpConfig).toBeUndefined();
  });

  it('a server that cannot be built does not stop the call: the thread says the tools are not there, once', async () => {
    sdkBroken = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const sdkReader = newAgent({ id: 'reader', permission: 'read' });
      const s = session();
      const r = await runAgent<{ fala: string }>({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, procedures: s.tools });
      expect(r.data).toEqual({ fala: 'ok' });
      expect(Object.keys(calls[0].options.mcpServers ?? {})).not.toContain('coxia_procedures');
      expect(calls[0].options.allowedTools.filter((n: string) => n.includes('procedures'))).toEqual([]);
      await runAgent({ agent: sdkReader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reader', maxTurns: 6, procedures: s.tools });
      expect(notes).toEqual(['runner.procedures.unavailable']);
    } finally {
      log.mockRestore();
    }
  });
});
