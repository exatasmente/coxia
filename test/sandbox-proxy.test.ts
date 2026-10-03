import { type Server, type Socket, connect, createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ProxyDecision, type RegistryProxy, createRegistryProxy } from '../src/main/sandbox/proxy';

// The proxy over a real Unix socket, with a local server standing in for the registry: nothing here leaves the machine.

let dir: string;
let upstream: Server;
let upstreamPort: number;
let proxy: RegistryProxy | null = null;
const decisions: ProxyDecision[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-proxy-'));
  decisions.length = 0;
  upstream = createServer((c) => c.on('data', (d) => c.write(`echo:${d}`)));
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = (upstream.address() as { port: number }).port;
});
afterEach(async () => {
  await proxy?.close();
  proxy = null;
  upstream.close();
  rmSync(dir, { recursive: true, force: true });
});

const start = (over: Partial<Parameters<typeof createRegistryProxy>[0]> = {}) =>
  createRegistryProxy({
    socketPath: join(dir, 'p.sock'),
    hosts: ['registry.example.com'],
    onDecision: (d) => decisions.push(d),
    resolve: async (h) => (h === 'registry.example.com' ? ['93.184.216.34'] : h === 'sneaky.example.com' ? ['93.184.216.34', '127.0.0.1'] : ['10.0.0.9']),
    // Whatever the name resolved to, the stand-in is what answers.
    open: () => connect({ host: '127.0.0.1', port: upstreamPort }),
    ...over,
  });

/** Sends a request through the proxy's socket and returns everything it answered until it closed or `until` showed up. */
function ask(request: string, until?: string, after?: string): Promise<string> {
  return new Promise((resolve) => {
    const s: Socket = connect(join(dir, 'p.sock'));
    let got = '';
    s.on('connect', () => s.write(request));
    s.on('data', (d) => {
      got += d;
      if (after && got.includes('200 Connection Established') && !got.includes(until ?? '\0')) s.write(after);
      if (until && got.includes(until)) {
        s.destroy();
        resolve(got);
      }
    });
    s.on('error', () => undefined);
    s.on('close', () => resolve(got));
    setTimeout(() => {
      s.destroy();
      resolve(got);
    }, 2000);
  });
}

describe('the registry proxy', () => {
  it('tunnels a CONNECT to a listed host on 443 and carries the bytes both ways', async () => {
    proxy = await start();
    const got = await ask('CONNECT registry.example.com:443 HTTP/1.1\r\nHost: registry.example.com:443\r\n\r\n', 'echo:hello', 'hello');
    expect(got).toContain('200 Connection Established');
    expect(got).toContain('echo:hello');
    expect(decisions).toEqual([{ host: 'registry.example.com', port: 443, allowed: true }]);
  });

  it('refuses a host that is not listed, a port other than 443 and anything but CONNECT', async () => {
    proxy = await start();
    expect(await ask('CONNECT evil.example.org:443 HTTP/1.1\r\n\r\n')).toContain('403');
    expect(await ask('CONNECT registry.example.com:80 HTTP/1.1\r\n\r\n')).toContain('403');
    expect(await ask('GET http://registry.example.com/ HTTP/1.1\r\n\r\n')).toContain('405');
    expect(decisions.map((d) => (d.allowed ? 'ok' : d.why))).toEqual(['host', 'port', 'method']);
  });

  it('refuses a listed name that resolves to a private address, even when only one of its addresses is', async () => {
    proxy = await start({ hosts: ['registry.example.com', 'sneaky.example.com', 'internal.example.com'] });
    expect(await ask('CONNECT sneaky.example.com:443 HTTP/1.1\r\n\r\n')).toContain('403');
    expect(await ask('CONNECT internal.example.com:443 HTTP/1.1\r\n\r\n')).toContain('403');
    expect(decisions.map((d) => (d.allowed ? 'ok' : d.why))).toEqual(['address', 'address']);
  });

  it('answers 502 when the name does not resolve', async () => {
    proxy = await start({ resolve: async () => Promise.reject(new Error('nxdomain')) });
    expect(await ask('CONNECT registry.example.com:443 HTTP/1.1\r\n\r\n')).toContain('502');
    expect(decisions[0]).toMatchObject({ allowed: false, why: 'resolve' });
  });

  it('refuses beyond its connection cap', async () => {
    proxy = await start({ maxConnections: 0 });
    expect(await ask('CONNECT registry.example.com:443 HTTP/1.1\r\n\r\n')).toContain('429');
  });

  it('answers a request with no end to its head with an error instead of waiting', async () => {
    proxy = await start();
    expect(await ask(`CONNECT registry.example.com:443 HTTP/1.1\r\n${'X: y\r\n'.repeat(3000)}`)).toContain('431');
  });

  it('removes its socket when it closes', async () => {
    proxy = await start();
    await proxy.close();
    proxy = null;
    await expect(ask('CONNECT registry.example.com:443 HTTP/1.1\r\n\r\n')).resolves.toBe('');
  });
});
