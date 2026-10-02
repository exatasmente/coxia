import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { WebSettings } from '../shared/settings';
import type { AppEvent } from '../shared/types';
import { decodeWire, encodeWire } from '../shared/wire';
import { AuthError, createAuth, type Auth, SESSION_TTL_MS } from './webAuth';
import { createIdempotency, IdempotencyConflict, type Idempotency } from './webIdempotency';
import { webRefusal } from './webPolicy';
import { IDEMPOTENCY_KEY, isQueueable } from '../shared/outbox';
import { t } from '../shared/i18n';

const COOKIE = 'cer_session';
const MAX_BODY = 15 * 1024 * 1024;
const LOGIN_BODY = 4096;
const HEARTBEAT_MS = 25_000;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // mermaid writes inline style attributes into its diagrams
  "style-src 'self' 'unsafe-inline'",
  // i18n-ignore-start: HTTP header and content-security-policy values
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  // i18n-ignore-end
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export interface WebDeps {
  settings(): WebSettings;
  rendererDir: string;
  auth: Auth;
  invoke(channel: string, args: unknown[], deviceId?: string): Promise<unknown>;
  hasChannel(channel: string): boolean;
  // Called when a device logs out or is revoked (push subscriptions go with it).
  onDeviceGone?(id: string): void;
  idempotency?: Idempotency;
}

/**
 * Resolves a request path under the renderer build. Never leaves `root`: no traversal, no dotfiles,
 * and a symlink pointing outside is refused.
 */
