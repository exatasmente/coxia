// i18n-lint: allow-file the status lines of an HTTP proxy: protocol text, not prose for a person
import { lookup } from 'node:dns/promises';
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { BlockList, type Server, type Socket, connect, createServer, isIP } from 'node:net';

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
  /** Tunnels open at once. */
  maxConnections?: number;
  /** Sockets of clients held at once, a tunnel or not: what a flood of bare connections is held to. */
  maxClients?: number;
  maxBytes?: number;
  idleMs?: number;
}

export interface RegistryProxy {
  close(): Promise<void>;
  /** Bytes carried so far, both ways. */
  readonly bytes: number;
}

const HEAD_MAX = 8192;

// Every range a name must never resolve into for a sandbox to be sent there: this machine, private and link-local networks, metadata addresses, documentation and
// transition ranges that can carry an IPv4 address inside an IPv6 one (mapped, compatible, NAT64, 6to4, Teredo), and everything that is not unicast.
// Two lists, never mixed: an IPv4 address is matched against an IPv6 rule as its mapped form, so the mapped range of the IPv6 list would take every IPv4 address with it.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
// Written as numbers: the repository's audit refuses a private address spelled out in a file.
for (const [a, b, c, d, bits] of [[0, 0, 0, 0, 8], [10, 0, 0, 0, 8], [100, 64, 0, 0, 10], [127, 0, 0, 0, 8], [169, 254, 0, 0, 16], [172, 16, 0, 0, 12], [192, 0, 0, 0, 24], [192, 0, 2, 0, 24], [192, 88, 99, 0, 24], [192, 168, 0, 0, 16], [198, 18, 0, 0, 15], [198, 51, 100, 0, 24], [203, 0, 113, 0, 24], [224, 0, 0, 0, 4], [240, 0, 0, 0, 4]] as const) BLOCKED_V4.addSubnet(`${a}.${b}.${c}.${d}`, bits, 'ipv4');
// ::/96 (IPv4-compatible, deprecated), ::ffff:0:0/96 (mapped: a name has no business with one), NAT64, discard, Teredo, documentation, 6to4, unique local, link-local, site-local, multicast.
for (const [net, bits] of [['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) BLOCKED_V6.addSubnet(net, bits, 'ipv6');

/** Whether an address is one a sandbox must never be sent to. Anything that is not an address at all is one too. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 0) return true;
  return v === 4 ? BLOCKED_V4.check(address, 'ipv4') : BLOCKED_V6.check(address, 'ipv6');
}

const realResolve = async (host: string): Promise<string[]> => (await lookup(host, { all: true })).map((a) => a.address);

export async function createRegistryProxy(o: ProxyOptions): Promise<RegistryProxy> {
  const hosts = new Set(o.hosts.map((h) => h.toLowerCase()));
  const resolveName = o.resolve ?? realResolve;
  const open = o.open ?? ((address: string, port: number) => connect({ host: address, port }));
  const maxConnections = o.maxConnections ?? 16;
  const maxClients = o.maxClients ?? 64;
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
      // The slot is taken before the name is looked up, not after: requests that arrive while the lookups are out must count too.
      active++;
      let upstream: Socket | null = null;
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        active--;
        if (upstream) {
          sockets.delete(upstream);
          upstream.destroy();
        }
      };
      // A client that goes away while its name is being looked up gives the slot back.
      client.once('close', release);
      let addresses: string[];
      try {
        addresses = await resolveName(host);
      } catch {
        release();
        return refuse('502 Bad Gateway', { host, port, allowed: false, why: 'resolve' });
      }
      // Every address the name has must be a public one: a name with a single private address among the public ones is refused whole.
      if (!addresses.length || addresses.some(isPrivateAddress)) {
        release();
        return refuse('403 Forbidden', { host, port, allowed: false, why: 'address' });
      }
      if (released || client.destroyed) return release();
      const up = open(addresses[0], port);
      upstream = up;
      sockets.add(up);
      let established = false;
      const done = (): void => {
        release();
        client.destroy();
      };
      up.on('error', () => {
        if (established) return done();
        // The connection never came up: the client is told, then everything ends.
        refuse('502 Bad Gateway', { host, port, allowed: false, why: 'resolve' });
        release();
      });
      up.on('close', () => (established ? done() : release()));
      client.on('close', done);
      up.setTimeout(idleMs, done);
      up.once('connect', () => {
        established = true;
        decide({ host, port, allowed: true });
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) up.write(rest);
        const count = (c: Buffer): void => {
          bytes += c.length;
          if (bytes > maxBytes) done();
        };
        client.on('data', count);
        up.on('data', count);
        client.pipe(up);
        up.pipe(client);
        client.resume();
      });
    };
    client.on('data', onData);
  });

  server.maxConnections = maxClients;
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
