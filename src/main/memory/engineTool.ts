import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import { MEMORY_MCP_SERVER, MEMORY_READ_TOOL, MEMORY_LIST_TOOL, memoryToolSpecs, type MemoryAnswer, type MemoryTools } from './tools';

// The memory tools in the shapes the two engines take them: ToolImpls for the open engine, one in-process MCP server for the Claude Agent SDK. Both call the same handlers the
// session gave; a refusal comes back as text for the model, never as a crash.

const handlers = (tools: MemoryTools): Record<string, (input: unknown) => Promise<MemoryAnswer>> => ({
  memory_list: (input) => tools.list(input),
  memory_read: (input) => tools.read(input),
  // Only offered to a session that writes (`memoryToolSpecs`); a call that reaches them anyway is told so, as text.
  memory_save: (input) => (tools.save ? tools.save(input) : Promise.resolve({ text: 'This call cannot write to the memory.' })),
  memory_remove: (input) => (tools.remove ? tools.remove(input) : Promise.resolve({ text: 'This call cannot write to the memory.' })),
});

/**
 * The tools as engine-neutral ToolImpls. The two reads carry the `explore` activity, so every kind of sub-agent can read the memory and the turn that follows a read runs on the
 * explore list of a `switch` pool; the two writes carry none and are `principalOnly`: only the agent whose folder it is writes into it.
 */
export function memoryToolImpls(tools: MemoryTools): ToolImpl[] {
  const run = handlers(tools);
  return memoryToolSpecs(tools).map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.schema as unknown as Json,
    ...(spec.name === MEMORY_LIST_TOOL || spec.name === MEMORY_READ_TOOL ? { activity: 'explore' as const } : { principalOnly: true as const }),
    async run(input, ctx) {
      const a = await run[spec.name](input);
      return { response: a.text, render: (r) => clip(String(r), ctx.outputMax) };
    },
  }));
}

/**
 * The tools as one in-process MCP server; null when the SDK or zod cannot be loaded (the call goes on with the list in its prompt, and the thread says the tools are not
 * there). The shape of each property is `z.unknown()`: the app validates, so a wrong input is answered in the app's words and not by a schema error.
 */
export async function memoryMcpServer(tools: MemoryTools): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const run = handlers(tools);
    const made = memoryToolSpecs(tools).map((spec) => {
      const props = (spec.schema as { properties: Record<string, { description?: string }> }).properties;
      const shape = Object.fromEntries(Object.entries(props).map(([name, p]) => [name, p.description ? z.unknown().describe(p.description) : z.unknown()]));
      return sdk.tool(spec.name, spec.description, shape, async (args: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: (await run[spec.name](args)).text }] }));
    });
    return { [MEMORY_MCP_SERVER]: sdk.createSdkMcpServer({ name: MEMORY_MCP_SERVER, tools: made }) };
  } catch (e) {
    console.error('[memory] the memory tools are not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}

/**
 * The Claude SDK's PreToolUse hook for the write tools: a call made from inside a sub-agent (the hook input carries `agent_id`) is refused, so only the principal writes into its
 * own folder. Whether the SDK's built-in sub-agent reaches an in-process tool at all, and whether it fires this hook for it, is not verified; the plan relies on neither.
 */
export const memorySubagentGuard: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse' || !input.agent_id) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Only the agent whose folder it is writes into the memory; a sub-agent reads. Give the finding to the agent that called you.',
    },
  };
};
