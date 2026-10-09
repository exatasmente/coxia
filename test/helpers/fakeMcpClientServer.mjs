// A scripted MCP server over stdio for the client's tests: newline-delimited JSON-RPC, a tool list in two pages, and tools that misbehave in the ways a real one can.
import { createInterface } from 'node:readline';

const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const tool = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });

createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.method === 'notifications/cancelled') {
    process.stderr.write(`cancelled ${m.params.requestId}\n`);
    return;
  }
  if (m.method === 'initialize') {
    process.stdout.write('not json: a library printed this\n');
    // The server asks the client something before it answers: a ping must be answered, anything else refused.
    send({ jsonrpc: '2.0', id: 900, method: 'ping' });
    send({ jsonrpc: '2.0', id: 901, method: 'roots/list' });
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-browser', version: '1' } } });
  }
  if (m.method === 'tools/list') {
    return m.params?.cursor ? send({ jsonrpc: '2.0', id: m.id, result: { tools: [tool('second')] } }) : send({ jsonrpc: '2.0', id: m.id, result: { tools: [tool('first')], nextCursor: 'p2' } });
  }
  if (m.method === 'tools/call') {
    const { name, arguments: args } = m.params;
    if (name === 'echo') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(args) }] } });
    if (name === 'fail') return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'bad argument' } });
    if (name === 'soft') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'it did not work' }], isError: true } });
    if (name === 'noisy') {
      process.stderr.write('x'.repeat(10_000) + 'THE END');
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [] } });
    }
    if (name === 'crash') {
      process.stderr.write('browser could not start');
      return setTimeout(() => process.exit(3), 20);
    }
    if (name === 'huge') return process.stdout.write('y'.repeat(2 * 1024 * 1024));
    // 'hang' and anything else: never answered.
  }
});
