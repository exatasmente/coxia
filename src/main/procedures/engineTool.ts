import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import { PROCEDURES_MCP_SERVER, procedureToolSpecs, type ProcedureAnswer, type ProcedureTools } from './tools';

// The procedure tools in the shapes the two engines take them: ToolImpls for the open engine, one in-process MCP server for the Claude Agent SDK. Both call the same
// handlers the session gave; a refusal comes back as text for the model, never as a crash.

const handlers = (tools: ProcedureTools): Record<string, (input: unknown) => Promise<ProcedureAnswer>> => ({
  procedures_list: (input) => tools.list(input),
  procedures_get: (input) => tools.get(input),
  procedures_save: (input) => tools.save(input),
  procedures_stale: (input) => tools.stale(input),
  // Only offered when the call has the app's browser or its shell (`procedureToolSpecs`); a call that reaches it anyway is told so, as text.
  procedures_draft: (input) => (tools.draft ? tools.draft(input) : Promise.resolve({ text: 'There is no draft in this call: it has no browser of the app and no shell.' })),
});

export function procedureToolImpls(tools: ProcedureTools): ToolImpl[] {
  const run = handlers(tools);
  return procedureToolSpecs(tools).map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.schema as unknown as Json,
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
export async function procedureMcpServer(tools: ProcedureTools): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const run = handlers(tools);
    const made = procedureToolSpecs(tools).map((spec) => {
      const props = (spec.schema as { properties: Record<string, { description?: string }> }).properties;
      const shape = Object.fromEntries(Object.entries(props).map(([name, p]) => [name, p.description ? z.unknown().describe(p.description) : z.unknown()]));
      return sdk.tool(spec.name, spec.description, shape, async (args: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: (await run[spec.name](args)).text }] }));
    });
    return { [PROCEDURES_MCP_SERVER]: sdk.createSdkMcpServer({ name: PROCEDURES_MCP_SERVER, tools: made }) };
  } catch (e) {
    console.error('[procedures] the procedure tools are not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
