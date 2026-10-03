import { RELEASE_BRANCHES, RELEASE_CHANNELS, RELEASE_MCP_SERVER, RELEASE_OPS, RELEASE_TOOL_DESCRIPTION, RELEASE_TOOL_NAME, RELEASE_TOOL_SCHEMA } from '../shared/release';
import { loadClaudeSdkModule } from './claudeSdk';
import { type ToolImpl, ToolError, clip } from './engine/open/tools/types';
import type { Json } from './engine/open/types';

// The `ReleaseAction` app tool in the shapes the two engines take it: a ToolImpl for the open engine, an in-process MCP server for the Claude Agent SDK. The tool
// proposes (or, for an autonomous agent, asks the app to do) one step of the release the run is about; the handler it is given is the runner's, which judges the step
// again. The schema allows the six steps and a version: no path, no flag, no command.

/** What a call of the tool does: the answer is the text the model is told. */
export type ReleaseHandler = (input: unknown) => Promise<string>;

/** A step may take minutes (a beta runs the checks of CI): while it does, the stage is told the agent is alive, so the idle limit does not stop it. */
export function keepAlive(handler: ReleaseHandler, beat?: () => void): ReleaseHandler {
  return async (input) => {
    const timer = setInterval(() => beat?.(), 20_000);
    try {
      return await handler(input);
    } finally {
      clearInterval(timer);
    }
  };
}

const message = (e: unknown): string => (e as Error).message.split('\n')[0];

export function releaseToolImpl(handler: ReleaseHandler): ToolImpl {
  return {
    name: RELEASE_TOOL_NAME,
    description: RELEASE_TOOL_DESCRIPTION,
    parameters: RELEASE_TOOL_SCHEMA as unknown as Json,
    async run(input, ctx) {
      try {
        const text = await handler(input);
        return { response: text, render: (r) => clip(String(r), ctx.outputMax) };
      } catch (e) {
        throw new ToolError(message(e));
      }
    },
  };
}

/** The same tool as an in-process MCP server; null (the agent runs without it) when the SDK or zod cannot be loaded. */
export async function releaseMcpServer(handler: ReleaseHandler): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const server = sdk.createSdkMcpServer({
      name: RELEASE_MCP_SERVER,
      tools: [
        sdk.tool(
          'release_action',
          RELEASE_TOOL_DESCRIPTION,
          { op: z.enum(RELEASE_OPS), version: z.string(), pr: z.number().int().positive().optional(), head: z.string().optional(), from: z.string().optional(), branch: z.enum(RELEASE_BRANCHES).optional(), channel: z.enum(RELEASE_CHANNELS).optional() },
          async (args) => {
            try {
              return { content: [{ type: 'text' as const, text: await handler(args) }] };
            } catch (e) {
              return { content: [{ type: 'text' as const, text: message(e) }], isError: true };
            }
          },
        ),
      ],
    });
    return { [RELEASE_MCP_SERVER]: server };
  } catch (e) {
    console.error('[release] the ReleaseAction tool is not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
