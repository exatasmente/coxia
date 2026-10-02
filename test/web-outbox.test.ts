import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type WebSettings } from '../src/shared/settings';
import { QUEUEABLE, isQueueable } from '../src/shared/outbox';
import { encodeWire } from '../src/shared/wire';
import { createWebApp, type WebApp } from '../src/main/web';
import { createAuth, type Auth } from '../src/main/webAuth';
import { createIdempotency, IdempotencyConflict } from '../src/main/webIdempotency';
import { webAccess } from '../src/main/webPolicy';
import { channels, handle, handleDevice, hasChannel, invoke } from '../src/main/rpc';

const BASE = '/cerimonias/';
const HEAD = { 'Content-Type': 'application/json', 'X-Cerimonias': '1' };

describe('queueable channels', () => {
  it('are all allowed to the browser and none has an external effect', () => {
    for (const channel of Object.keys(QUEUEABLE)) expect(webAccess(channel)).toBe('allow');
    for (const channel of ['actions:approve', 'claude:continue', 'clipboard:copy', 'web:revoke', 'voice:transcribe', 'settings:save']) expect(isQueueable(channel)).toBe(false);
  });
});

describe('device-bound channels', () => {
  it('are not bound to IPC and need a device id', async () => {
    const seen: unknown[] = [];
    handleDevice('push:probe', (id: string, x: string) => seen.push([id, x]));
    handle('plain:probe', () => 1);
    expect(hasChannel('push:probe')).toBe(true);
    expect(channels()).not.toContain('push:probe');
    await expect(invoke('push:probe', ['a'])).rejects.toThrow(/navegador/);
    await invoke('push:probe', ['a'], 'dev9');
    expect(seen).toEqual([['dev9', 'a']]);
    expect(webAccess('push:probe')).toBe('allow');
  });
});

