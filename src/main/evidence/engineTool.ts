import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import {
  ANNOTATE_IMAGE_DESCRIPTION,
  ANNOTATE_IMAGE_SCHEMA,
  ANNOTATE_IMAGE_TOOL,
  EVIDENCE_MCP_SERVER,
  SAVE_EVIDENCE_DESCRIPTION,
  SAVE_EVIDENCE_SCHEMA,
  SAVE_EVIDENCE_TOOL,
  VIEW_IMAGE_DESCRIPTION,
  VIEW_IMAGE_SCHEMA,
  VIEW_IMAGE_TOOL,
  type EvidenceTools,
  type ToolAnswer,
} from './tool';

// The three evidence tools in the shapes the two engines take them: ToolImpls for the open engine, one in-process MCP server for the Claude Agent SDK. Both call
// the handlers the executor gave; a refusal comes back as text for the model, never as a crash. `ViewImage` returns the image itself: the open engine sends it in a
// message after the tool results (`images`), the SDK as an image block.

const text = (a: ToolAnswer): { content: [{ type: 'text'; text: string }] } => ({ content: [{ type: 'text' as const, text: a.text }] });

export function evidenceToolImpls(tools: EvidenceTools): ToolImpl[] {
  return [
    {
      name: SAVE_EVIDENCE_TOOL,
      description: SAVE_EVIDENCE_DESCRIPTION,
      parameters: SAVE_EVIDENCE_SCHEMA as unknown as Json,
      async run(input, ctx) {
        const a = await tools.save(input);
        return { response: a.text, render: (r) => clip(String(r), ctx.outputMax) };
      },
    },
    {
      name: ANNOTATE_IMAGE_TOOL,
      description: ANNOTATE_IMAGE_DESCRIPTION,
      parameters: ANNOTATE_IMAGE_SCHEMA as unknown as Json,
      async run(input, ctx) {
        const a = await tools.annotate(input);
        return { response: a.text, render: (r) => clip(String(r), ctx.outputMax) };
      },
    },
    {
      name: VIEW_IMAGE_TOOL,
      description: VIEW_IMAGE_DESCRIPTION,
      parameters: VIEW_IMAGE_SCHEMA as unknown as Json,
      async run(input, ctx) {
        const a = await tools.view(input);
        // The same delivery as the sandbox's ViewImage: the loop sends the picture in a message of its own after the tool results, unless the model takes no images.
        const source = typeof (input as { source?: unknown } | null)?.source === 'string' ? (input as { source: string }).source : 'image';
        const sees = !ctx.seesImages || ctx.seesImages();
        const images = a.image && sees ? [{ path: source, mediaType: a.image.media, data: Buffer.from(a.image.data).toString('base64') }] : [];
        return { response: a.text, render: (r) => clip(String(r), ctx.outputMax), ...(images.length ? { images } : {}) };
      },
    },
  ];
}

/** The tool names the open engine must have allowed for the evidence tools to reach the model. */
export const EVIDENCE_TOOL_NAMES = [SAVE_EVIDENCE_TOOL, ANNOTATE_IMAGE_TOOL, VIEW_IMAGE_TOOL];

/** The three tools as one in-process MCP server; null when the SDK or zod cannot be loaded (the stage says so). */
export async function evidenceMcpServer(tools: EvidenceTools): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const mark = z.object({
      kind: z.enum(['rectangle', 'arrow', 'ellipse', 'label', 'marker', 'blur']),
      color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white']),
      width: z.number().optional(),
      x: z.number(),
      y: z.number(),
      w: z.number().optional(),
      h: z.number().optional(),
      x2: z.number().optional(),
      y2: z.number().optional(),
      rx: z.number().optional(),
      ry: z.number().optional(),
      text: z.string().optional(),
      n: z.number().optional(),
    });
    const server = sdk.createSdkMcpServer({
      name: EVIDENCE_MCP_SERVER,
      tools: [
        sdk.tool(SAVE_EVIDENCE_TOOL, SAVE_EVIDENCE_DESCRIPTION, { path: z.string(), title: z.string(), description: z.string().optional() }, async (args) => text(await tools.save(args))),
        sdk.tool(ANNOTATE_IMAGE_TOOL, ANNOTATE_IMAGE_DESCRIPTION, { source: z.string(), marks: z.array(mark), title: z.string().optional(), description: z.string().optional() }, async (args) => text(await tools.annotate(args))),
        sdk.tool(VIEW_IMAGE_TOOL, VIEW_IMAGE_DESCRIPTION, { source: z.string() }, async (args) => {
          const a = await tools.view(args);
          return a.image ? { content: [{ type: 'text' as const, text: a.text }, { type: 'image' as const, data: Buffer.from(a.image.data).toString('base64'), mimeType: a.image.media }] } : text(a);
        }),
      ],
    });
    return { [EVIDENCE_MCP_SERVER]: server };
  } catch (e) {
    console.error('[evidence] the evidence tools are not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
