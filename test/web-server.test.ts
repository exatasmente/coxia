import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type WebSettings } from '../src/shared/settings';
import { decodeWire, encodeWire } from '../src/shared/wire';
import { clientIp, createWebApp, inCidr, originAllowed, resolveStatic, type WebApp } from '../src/main/web';
import { createAuth, type Auth } from '../src/main/webAuth';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const BASE = '/cerimonias/';
const PUBLIC = 'https://koala.fortics.dev/cerimonias/';

let dir: string;
let app: WebApp;
let auth: Auth;
let port: number;
let web: WebSettings;
const calls: Array<[string, unknown[]]> = [];
const CHANNELS = new Set(['state:load', 'claude:continue', 'actions:approve', 'actions:skip', 'voice:speak', 'voice:transcribe', 'settings:save', 'web:view', 'clipboard:copy', 'boom']);

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => any;
}

function http(method: string, path: string, opts: { headers?: Record<string, string>; body?: string | Buffer; cookie?: string } = {}): Promise<Res> {
  return new Promise((ok, fail) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.cookie) headers.Cookie = opts.cookie;
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        ok({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
      });
    });
    req.on('error', fail);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const JSON_POST = { 'Content-Type': 'application/json', 'X-Cerimonias': '1' };

async function pairedCookie(name = 'Pixel'): Promise<string> {
  const { code } = auth.newPairingCode();
  const res = await http('POST', `${BASE}api/login`, { headers: JSON_POST, body: JSON.stringify({ code, name }) });
  expect(res.status).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
}

