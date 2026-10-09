import { applyWorkspaceLanguage, stateTools, type StateTool, type TextResult } from './tools';
import { MCP_SERVER_NAME } from './entry';
import { t } from '../../shared/i18n';

// The framing is the app's own as an MCP client: newline-delimited JSON-RPC 2.0 over stdio (src/main/engine/open/tools/mcp.ts), protocol
// 2024-11-05, `tools/list` answering `inputSchema` JSON-schema objects, `tools/call` answering `{ content: [...], isError }` — the shapes
// `McpClient` sends and parses. A line that is not a message is ignored, like the client does with a log line. Standard input and output only:
// nothing listens on the network, and a notification never wakes a write (there is no write), because there is no write.
//
// The workspace resolves here, once, and its language words the descriptions from then on; every tool call re-resolves it from the files, so an
// opt-in turned off (or a registry that moved) stops being served mid-session.

const UNKNOWN_METHOD = -32601;

type Incoming = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };

function resultOf(text: TextResult): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text: text.text }], ...(text.isError ? { isError: true } : {}) };
}

function answerOf(msg: Incoming, tools: Map<string, StateTool>): { result?: unknown; error?: { code: number; message: string } } {
  const method = typeof msg.method === 'string' ? msg.method : '';
  if (method === 'initialize') {
    return { result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: MCP_SERVER_NAME, version: '0.9.0' } } };
  }
  if (method === 'tools/list') {
    return { result: { tools: [...tools.values()].map((tl) => ({ name: tl.name, description: tl.description, inputSchema: tl.inputSchema })) } };
  }
  if (method === 'tools/call') {
    const name = typeof msg.params?.name === 'string' ? msg.params.name : '';
    const tool = tools.get(name);
    // A tool that does not exist is an answer with an error text, never a fallthrough to another read; a write-shaped name finds no tool at all.
    if (!tool) return { result: resultOf({ text: t('main.mcpstate.unknownTool', { name: name.slice(0, 60) }), isError: true }) };
    return { result: resultOf(tool.run((msg.params?.arguments ?? {}) as never)) };
  }
  if (method.startsWith('notifications/')) return {};
  return { error: { code: UNKNOWN_METHOD, message: t('main.mcpstate.unknownMethod', { method: method.slice(0, 60) }) } };
}

/** Serves one session: each line of `input` is a JSON-RPC request, each answer a line of `output`. Malformed lines are ignored. */
export async function serve(
  input: AsyncIterable<string | Uint8Array>,
  output: { write(chunk: string): unknown },
  env: NodeJS.ProcessEnv = process.env,
  makeTools: (env: NodeJS.ProcessEnv) => StateTool[] = stateTools,
): Promise<void> {
  applyWorkspaceLanguage(env);
  const tools = new Map(makeTools(env).map((tl) => [tl.name, tl]));
  let buf = '';
  for await (const chunk of input) {
    buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: Incoming | null = null;
      try {
        msg = JSON.parse(line) as Incoming;
      } catch {
        continue;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string' || msg.id === undefined || msg.id === null) continue;
      const { result, error } = answerOf(msg, tools);
      const reply: { jsonrpc: string; id: unknown; result?: unknown; error?: { code: number; message: string } } = { jsonrpc: '2.0', id: msg.id };
      if (error) reply.error = error;
      else reply.result = result;
      output.write(`${JSON.stringify(reply)}\n`);
    }
  }
}