export function resolveStatic(root: string, rel: string): { path: string; type: string } | null {
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const segments = rel.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '..' || s === '.' || s.startsWith('.'))) return null;
  const base = resolve(root);
  const target = resolve(base, segments.length ? segments.join('/') : 'index.html');
  if (target !== base && !target.startsWith(base + sep)) return null;
  try {
    const real = realpathSync(target);
    const realBase = realpathSync(base);
    if (!real.startsWith(realBase + sep)) return null;
    if (!statSync(real).isFile()) return null;
    return { path: real, type: TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

const normalizeAddress = (a: string | undefined): string => (a ?? '').replace(/^::ffff:/, '');
const isLoopback = (a: string): boolean => a === '::1' || a.startsWith('127.');

function ipv4(a: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) return null;
  return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
}

export function inCidr(addr: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  const a = ipv4(addr);
  const b = ipv4(base);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

// Only the reverse proxy (and loopback, for local tests) is believed about forwarded headers.
export const trustedPeer = (peerRaw: string | undefined, cidr: string): boolean => {
  const peer = normalizeAddress(peerRaw);
  return isLoopback(peer) || inCidr(peer, cidr);
};

/** The client address: X-Real-IP (set by nginx from Cloudflare's CF-Connecting-IP) when the peer is the trusted proxy, else the peer. */
export function clientIp(peerRaw: string | undefined, realIp: string | string[] | undefined, cidr: string): string {
  const peer = normalizeAddress(peerRaw);
  if (!trustedPeer(peer, cidr)) return peer;
  const given = (Array.isArray(realIp) ? realIp[0] : realIp)?.trim();
  return given && isIP(given) ? given : peer;
}

export function originAllowed(origin: string | undefined, publicUrl: string): boolean {
  if (origin === undefined) return true;
  try {
    const o = new URL(origin);
    if (o.origin === new URL(publicUrl).origin) return true;
    return (o.protocol === 'http:' || o.protocol === 'https:') && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(o.hostname);
  } catch {
    return false;
  }
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'microphone=(self)');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        fail(new HttpError(413, t('main.web.bodyTooLarge')));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

interface SseClient {
  res: ServerResponse;
  deviceId: string;
}

export interface WebApp {
  server: Server;
  broadcast(ev: AppEvent): void;
  clientCount(): number;
  dropDevice(id: string): void;
  close(): Promise<void>;
}

export function createWebApp(deps: WebDeps): WebApp {
  const sse = new Set<SseClient>();
  const idem = deps.idempotency ?? createIdempotency();
  const sockets = new Set<Socket>();

  const heartbeat = setInterval(() => {
    for (const c of sse) c.res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function cookieHeader(token: string, req: IncomingMessage, maxAgeSec: number): string {
    const s = deps.settings();
    const peer = normalizeAddress(req.socket.remoteAddress);
    const proxied = trustedPeer(peer, s.trustedProxy);
    const proto = proxied ? String(req.headers['x-forwarded-proto'] ?? '').split(',').pop()?.trim() : undefined;
    const local = isLoopback(peer) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test((req.headers.host ?? '').replace(/:\d+$/, ''));
    const secure = proto === 'https' || !local;
    return `${COOKIE}=${token}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Path=${s.basePath}; Max-Age=${maxAgeSec}`;
  }

  function session(req: IncomingMessage) {
    const token = cookieValue(req.headers.cookie, COOKIE);
    return { token, device: deps.auth.verify(token) };
  }

  function guardWrite(req: IncomingMessage): void {
    if (req.headers['x-cerimonias'] !== '1') throw new HttpError(403, t('main.web.noHeader'));
    if (!originAllowed(req.headers.origin, deps.settings().publicUrl)) throw new HttpError(403, t('main.web.origin'));
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, t('main.web.json'));
  }

  async function api(req: IncomingMessage, res: ServerResponse, rel: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (rel === 'api/login') {
      if (method !== 'POST') throw new HttpError(405, t('main.web.method'));
      guardWrite(req);
      let body: { code?: unknown; name?: unknown };
      try {
        body = JSON.parse((await readBody(req, LOGIN_BODY)).toString('utf8')) as { code?: unknown; name?: unknown };
      } catch {
        throw new HttpError(400, t('main.web.badJson'));
      }
      const ip = clientIp(req.socket.remoteAddress, req.headers['x-real-ip'], deps.settings().trustedProxy);
      const { token, device } = deps.auth.login(body?.code, body?.name, ip);
      json(res, 200, { device }, { 'Set-Cookie': cookieHeader(token, req, SESSION_TTL_MS / 1000) });
      return;
    }

    const { token, device } = session(req);
    if (!device || !token) throw new HttpError(401, t('main.web.pair'));

    if (rel === 'api/session') {
      if (method !== 'GET') throw new HttpError(405, t('main.web.method'));
      json(res, 200, { device, allowExternalEffects: deps.settings().allowExternalEffects }, { 'Set-Cookie': cookieHeader(token, req, SESSION_TTL_MS / 1000) });
      return;
    }

    if (rel === 'api/logout') {
      if (method !== 'POST') throw new HttpError(405, t('main.web.method'));
      guardWrite(req);
      deps.auth.revoke(device.id);
      deps.onDeviceGone?.(device.id);
      dropDevice(device.id);
      json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', req, 0) });
      return;
    }

    if (rel === 'api/events') {
      if (method !== 'GET') throw new HttpError(405, t('main.web.method'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      // i18n-ignore: HTTP header and content-security-policy values
      res.write('retry: 3000\n\n: open\n\n');
      const client: SseClient = { res, deviceId: device.id };
      sse.add(client);
      res.on('close', () => sse.delete(client));
      return;
    }

    if (rel.startsWith('api/rpc/')) {
      if (method !== 'POST') throw new HttpError(405, t('main.web.method'));
      guardWrite(req);
      const channel = rel.slice('api/rpc/'.length);
      if (!deps.hasChannel(channel)) throw new HttpError(404, t('main.rpc.unknownChannel', { channel }));
      const refusal = webRefusal(channel, deps.settings().allowExternalEffects);
      if (refusal) throw new HttpError(403, refusal);
      let args: unknown;
      try {
        args = decodeWire(JSON.parse((await readBody(req)).toString('utf8')));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, t('main.web.badJson'));
      }
      if (!Array.isArray(args)) throw new HttpError(400, t('main.web.args'));
      const key = req.headers['x-idempotency-key'];
      if (key !== undefined && (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key))) throw new HttpError(400, t('main.web.idemKey'));
      let result: unknown;
      try {
        const run = () => deps.invoke(channel, args, device.id);
        result = typeof key === 'string' && isQueueable(channel) ? await idem.run(device.id, channel, key, run) : await run();
      } catch (e) {
        if (e instanceof IdempotencyConflict) throw new HttpError(409, e.message);
        console.error('[web]', channel, e instanceof Error ? e.message : e);
        throw new HttpError(500, e instanceof Error ? e.message : String(e));
      }
      json(res, 200, { result: encodeWire(result) });
      return;
    }

    throw new HttpError(404, t('main.web.notFound'));
  }

  function dropDevice(id: string): void {
    for (const c of [...sse]) {
      if (c.deviceId !== id) continue;
      sse.delete(c);
      c.res.end();
    }
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, rel: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, t('main.web.method'));
    const file = resolveStatic(deps.rendererDir, rel);
    if (!file) throw new HttpError(404, t('main.web.notFound'));
    const hashed = /^assets\/.+-[\w-]{6,}\.\w+$/.test(rel);
    const headers: Record<string, string | number> = {
      'Content-Type': file.type,
      // i18n-ignore: HTTP header and content-security-policy values
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (rel === 'sw.js') headers['Service-Worker-Allowed'] = deps.settings().basePath;
    const data = readFileSync(file.path);
    headers['Content-Length'] = data.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = createServer((req, res) => {
    securityHeaders(res);
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://local');
        const base = deps.settings().basePath;
        if (url.pathname === base.slice(0, -1)) {
          res.writeHead(308, { Location: base });
          res.end();
          return;
        }
        if (!url.pathname.startsWith(base)) throw new HttpError(404, t('main.web.notFound'));
        let rel: string;
        try {
          rel = decodeURIComponent(url.pathname.slice(base.length));
        } catch {
          throw new HttpError(400, t('main.web.badPath'));
        }
        if (rel.startsWith('api/')) await api(req, res, rel);
        else serveStatic(req, res, rel);
      } catch (e) {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (e instanceof AuthError) {
          json(res, e.status, { error: e.message }, e.retryAfterSec ? { 'Retry-After': String(e.retryAfterSec) } : {});
        } else if (e instanceof HttpError) {
          json(res, e.status, { error: e.message });
        } else {
          console.error('[web]', e);
          json(res, 500, { error: t('main.web.internal') });
        }
      }
    })();
  });
  server.keepAliveTimeout = 65_000;
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return {
    server,
    broadcast(ev) {
      const line = `data: ${JSON.stringify(encodeWire(ev))}\n\n`;
      for (const c of sse) c.res.write(line);
    },
    clientCount: () => sse.size,
    dropDevice,
    close() {
      clearInterval(heartbeat);
      for (const c of sse) c.res.end();
      sse.clear();
      return new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
    },
  };
}

export interface Listening {
  listening: boolean;
  address: string | null;
  message: string;
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      ok();
    });
  });
}

/** Binds the configured address; when it does not exist on this machine, falls back to loopback and says so. */
export async function startListening(app: WebApp, settings: WebSettings): Promise<Listening> {
  const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException).code;
  try {
    await listen(app.server, settings.host, settings.port);
    return { listening: true, address: `${settings.host}:${settings.port}`, message: t('main.web.listening', { address: `${settings.host}:${settings.port}` }) };
  } catch (e) {
    if (code(e) === 'EADDRINUSE') return { listening: false, address: null, message: t('main.web.portInUse', { port: settings.port }) };
    if (code(e) !== 'EADDRNOTAVAIL' && code(e) !== 'EINVAL') return { listening: false, address: null, message: t('main.web.listenFailed', { address: `${settings.host}:${settings.port}`, detail: (e as Error).message }) };
  }
  try {
    await listen(app.server, '127.0.0.1', settings.port);
    return {
      listening: true,
      address: `127.0.0.1:${settings.port}`,
      message: t('main.web.fallback', { host: settings.host, port: settings.port }),
    };
  } catch (e) {
    return { listening: false, address: null, message: t('main.web.cannotListen', { host: settings.host, detail: (e as Error).message }) };
  }
}
