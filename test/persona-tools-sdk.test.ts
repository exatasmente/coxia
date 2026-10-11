// The persona's tools on the Claude engine (#248): the same eleven names as the open engine, as the in-process server `runner`; every field loose but described; a PreToolUse guard
// that refuses a sub-agent's call (the SDK has no `principalOnly`); a failure of the door comes back as a tool error. The SDK is replaced by a script: this pins what the app hands
// it. What the real SDK does with these (the hook fires for a sub-agent's call with `agent_id` set and a denial keeps the handler from running; a call that is aborted while a
// handler is pending leaves the handler running; a declared enum is enforced by the SDK and a loose field is not) was checked once by hand outside the suite (3_IMPLEMENTATION.md).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Options = Record<string, any>;
const calls: { prompt: unknown; options: Options }[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: unknown; options: Options }) => {
    calls.push({ prompt, options });
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's1' };
      yield { type: 'result', subtype: 'success', session_id: 's1', result: 'ok' };
    })();
  },
  tool: (name: string, description: string, shape: Record<string, { description?: string }>, handler: (args: Record<string, unknown>) => Promise<unknown>) => ({ name, description, shape, handler }),
  createSdkMcpServer: ({ name, tools }: { name: string; tools: unknown[] }) => ({ type: 'sdk', name, tools }),
}));

import { runAgent } from '../src/main/agents';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { TOOL_NAMES } from '../src/main/persona/doorTable';
import { personaToolImpls } from '../src/main/persona/tools';
import { ARG_DOCS } from '../src/main/persona/toolDocs';
import { createSession } from '../src/main/persona/session';
import { ToolError } from '../src/main/engine/open/tools/types';
import { installEnvSecret } from './helpers/config';

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(async () => {
  calls.length = 0;
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], kind: 'anthropic', baseUrl: 'https://api.anthropic.com', id: 'llm-target' }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const agent = newAgent({ id: 'me', permission: 'read' });
const session = () => createSession({ persona: 'me', thread: 'agent-me', seq: 1, door: 'window' });

async function offered(door: Parameters<typeof personaToolImpls>[0]) {
  await runAgent({ agent, prompt: 'hello', system: 'sys', cwd: '/tmp', label: 'me', maxTurns: 5, runnerTools: personaToolImpls(door, session()) });
  return calls[0].options;
}

describe('the eleven tools on the Claude engine', () => {
  it('are given the names the open engine gives, as the in-process server runner, and allowed', async () => {
    const options = await offered({ run: async () => 'ok', finish: () => undefined });
    const server = options.mcpServers.runner as { tools: { name: string }[] };
    expect(server.tools.map((x) => x.name)).toEqual([...TOOL_NAMES]);
    for (const name of TOOL_NAMES) expect(options.allowedTools, name).toContain(`mcp__runner__${name}`);
  });

  it('keep every field loose, so the app and not the SDK answers a wrong input, and describe each one for the model', async () => {
    const options = await offered({ run: async () => 'ok', finish: () => undefined });
    const tools = (options.mcpServers.runner as { tools: { name: string; shape: Record<string, { description?: string; safeParse: (v: unknown) => { success: boolean } }> }[] }).tools;
    const runs = tools.find((x) => x.name === 'Runs')!;
    expect(Object.keys(runs.shape)).toEqual(expect.arrayContaining(['op', 'why', 'run', 'action']));
    expect(runs.shape.op.description).toBe(ARG_DOCS.op);
    expect(runs.shape.run.description).toBe(ARG_DOCS.run);
    expect(runs.shape.action.description).toBeUndefined();
    // an op that is not in the enum is the door's to answer, in its own words: the SDK lets it through
    expect(runs.shape.op.safeParse('resume').success).toBe(true);
    expect(runs.shape.run.safeParse(5).success).toBe(true);
  });

  it('run the door with the answer\'s session and return its text, and a failure of the door as a tool error the model reads', async () => {
    const seen: string[] = [];
    const door = {
      run: async (s: { thread: string }, tool: string, input: Record<string, unknown>) => {
        seen.push(`${s.thread}:${tool}:${String(input.op)}`);
        if (input.op === 'resume') throw new ToolError("Stopping and resuming the persona are the person's.");
        return 'Done.';
      },
      finish: () => undefined,
    };
    const options = await offered(door);
    const runs = (options.mcpServers.runner as { tools: { name: string; handler: (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }> }[] }).tools.find((x) => x.name === 'Runs')!;
    expect(await runs.handler({ op: 'cancel', run: 'r1', why: 'x' })).toEqual({ content: [{ type: 'text', text: 'Done.' }] });
    const refused = await runs.handler({ op: 'resume' });
    expect(refused).toMatchObject({ isError: true, content: [{ text: "Stopping and resuming the persona are the person's." }] });
    expect(seen).toEqual(['agent-me:Runs:cancel', 'agent-me:Runs:resume']);
  });

  it('are guarded from a sub-agent: a PreToolUse hook that matches every one of them and refuses a call that carries agent_id', async () => {
    const options = await offered({ run: async () => 'ok', finish: () => undefined });
    const entry = (options.hooks.PreToolUse as { matcher: string; hooks: ((input: Record<string, unknown>) => Promise<Record<string, any>>)[] }[]).find((h) => h.matcher.includes('mcp__runner__Settings'));
    expect(entry).toBeDefined();
    const matched = (entry?.matcher ?? '').split('|');
    for (const name of TOOL_NAMES) expect(matched, name).toContain(`mcp__runner__${name}`);
    const guard = entry!.hooks[0];
    // the principal's call passes
    expect(await guard({ hook_event_name: 'PreToolUse', tool_name: 'mcp__runner__Settings', tool_input: {} })).toEqual({});
    // a sub-agent's call is denied before the handler runs
    const denied = await guard({ hook_event_name: 'PreToolUse', tool_name: 'mcp__runner__Settings', tool_input: {}, agent_id: 'a41d1625bd455bf22' });
    expect(denied.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    // any other hook event is none of its business
    expect(await guard({ hook_event_name: 'PostToolUse', agent_id: 'x' })).toEqual({});
  });
});
