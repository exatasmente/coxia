// i18n-lint: allow-file the status lines of an HTTP proxy: protocol text, not prose for a person
import { lookup } from 'node:dns/promises';
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { type Server, type Socket, connect, createServer, isIP } from 'node:net';

// The registry mode's one way out. The sandbox has no network interface at all; it reaches this proxy through a socket in its stage folder (a forwarder inside listens on the
// sandbox's own loopback and pipes to it). The proxy speaks `CONNECT` and nothing else, only to port 443 and only to the names the workspace listed; it resolves the name
// itself and refuses an address that is not a public one, and connects to the address it checked, so a name that is made to point at the machine itself or its network
// gets nowhere. It cannot see inside the TLS that goes through it.

export type ProxyDecision = { host: string; port: number; allowed: true } | { host: string; port: number; allowed: false; why: 'method' | 'host' | 'port' | 'address' | 'resolve' | 'limit' | 'bad-request' };

export interface ProxyOptions {
  socketPath: string;
  /** Exact host names (lowercase). */
  hosts: string[];
  /** Told about every request: what was asked and what was decided. */
  onDecision?: (d: ProxyDecision) => void;
  /** Replaced in tests. */
  resolve?: (host: string) => Promise<string[]>;
  /** Replaced in tests. */
  open?: (address: string, port: number) => Socket;
  maxConnections?: number;
  maxBytes?: number;
  idleMs?: number;
}

export interface RegistryProxy {
  close(): Promise<void>;
  /** Bytes carried so far, both ways. */
  readonly bytes: number;
}

const HEAD_MAX = 8192;

/** Whether an address is one a sandbox must never be sent to: this machine, a private or link-local network, a metadata address, anything that is not a public unicast. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (x === '::' || x === '::1' || x.startsWith('64:ff9b:')) return true;
    const first = parseInt(x.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  return true;
}

const realResolve = async (host: string): Promise<string[]> => (await lookup(host, { all: true })).map((a) => a.address);

export async function createRegistryProxy(o: ProxyOptions): Promise<RegistryProxy> {
  const hosts = new Set(o.hosts.map((h) => h.toLowerCase()));
  const resolveName = o.resolve ?? realResolve;
  const open = o.open ?? ((address: string, port: number) => connect({ host: address, port }));
  const maxConnections = o.maxConnections ?? 16;
  const maxBytes = o.maxBytes ?? 2 * 1024 * 1024 * 1024;
  const idleMs = o.idleMs ?? 60_000;
  let bytes = 0;
  let active = 0;
  const sockets = new Set<Socket>();
  const decide = (d: ProxyDecision): void => {
    try {
      o.onDecision?.(d);
    } catch {
      // A failing log must not decide anything.
    }
  };

  const server: Server = createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    client.setTimeout(idleMs, () => client.destroy());
    let head = Buffer.alloc(0);
    const refuse = (status: string, d: ProxyDecision): void => {
      decide(d);
      client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const onData = (chunk: Buffer): void => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > HEAD_MAX) {
          client.off('data', onData);
          refuse('431 Request Header Fields Too Large', { host: '', port: 0, allowed: false, why: 'bad-request' });
        }
        return;
      }
      client.off('data', onData);
      client.pause();
      const rest = head.subarray(end + 4);
      void handle(head.subarray(0, end).toString('latin1'), rest);
    };
    const handle = async (text: string, rest: Buffer): Promise<void> => {
      const m = /^CONNECT ([^\s:]+):(\d{1,5}) HTTP\/1\.[01]/i.exec(text.split('\r\n')[0]);
      if (!/^CONNECT /i.test(text)) return refuse('405 Method Not Allowed', { host: '', port: 0, allowed: false, why: 'method' });
      if (!m) return refuse('400 Bad Request', { host: '', port: 0, allowed: false, why: 'bad-request' });
      const host = m[1].toLowerCase();
      const port = Number(m[2]);
      if (!hosts.has(host)) return refuse('403 Forbidden', { host, port, allowed: false, why: 'host' });
      if (port !== 443) return refuse('403 Forbidden', { host, port, allowed: false, why: 'port' });
      if (active >= maxConnections || bytes >= maxBytes) return refuse('429 Too Many Requests', { host, port, allowed: false, why: 'limit' });
      let addresses: string[];
      try {
        addresses = await resolveName(host);
      } catch {
        return refuse('502 Bad Gateway', { host, port, allowed: false, why: 'resolve' });
      }
      // Every address the name has must be a public one: a name with a single private address among the public ones is refused whole.
      if (!addresses.length || addresses.some(isPrivateAddress)) return refuse('403 Forbidden', { host, port, allowed: false, why: 'address' });
      const upstream = open(addresses[0], port);
      sockets.add(upstream);
      active++;
      let established = false;
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        sockets.delete(upstream);
        active--;
        upstream.destroy();
      };
      const done = (): void => {
        release();
        client.destroy();
      };
      upstream.on('error', () => {
        if (established) return done();
        // The connection never came up: the client is told, then everything ends.
        refuse('502 Bad Gateway', { host, port, allowed: false, why: 'resolve' });
        release();
      });
      upstream.on('close', () => (established ? done() : release()));
      client.on('close', done);
      upstream.setTimeout(idleMs, done);
      upstream.once('connect', () => {
        established = true;
        decide({ host, port, allowed: true });
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) upstream.write(rest);
        const count = (c: Buffer): void => {
          bytes += c.length;
          if (bytes > maxBytes) done();
        };
        client.on('data', count);
        upstream.on('data', count);
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
    };
    client.on('data', onData);
  });

  if (existsSync(o.socketPath)) rmSync(o.socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.socketPath, () => resolve());
  });
  chmodSync(o.socketPath, 0o600);

  return {
    get bytes() {
      return bytes;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => {
          rmSync(o.socketPath, { force: true });
          resolve();
        });
      }),
  };
}
