import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import type { SandboxSession } from './session';
import { SHELL_DESCRIPTION, SHELL_MCP_SERVER, SHELL_SCHEMA, SHELL_TOOL_NAME, runShell } from './tool';

// The `Shell` tool in the shapes the two engines take it: a ToolImpl for the open engine, an in-process MCP server for the Claude Agent SDK. Both call runShell on the
// stage's session; the SDK's own Bash stays off for an agent that has a sandbox (it would be the unsandboxed way to run the same command).

export function shellToolImpl(session: SandboxSession): ToolImpl {
  return {
    name: SHELL_TOOL_NAME,
    description: SHELL_DESCRIPTION,
    parameters: SHELL_SCHEMA as unknown as Json,
    async run(input, ctx) {
      const text = await runShell(session, input);
      return { response: text, render: (r) => clip(String(r), ctx.outputMax) };
    },
  };
}

/** The same tool as an in-process MCP server; null when the SDK or zod cannot be loaded (the agent then runs without it, and the stage says so). */
export async function shellMcpServer(session: SandboxSession): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const server = sdk.createSdkMcpServer({
      name: SHELL_MCP_SERVER,
      tools: [sdk.tool(SHELL_TOOL_NAME, SHELL_DESCRIPTION, { command: z.string() }, async (args) => ({ content: [{ type: 'text' as const, text: await runShell(session, args) }] }))],
    });
    return { [SHELL_MCP_SERVER]: server };
  } catch (e) {
    console.error('[sandbox] the Shell tool is not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