function rpc(channel: string, args: unknown[], cookie: string, headers: Record<string, string> = {}): Promise<Res> {
  return http('POST', `${BASE}api/rpc/${encodeURIComponent(channel)}`, { headers: { ...JSON_POST, ...headers }, cookie, body: JSON.stringify(encodeWire(args)) });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cer-web-'));
  const renderer = join(dir, 'renderer');
  mkdirSync(join(renderer, 'assets'), { recursive: true });
  writeFileSync(join(renderer, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(join(renderer, 'sw.js'), '// sw');
  writeFileSync(join(renderer, 'assets', 'index-abcdef12.js'), 'console.log(1)');
  writeFileSync(join(dir, 'secret.txt'), 'top secret');
  writeFileSync(join(renderer, '.env'), 'hidden');
  symlinkSync(join(dir, 'secret.txt'), join(renderer, 'link.txt'));
  auth = createAuth(join(dir, 'web-sessions.json'));
  web = { ...DEFAULT_SETTINGS.web, enabled: true, basePath: BASE, publicUrl: PUBLIC };
  app = createWebApp({
    settings: () => web,
    rendererDir: renderer,
    auth,
    hasChannel: (c) => CHANNELS.has(c),
    invoke: async (channel, args) => {
      calls.push([channel, args]);
      if (channel === 'boom') throw new Error('falhou de propósito');
      if (channel === 'voice:speak') return new Uint8Array([82, 73, 70, 70, 1, 2, 3]).buffer;
      if (channel === 'voice:transcribe') return `bytes:${(args[0] as ArrayBuffer).byteLength}:${args[0] instanceof ArrayBuffer}`;
      if (channel === 'state:load') return args[0] === undefined ? 'undef' : 'val';
      return { channel, args };
    },
  });
  await new Promise<void>((ok) => app.server.listen(0, '127.0.0.1', ok));
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
});

describe('static files', () => {
  it('serves the app shell without a session, with the security headers', async () => {
    const res = await http('GET', BASE);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<title>x</title>');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).not.toMatch(/script-src[^;]*unsafe/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toBe('microphone=(self)');
  });

  it('puts the security headers on errors and API answers too', async () => {
    for (const res of [await http('GET', '/nope'), await http('GET', `${BASE}api/session`)]) {
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBeTruthy();
    }
  });

  it('caches hashed assets forever and the shell never', async () => {
    expect((await http('GET', `${BASE}assets/index-abcdef12.js`)).headers['cache-control']).toContain('immutable');
    expect((await http('GET', BASE)).headers['cache-control']).toBe('no-cache');
    const sw = await http('GET', `${BASE}sw.js`);
    expect(sw.headers['cache-control']).toBe('no-cache');
    expect(sw.headers['service-worker-allowed']).toBe(BASE);
  });

  it('redirects the base without the trailing slash', async () => {
    const res = await http('GET', '/cerimonias');
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe(BASE);
  });

  it('answers 404 outside the base path', async () => {
    expect((await http('GET', '/')).status).toBe(404);
    expect((await http('GET', '/other/index.html')).status).toBe(404);
  });

  it('never serves files outside the renderer directory', async () => {
    const attacks = [
      `${BASE}../secret.txt`,
      `${BASE}..%2fsecret.txt`,
      `${BASE}%2e%2e/secret.txt`,
      `${BASE}%2e%2e%2fsecret.txt`,
      `${BASE}assets/../../secret.txt`,
      `${BASE}..%5csecret.txt`,
      `${BASE}%00`,
      `${BASE}link.txt`,
      `${BASE}.env`,
      `${BASE}assets%2f..%2f..%2fsecret.txt`,
      `${BASE}%252e%252e/secret.txt`,
      `/cerimonias/..//..//etc/passwd`,
    ];
    for (const path of attacks) {
      const res = await http('GET', path);
      expect(res.status, path).not.toBe(200);
      expect(res.body, path).not.toContain('top secret');
      expect(res.body, path).not.toContain('hidden');
    }
  });

  it('resolveStatic refuses traversal, dotfiles, directories and symlinks that escape', () => {
    const root = join(dir, 'renderer');
    expect(resolveStatic(root, '')?.path).toMatch(/index\.html$/);
    expect(resolveStatic(root, 'assets/index-abcdef12.js')?.type).toContain('javascript');
    for (const rel of ['../secret.txt', 'assets/../../secret.txt', '.env', 'assets', 'link.txt', 'a\\b', 'x\0y']) expect(resolveStatic(root, rel), rel).toBeNull();
  });
});

describe('login and session', () => {
  it('rejects the API without a session', async () => {
    expect((await http('GET', `${BASE}api/session`)).status).toBe(401);
    expect((await http('GET', `${BASE}api/events`)).status).toBe(401);
    expect((await rpc('state:load', [], '')).status).toBe(401);
    expect((await rpc('state:load', [], 'cer_session=forged')).status).toBe(401);
    expect(calls.filter(([c]) => c === 'state:load')).toHaveLength(0);
  });

  it('sets a hardened cookie scoped to the base path', async () => {
    const { code } = auth.newPairingCode();
    const res = await http('POST', `${BASE}api/login`, { headers: { ...JSON_POST, Host: '127.0.0.1' }, body: JSON.stringify({ code, name: 'Pixel' }) });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^cer_session=[\w-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Path=${BASE}`);
    // plain http on localhost: no Secure, or the browser would drop it
    expect(cookie).not.toContain('Secure');
  });

  it('adds Secure behind the https proxy and for any non-local host', async () => {
    const proxied = createAuth(join(dir, 'proxied.json'));
    const { code } = proxied.newPairingCode();
    const other = createWebApp({ settings: () => web, rendererDir: dir, auth: proxied, hasChannel: () => false, invoke: async () => null });
    await new Promise<void>((ok) => other.server.listen(0, '127.0.0.1', ok));
    const p = (other.server.address() as AddressInfo).port;
    const res = await new Promise<Res>((ok, fail) => {
      const req = request({ host: '127.0.0.1', port: p, method: 'POST', path: `${BASE}api/login`, headers: { ...JSON_POST, Host: 'koala.fortics.dev', 'X-Forwarded-Proto': 'https' } }, (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => ok({ status: r.statusCode ?? 0, headers: r.headers, body, json: () => JSON.parse(body) }));
      });
      req.on('error', fail);
      req.end(JSON.stringify({ code, name: 'Pixel' }));
    });
    expect(String(res.headers['set-cookie'])).toContain('Secure');
    await other.close();
  });

  it('answers /api/session for a valid cookie', async () => {
    const cookie = await pairedCookie('Laptop');
    const res = await http('GET', `${BASE}api/session`, { cookie });
    expect(res.status).toBe(200);
    expect(res.json().device.name).toBe('Laptop');
    expect(res.json().allowExternalEffects).toBe(false);
  });

  it('wrong codes get 401 with a generic message, then 429 from the same IP', async () => {
    let last: Res | null = null;
    for (let i = 0; i < 6; i++) last = await http('POST', `${BASE}api/login`, { headers: { ...JSON_POST, 'X-Real-IP': '203.0.113.50' }, body: JSON.stringify({ code: 'AAAAAAAAAAAA', name: 'x' }) });
    expect(last?.status).toBe(429);
    expect(last?.headers['retry-after']).toBeTruthy();
  });

  it('logout revokes the session', async () => {
    const cookie = await pairedCookie('Temp');
    expect((await http('POST', `${BASE}api/logout`, { headers: JSON_POST, cookie, body: '{}' })).status).toBe(200);
    expect((await http('GET', `${BASE}api/session`, { cookie })).status).toBe(401);
  });
});

describe('request guards', () => {
  it('requires the X-Cerimonias header on writes', async () => {
    const cookie = await pairedCookie();
    const res = await http('POST', `${BASE}api/rpc/state:load`, { headers: { 'Content-Type': 'application/json' }, cookie, body: '[]' });
    expect(res.status).toBe(403);
  });

  it('refuses a foreign Origin and accepts the public one and localhost', async () => {
    const cookie = await pairedCookie();
    expect((await rpc('state:load', [], cookie, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await rpc('state:load', [], cookie, { Origin: 'null' })).status).toBe(403);
    expect((await rpc('state:load', [], cookie, { Origin: 'https://koala.fortics.dev' })).status).toBe(200);
    expect((await rpc('state:load', [], cookie, { Origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await rpc('state:load', [], cookie, { Origin: 'http://localhost:3000' })).status).toBe(200);
    // no Origin (non-browser client) is fine: the cookie and the header still apply
    expect((await rpc('state:load', [], cookie)).status).toBe(200);
  });

  it('requires a JSON content type', async () => {
    const cookie = await pairedCookie();
    const res = await http('POST', `${BASE}api/rpc/state:load`, { headers: { 'X-Cerimonias': '1', 'Content-Type': 'text/plain' }, cookie, body: '[]' });
    expect(res.status).toBe(415);
  });

  it('caps the body at 15 MB', async () => {
    const cookie = await pairedCookie();
    const res = await http('POST', `${BASE}api/rpc/voice:transcribe`, { headers: JSON_POST, cookie, body: `["${'a'.repeat(16 * 1024 * 1024)}"]` }).catch(() => ({ status: 413 }));
    expect(res.status).toBe(413);
  });

  it('caps the login body at 4 KB before anyone is authenticated', async () => {
    const res = await http('POST', `${BASE}api/login`, { headers: { ...JSON_POST, 'X-Real-IP': '203.0.113.77' }, body: JSON.stringify({ code: 'x'.repeat(5000), name: 'x' }) }).catch(() => ({ status: 413 }));
    expect(res.status).toBe(413);
  });

  it('originAllowed and clientIp helpers', () => {
    expect(originAllowed(undefined, PUBLIC)).toBe(true);
    expect(originAllowed('https://koala.fortics.dev', PUBLIC)).toBe(true);
    expect(originAllowed('http://koala.fortics.dev', PUBLIC)).toBe(false);
    expect(originAllowed('https://koala.fortics.dev.evil.com', PUBLIC)).toBe(false);
    expect(originAllowed('not a url', PUBLIC)).toBe(false);
    // X-Real-IP counts only from the proxy (trusted CIDR or loopback)
    const cidr = '172.18.0.0/16';
    expect(clientIp('172.18.0.28', '1.2.3.4', cidr)).toBe('1.2.3.4');
    expect(clientIp('::ffff:172.18.0.28', '1.2.3.4', cidr)).toBe('1.2.3.4');
    expect(clientIp('127.0.0.1', '1.2.3.4', cidr)).toBe('1.2.3.4');
    expect(clientIp('192.168.1.50', '1.2.3.4', cidr)).toBe('192.168.1.50');
    expect(clientIp('172.19.0.2', '1.2.3.4', cidr)).toBe('172.19.0.2');
    expect(clientIp('172.18.0.28', 'garbage', cidr)).toBe('172.18.0.28');
    expect(clientIp('172.18.0.28', undefined, cidr)).toBe('172.18.0.28');
    expect(inCidr('172.18.255.1', '172.18.0.0/16')).toBe(true);
    expect(inCidr('172.19.0.1', '172.18.0.0/16')).toBe(false);
    expect(inCidr('10.0.0.1', '0.0.0.0/0')).toBe(true);
    expect(inCidr('10.0.0.1', 'bad')).toBe(false);
  });
});

describe('RPC', () => {
  it('round trips JSON and bytes in both directions', async () => {
    const cookie = await pairedCookie();
    const audio = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const stt = await rpc('voice:transcribe', [audio], cookie);
    expect(decodeWire(stt.json().result)).toBe('bytes:5:true');
    const speak = await rpc('voice:speak', ['oi', {}], cookie);
    const bytes = decodeWire(speak.json().result) as ArrayBuffer;
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([82, 73, 70, 70, 1, 2, 3]));
    expect(decodeWire((await rpc('state:load', [undefined], cookie)).json().result)).toBe('undef');
  });

  it('answers 404 for an unknown channel and 500 with the message for a handler error', async () => {
    const cookie = await pairedCookie();
    expect((await rpc('nope:nothing', [], cookie)).status).toBe(404);
    const res = await rpc('boom', [], cookie);
    expect(res.status).toBe(500);
    expect(res.json().error).toBe('falhou de propósito');
    expect((await http('POST', `${BASE}api/rpc/state:load`, { headers: JSON_POST, cookie, body: '{"not":"array"}' })).status).toBe(400);
  });
});

describe('channels refused over the web', () => {
  it('refuses desktop-only channels and the web admin channels with 403, without running them', async () => {
    const cookie = await pairedCookie();
    calls.length = 0;
    for (const channel of ['claude:continue', 'clipboard:copy', 'web:view']) {
      const res = await rpc(channel, ['x'], cookie);
      expect(res.status, channel).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses actions:approve until the external effects setting is on', async () => {
    const cookie = await pairedCookie();
    calls.length = 0;
    const blocked = await rpc('actions:approve', ['abc'], cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.json().error).toContain('efeito externo');
    expect(calls).toHaveLength(0);
    expect((await rpc('actions:skip', ['abc'], cookie)).status).toBe(200);
    web = { ...web, allowExternalEffects: true };
    expect((await rpc('actions:approve', ['abc'], cookie)).status).toBe(200);
    web = { ...web, allowExternalEffects: false };
  });

  it('policy lists', () => {
    expect([...DESKTOP_ONLY].sort()).toEqual(['autostart:set', 'claude:continue', 'clipboard:copy', 'conflicts:verify-set', 'jobs:notify', 'retention:apply', 'update:busy', 'update:check', 'update:flushed', 'update:info', 'update:install', 'update:run', 'update:seen', 'update:settings-save', 'update:status', 'workspace:delete', 'workspace:test']);
    expect([...EXTERNAL_EFFECT]).toEqual(['actions:approve']);
    expect(webAccess('web:configure')).toBe('deny');
    expect(webAccess('web:pair')).toBe('deny');
    expect(webAccess('state:load')).toBe('allow');
    expect(webRefusal('actions:approve', true)).toBeNull();
    expect(webRefusal('claude:continue', true)).not.toBeNull();
  });
});

describe('events', () => {
  it('streams AppEvents over SSE and drops a revoked device', async () => {
    const { code } = auth.newPairingCode();
    const login = await http('POST', `${BASE}api/login`, { headers: JSON_POST, body: JSON.stringify({ code, name: 'SSE' }) });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const id = login.json().device.id as string;
    const received: string[] = [];
    let closed = false;
    await new Promise<void>((ok, fail) => {
      const req = request({ host: '127.0.0.1', port, path: `${BASE}api/events`, headers: { Cookie: cookie } }, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          received.push(chunk);
          if (chunk.includes(': open')) {
            expect(app.clientCount()).toBe(1);
            app.broadcast({ type: 'navigate', to: 'retro' });
          }
          if (chunk.includes('"retro"')) {
            auth.revoke(id);
            app.dropDevice(id);
          }
        });
        res.on('end', () => {
          closed = true;
          ok();
        });
      });
      req.on('error', fail);
      req.end();
    });
    expect(received.join('')).toContain('data: {"type":"navigate","to":"retro"}');
    expect(closed).toBe(true);
    expect(app.clientCount()).toBe(0);
  });
});