describe('idempotency', () => {
  it('runs once per key, joins a call in flight and expires', async () => {
    let now = 0;
    const idem = createIdempotency(1000, 3, () => now);
    let runs = 0;
    let release: (v: string) => void = () => undefined;
    const slow = () => new Promise<string>((ok) => { runs++; release = ok; });
    const a = idem.run('d', 'qa:ask', 'key-0001', slow);
    const b = idem.run('d', 'qa:ask', 'key-0001', slow);
    release('answer');
    expect(await a).toBe('answer');
    expect(await b).toBe('answer');
    expect(runs).toBe(1);
    expect(await idem.run('d', 'qa:ask', 'key-0001', async () => 'other')).toBe('answer');
    expect(await idem.run('e', 'qa:ask', 'key-0001', async () => 'other device')).toBe('other device');
    await expect(idem.run('d', 'deep:ask', 'key-0001', async () => 'x')).rejects.toBeInstanceOf(IdempotencyConflict);
    now = 2000;
    expect(await idem.run('d', 'qa:ask', 'key-0001', async () => 'fresh')).toBe('fresh');
  });

  it('forgets failures so a retry runs again, and bounds its size', async () => {
    const idem = createIdempotency(60_000, 3);
    await expect(idem.run('d', 'qa:ask', 'key-0001', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await idem.run('d', 'qa:ask', 'key-0001', async () => 'ok')).toBe('ok');
    for (let i = 0; i < 10; i++) await idem.run('d', 'qa:ask', `key-1000${i}`, async () => i);
    expect(idem.size()).toBeLessThanOrEqual(4);
  });
});

describe('http: replays of a queued send', () => {
  let app: WebApp;
  let auth: Auth;
  let port: number;
  let web: WebSettings;
  const calls: Array<[string, string | undefined]> = [];
  let gate: Promise<void> = Promise.resolve();

  const http = (path: string, headers: Record<string, string>, body: string, cookie?: string): Promise<{ status: number; json: () => any }> =>
    new Promise((ok, fail) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          ok({ status: res.statusCode ?? 0, json: () => JSON.parse(text) });
        });
      });
      req.on('error', fail);
      req.end(body);
    });

  async function pair(name: string): Promise<string> {
    const { code } = auth.newPairingCode();
    const res = await new Promise<string>((ok, fail) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: `${BASE}api/login`, headers: HEAD }, (r) => {
        r.resume();
        r.on('end', () => ok(String(r.headers['set-cookie']).split(';')[0]));
      });
      req.on('error', fail);
      req.end(JSON.stringify({ code, name }));
    });
    return res;
  }

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cer-outbox-'));
    const renderer = join(dir, 'renderer');
    mkdirSync(renderer, { recursive: true });
    writeFileSync(join(renderer, 'index.html'), 'x');
    auth = createAuth(join(dir, 'web-sessions.json'));
    web = { ...DEFAULT_SETTINGS.web, enabled: true, basePath: BASE, publicUrl: 'https://coxia.acme.test/cerimonias/' };
    app = createWebApp({
      settings: () => web,
      rendererDir: renderer,
      auth,
      hasChannel: (c) => ['qa:ask', 'actions:approve', 'state:load', 'boom'].includes(c),
      invoke: async (channel, args, deviceId) => {
        calls.push([channel, deviceId]);
        await gate;
        if (channel === 'boom') throw new Error('falhou');
        return { channel, args, n: calls.length };
      },
    });
    await new Promise<void>((ok) => app.server.listen(0, '127.0.0.1', ok));
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(() => app.close());

  const send = (channel: string, key: string | undefined, cookie: string, args: unknown[] = ['q']) =>
    http(`${BASE}api/rpc/${encodeURIComponent(channel)}`, { ...HEAD, ...(key ? { 'X-Idempotency-Key': key } : {}) }, JSON.stringify(encodeWire(args)), cookie);

  it('runs a repeated queueable call once and returns the same answer', async () => {
    const cookie = await pair('Pixel');
    calls.length = 0;
    const a = await send('qa:ask', 'replay-key-1', cookie);
    const b = await send('qa:ask', 'replay-key-1', cookie);
    expect(a.status).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(calls.filter((c) => c[0] === 'qa:ask')).toHaveLength(1);
    expect(calls[0][1]).toBeTruthy();
  });

  it('joins a replay that arrives while the first call is still running', async () => {
    const cookie = await pair('Pixel');
    calls.length = 0;
    let release: () => void = () => undefined;
    gate = new Promise<void>((ok) => (release = ok));
    const first = send('qa:ask', 'inflight-key-1', cookie);
    await new Promise((r) => setTimeout(r, 50));
    const second = send('qa:ask', 'inflight-key-1', cookie);
    await new Promise((r) => setTimeout(r, 50));
    release();
    gate = Promise.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.json()).toEqual(b.json());
    expect(calls).toHaveLength(1);
  });

  it('does not dedupe calls without a key, other channels, other devices, or failures', async () => {
    const one = await pair('A');
    const two = await pair('B');
    calls.length = 0;
    await send('qa:ask', undefined, one);
    await send('qa:ask', undefined, one);
    await send('state:load', 'not-queueable-1', one);
    await send('state:load', 'not-queueable-1', one);
    await send('qa:ask', 'device-key-1', one);
    await send('qa:ask', 'device-key-1', two);
    expect(calls).toHaveLength(6);
    calls.length = 0;
    expect((await send('boom', 'fail-key-001', one)).status).toBe(500);
    expect((await send('boom', 'fail-key-001', one)).status).toBe(500);
    expect(calls).toHaveLength(2);
  });

  it('refuses a malformed key, a key reused on another channel, and policy-denied channels', async () => {
    const cookie = await pair('Pixel');
    expect((await send('qa:ask', 'short', cookie)).status).toBe(400);
    expect((await send('qa:ask', 'bad key with spaces', cookie)).status).toBe(400);
    await send('qa:ask', 'conflict-key-1', cookie);
    expect((await send('actions:approve', 'conflict-key-1', cookie)).status).toBe(403);
    expect((await send('qa:ask', 'conflict-key-1', cookie)).status).toBe(200);
  });
});
