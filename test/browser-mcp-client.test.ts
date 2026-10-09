import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { McpError, type McpClient, spawnMcp } from '../src/main/browser/mcpClient';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'fakeMcpClientServer.mjs');

const open: { client: McpClient; pid?: number }[] = [];
function start(options: { timeoutMs?: number; lineMax?: number; stderrMax?: number } = {}) {
  const s = spawnMcp({ command: process.execPath, args: [SERVER], env: { PATH: process.env.PATH ?? '' }, cwd: dirname(SERVER), client: options });
  open.push({ client: s.client, pid: s.child.pid });
  return s.client;
}
afterEach(async () => {
  for (const o of open.splice(0)) await o.client.close();
});

describe('the MCP client', () => {
  it('shakes hands, answers what the server asks, lists every page of the tools and calls one', async () => {
    const c = start();
    // The server prints a line that is not a message before it answers: it is skipped, and its own requests are answered (ping) or refused (anything else).
    expect(await c.initialize()).toEqual({ server: 'fake-browser', protocol: '2025-06-18' });
    expect((await c.listTools()).map((t) => t.name)).toEqual(['first', 'second']);
    const r = await c.callTool('echo', { a: 1, b: 'two' });
    expect(r.content).toEqual([{ type: 'text', text: '{"a":1,"b":"two"}' }]);
    expect(r.isError).toBeUndefined();
  });

  it('tells an error the server reports from one the tool reports', async () => {
    const c = start();
    await c.initialize();
    await expect(c.callTool('fail', {})).rejects.toMatchObject({ code: 'rpc', rpcCode: -32602, message: 'bad argument' });
    expect(await c.callTool('soft', {})).toMatchObject({ isError: true });
  });

  it('gives up on a call that is not answered, and tells the server it was cancelled', async () => {
    const c = start({ timeoutMs: 150 });
    await c.initialize();
    await expect(c.callTool('hang', {})).rejects.toMatchObject({ code: 'timeout' });
    // The next call goes through: one lost answer does not spoil the connection.
    expect((await c.callTool('echo', { x: 1 })).content).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(c.stderrTail()).toContain('cancelled');
  });

  it('stops a call when its signal is aborted', async () => {
    const c = start();
    await c.initialize();
    const ac = new AbortController();
    const p = c.callTool('hang', {}, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    await expect(c.callTool('echo', {}, { signal: ac.signal })).rejects.toMatchObject({ code: 'aborted' });
  });

  it('keeps only the end of the standard error', async () => {
    const c = start({ stderrMax: 200 });
    await c.initialize();
    await c.callTool('noisy', {});
    await new Promise((r) => setTimeout(r, 50));
    const tail = c.stderrTail();
    expect(tail.length).toBeLessThanOrEqual(200);
    expect(tail.endsWith('THE END')).toBe(true);
  });

  it('fails what waits when the server dies, says why, and refuses new calls', async () => {
    const c = start();
    await c.initialize();
    let told = 0;
    c.onClose(() => told++);
    await expect(c.callTool('crash', {})).rejects.toBeInstanceOf(McpError);
    expect(c.closed).toBe(true);
    expect(told).toBe(1);
    expect(c.stderrTail()).toContain('browser could not start');
    await expect(c.callTool('echo', {})).rejects.toMatchObject({ code: 'closed' });
    // A listener added after the end is told at once.
    c.onClose(() => told++);
    expect(told).toBe(2);
  });

  it('ends the connection on a message longer than it takes', async () => {
    const c = start({ lineMax: 100_000 });
    await c.initialize();
    await expect(c.callTool('huge', {})).rejects.toMatchObject({ code: 'protocol' });
    expect(c.closed).toBe(true);
  });

  it('close() is idempotent and ends the process', async () => {
    const s = spawnMcp({ command: process.execPath, args: [SERVER], env: { PATH: process.env.PATH ?? '' }, cwd: dirname(SERVER), detached: true });
    await s.client.initialize();
    await s.client.close();
    await s.client.close();
    await new Promise<void>((resolve) => (s.child.exitCode !== null || s.child.signalCode ? resolve() : s.child.once('exit', () => resolve())));
    expect(s.child.exitCode !== null || s.child.signalCode !== null).toBe(true);
  });
});
