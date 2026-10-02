import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, ToolError, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import { VcsError } from './errors';
import { VCS_READ_DESCRIPTION, VCS_READ_OPS, VCS_READ_SCHEMA, runVcsRead } from './readTool';
import type { VcsProvider } from './types';

// The `VcsRead` app tool in the shapes the two engines take it: a ToolImpl for the open engine, an in-process MCP server for the Claude
// Agent SDK. Both call runVcsRead (read only) on the primary integration.

/** The name the open engine and its policy hooks know the tool by. */
export const VCS_READ_TOOL_NAME = 'VcsRead';
export const VCS_MCP_SERVER = 'coxia_vcs';
/** The name the Claude SDK knows it by, for allowedTools. */
export const VCS_MCP_TOOL_NAME = `mcp__${VCS_MCP_SERVER}__vcs_read`;

const message = (e: unknown): string => (e instanceof VcsError ? e.message : (e as Error).message.split('\n')[0]);

export function vcsReadToolImpl(provider: () => VcsProvider): ToolImpl {
  return {
    name: VCS_READ_TOOL_NAME,
    description: VCS_READ_DESCRIPTION,
    parameters: VCS_READ_SCHEMA as unknown as Json,
    async run(input, ctx) {
      try {
        const text = await runVcsRead(provider(), input);
        return { response: text, render: (r) => clip(String(r), ctx.outputMax) };
      } catch (e) {
        throw new ToolError(message(e));
      }
    },
  };
}

/**
 * The same tool as an in-process MCP server for the Claude Agent SDK. It needs zod (a peer dependency of the SDK) to describe the
 * input; when the SDK or zod cannot be loaded the answer is null and the agent runs without the tool.
 */
export async function vcsMcpServer(provider: () => VcsProvider): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const server = sdk.createSdkMcpServer({
      name: VCS_MCP_SERVER,
      tools: [
        sdk.tool('vcs_read', VCS_READ_DESCRIPTION, { op: z.enum(VCS_READ_OPS), project: z.string(), iid: z.number().int().positive() }, async (args) => {
          try {
            return { content: [{ type: 'text' as const, text: await runVcsRead(provider(), args) }] };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: message(e) }], isError: true };
          }
        }),
      ],
    });
    return { [VCS_MCP_SERVER]: server };
  } catch (e) {
    console.error('[vcs] the VcsRead tool is not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
