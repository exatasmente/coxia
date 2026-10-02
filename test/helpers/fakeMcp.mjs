// A tiny MCP server over stdio for tests: newline-delimited JSON-RPC, three tools.
import { createInterface } from 'node:readline';

const tools = [
  { name: 'echo', description: 'Echoes the text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'get_merge_request_details_and_changes_with_a_very_long_name_for_mapping', description: 'Long name', inputSchema: { type: 'object', properties: { iid: { type: 'integer' } }, required: ['iid'] } },
  { name: 'dangerous_write', description: 'Writes something', inputSchema: { type: 'object', properties: {} } },
  { name: 'boom', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
];

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') return reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
  if (msg.method === 'tools/list') return reply(msg.id, { tools });
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'boom') return reply(msg.id, { content: [{ type: 'text', text: 'it blew up' }], isError: true });
    if (name === 'echo') return reply(msg.id, { content: [{ type: 'text', text: `echo: ${args.text}` }] });
    return reply(msg.id, { content: [{ type: 'text', text: `called ${name} ${JSON.stringify(args)}` }] });
  }
});
