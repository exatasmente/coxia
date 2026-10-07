import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import type { SandboxSession } from './session';
import { SHELL_DESCRIPTION, SHELL_MCP_SERVER, SHELL_SCHEMA, SHELL_TOOL_NAME, VIEW_IMAGE_DESCRIPTION, VIEW_IMAGE_SCHEMA, VIEW_IMAGE_TOOL_NAME, imageRefusal, offersViewImage, runShell, viewImage } from './tool';

// The `Shell` tool in the shapes the two engines take it: a ToolImpl for the open engine, an in-process MCP server for the Claude Agent SDK. Both call runShell on the
// stage's session; the SDK's own Bash stays off for an agent that has a sandbox (it would be the unsandboxed way to run the same command).

export function shellToolImpl(session: SandboxSession): ToolImpl {
  return {
    name: SHELL_TOOL_NAME,
    description: session.description ?? SHELL_DESCRIPTION,
    parameters: SHELL_SCHEMA as unknown as Json,
    async run(input, ctx) {
      const text = await runShell(session, input);
      return { response: text, render: (r) => clip(String(r), ctx.outputMax) };
    },
  };
}

/** `ViewImage` for the open engine: the picture goes to the model the way an image `Read` does, after the tool results; a refusal is the text that says why. */
export function viewImageToolImpl(session: SandboxSession): ToolImpl {
  return {
    name: VIEW_IMAGE_TOOL_NAME,
    description: VIEW_IMAGE_DESCRIPTION,
    parameters: VIEW_IMAGE_SCHEMA as unknown as Json,
    async run(input, ctx) {
      const r = viewImage(session, input);
      if (!r.ok) return { response: imageRefusal(r), render: (x) => String(x) };
      // A model the provider says takes no image is told so, as Read does.
      // i18n-ignore: tool result for the model: English by design
      if (ctx.seesImages && !ctx.seesImages()) return { response: `${r.path} is an image, and this model does not take images.`, render: (x) => String(x) };
      return { response: { type: 'image', file: { filePath: r.path, type: r.mediaType } }, render: () => `${r.path} (${r.mediaType})`, images: [{ path: r.path, mediaType: r.mediaType, data: r.data }] };
    },
  };
}

/** The same tool as an in-process MCP server (`withViewImage` off when the stage's evidence tools bring their own `ViewImage`); null when the SDK or zod cannot be loaded (the agent then runs without it, and the stage says so). */
export async function shellMcpServer(session: SandboxSession, withViewImage = true): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const server = sdk.createSdkMcpServer({
      name: SHELL_MCP_SERVER,
      tools: [
        sdk.tool(SHELL_TOOL_NAME, session.description ?? SHELL_DESCRIPTION, { command: z.string() }, async (args) => ({ content: [{ type: 'text' as const, text: await runShell(session, args) }] })),
        ...(withViewImage && offersViewImage(session)
          ? [
              sdk.tool(VIEW_IMAGE_TOOL_NAME, VIEW_IMAGE_DESCRIPTION, { path: z.string() }, async (args) => {
                const r = viewImage(session, args);
                return { content: [r.ok ? { type: 'image' as const, data: r.data, mimeType: r.mediaType } : { type: 'text' as const, text: imageRefusal(r) }] };
              }),
            ]
          : []),
      ],
    });
    return { [SHELL_MCP_SERVER]: server };
  } catch (e) {
    console.error('[sandbox] the Shell tool is not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
