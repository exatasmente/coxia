import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import type { EvidenceTools } from '../evidence/tool';
import type { SandboxSession } from './session';
import { SHELL_DESCRIPTION, SHELL_MCP_SERVER, SHELL_SCHEMA, SHELL_TOOL_NAME, VIEW_IMAGE_TOOL_NAME, lookAtImage, offersViewImage, runShell, viewImageDescription, viewImageSchema } from './tool';

// The `Shell` tool in the shapes the two engines take it: a ToolImpl for the open engine, an in-process MCP server for the Claude Agent SDK. Both call runShell on the
// stage's session; the SDK's own Bash stays off for an agent that has a sandbox (it would be the unsandboxed way to run the same command).

export function shellToolImpl(session: SandboxSession): ToolImpl {
  return {
    name: SHELL_TOOL_NAME,
    activity: 'shell',
    description: session.description ?? SHELL_DESCRIPTION,
    parameters: SHELL_SCHEMA as unknown as Json,
    async run(input, ctx) {
      const text = await runShell(session, input);
      return { response: text, render: (r) => clip(String(r), ctx.outputMax) };
    },
  };
}

/** `ViewImage` for the open engine: the picture goes to the model the way an image `Read` does, after the tool results; a refusal is the text that says why. */
export function viewImageToolImpl(session: SandboxSession, evidence?: EvidenceTools | null, onLooked?: (path: string) => void): ToolImpl {
  return {
    name: VIEW_IMAGE_TOOL_NAME,
    activity: 'screen',
    description: viewImageDescription(!!evidence, session.gui?.out),
    parameters: viewImageSchema(!!evidence, session.gui?.out) as unknown as Json,
    async run(input, ctx) {
      const r = await lookAtImage(session, evidence, input);
      if (!r.ok) return { response: r.text, render: (x) => String(x) };
      if (r.looked) onLooked?.(r.looked);
      // A model the provider says takes no image is told so, as Read does.
      // i18n-ignore: tool result for the model: English by design
      if (ctx.seesImages && !ctx.seesImages()) return { response: `${r.path} is an image, and this model does not take images.`, render: (x) => String(x) };
      return {
        response: r.text ?? { type: 'image', file: { filePath: r.path, type: r.mediaType } },
        render: (x) => (r.text ? clip(String(x), ctx.outputMax) : `${r.path} (${r.mediaType})`),
        images: [{ path: r.path, mediaType: r.mediaType, data: r.data }],
      };
    },
  };
}

/** The same tool as an in-process MCP server; `evidence` is given when the stage keeps evidence, and the tool then also takes an evidence id. Null when the SDK or zod cannot be loaded (the agent then runs without it, and the stage says so). */
export async function shellMcpServer(session: SandboxSession, evidence?: EvidenceTools | null, onLooked?: (path: string) => void): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const server = sdk.createSdkMcpServer({
      name: SHELL_MCP_SERVER,
      tools: [
        sdk.tool(SHELL_TOOL_NAME, session.description ?? SHELL_DESCRIPTION, { command: z.string() }, async (args) => ({ content: [{ type: 'text' as const, text: await runShell(session, args) }] })),
        ...(offersViewImage(session, evidence)
          ? [
              sdk.tool(VIEW_IMAGE_TOOL_NAME, viewImageDescription(!!evidence, session.gui?.out), { source: z.string() }, async (args) => {
                const r = await lookAtImage(session, evidence, args);
                if (!r.ok) return { content: [{ type: 'text' as const, text: r.text }] };
                if (r.looked) onLooked?.(r.looked);
                const image = { type: 'image' as const, data: r.data, mimeType: r.mediaType };
                return { content: r.text ? [{ type: 'text' as const, text: r.text }, image] : [image] };
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
