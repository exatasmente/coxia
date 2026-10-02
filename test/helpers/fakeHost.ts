import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A code host on localhost for the provider tests: the real fetch goes to a real socket, the answers come from fixtures. Nothing leaves
// the machine. Every request is recorded so a test can say what was asked, in what order and with which credential.

export interface Hit {
  method: string;
  /** Path without the query, as the server saw it (percent-encoding intact). */
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  /** Close the socket without answering (a network failure). */
  drop?: boolean;
  /** Answer only after this many milliseconds (a timeout). */
  delayMs?: number;
}

export type Route = Reply | ((hit: Hit, n: number) => Reply | undefined);

export interface FakeHost {
  /** http://127.0.0.1:port */
  url: string;
  hits: Hit[];
  /** Routes are matched on "METHOD /path" (query ignored); later calls to `route` replace earlier ones. */
  route(key: string, reply: Route): void;
  close(): Promise<void>;
  /** "METHOD path?query" of every hit, in order. */
  log(): string[];
}

export async function startFakeHost(routes: Record<string, Route> = {}): Promise<FakeHost> {
  const table = new Map<string, Route>(Object.entries(routes));
  const counts = new Map<string, number>();
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const hit: Hit = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      hits.push(hit);
      const key = `${hit.method} ${hit.path}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const route = table.get(key);
      const reply = (typeof route === 'function' ? route(hit, n) : route) ?? { status: 404, json: { message: '404 Not Found' } };
      const send = () => {
        if (reply.drop) return req.socket.destroy();
        const body = reply.text ?? JSON.stringify(reply.json ?? {});
        res.writeHead(reply.status ?? 200, { 'content-type': reply.text !== undefined ? 'text/plain' : 'application/json', ...reply.headers });
        res.end(body);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    route: (key, reply) => void table.set(key, reply),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    log: () => hits.map((h) => `${h.method} ${h.path}${h.query.toString() ? `?${h.query.toString()}` : ''}`),
  };
}

/** A recorded response from test/fixtures/vcs/<name>.json. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'vcs', `${name}.json`), 'utf8')) as T;
}

export const noSleep = async (): Promise<void> => undefined;
