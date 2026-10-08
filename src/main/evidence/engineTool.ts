import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import {
  ANNOTATE_IMAGE_DESCRIPTION,
  ANNOTATE_IMAGE_SCHEMA,
  ANNOTATE_IMAGE_TOOL,
  EVIDENCE_MCP_SERVER,
  SAVE_EVIDENCE_TOOL,
  saveEvidenceDescription,
  saveEvidenceSchema,
  type EvidenceTools,
  type ToolAnswer,
} from './tool';

// The evidence tools in the shapes the two engines take them: ToolImpls for the open engine, one in-process MCP server for the Claude Agent SDK. Both call
// the handlers the executor gave; a refusal comes back as text for the model, never as a crash.

const text = (a: ToolAnswer): { content: [{ type: 'text'; text: string }] } => ({ content: [{ type: 'text' as const, text: a.text }] });

export function evidenceToolImpls(tools: EvidenceTools, out?: string): ToolImpl[] {
  return [
    {
      name: SAVE_EVIDENCE_TOOL,
      description: out ? saveEvidenceDescription(out) : saveEvidenceDescription(),
      parameters: (out ? saveEvidenceSchema(out) : saveEvidenceSchema()) as unknown as Json,
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
  ];
}

/** The tool names the open engine must have allowed for the evidence tools to reach the model. */
export const EVIDENCE_TOOL_NAMES = [SAVE_EVIDENCE_TOOL, ANNOTATE_IMAGE_TOOL];

/** The two tools as one in-process MCP server; null when the SDK or zod cannot be loaded (the stage says so). */
export async function evidenceMcpServer(tools: EvidenceTools, out?: string): Promise<Record<string, unknown> | null> {
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
        sdk.tool(SAVE_EVIDENCE_TOOL, out ? saveEvidenceDescription(out) : saveEvidenceDescription(), { path: z.string(), title: z.string(), description: z.string().optional() }, async (args) => text(await tools.save(args))),
        sdk.tool(ANNOTATE_IMAGE_TOOL, ANNOTATE_IMAGE_DESCRIPTION, { source: z.string(), marks: z.array(mark), title: z.string().optional(), description: z.string().optional() }, async (args) => text(await tools.annotate(args))),
      ],
    });
    return { [EVIDENCE_MCP_SERVER]: server };
  } catch (e) {
    console.error('[evidence] the evidence tools are not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
