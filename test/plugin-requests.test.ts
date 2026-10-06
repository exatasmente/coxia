import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPluginDeclaration } from '../src/shared/plugins/declaration';
import { performPluginRequest, pluginSecretRef, realTransport, requestTarget, resolvePluginRequest, type RequestingPlugin, type Transport } from '../src/main/plugins/requests';

// The requests a JavaScript plugin asks the app to make: what a declaration may say, how a call is checked against it and the person's settings, and
// how the app makes it — the secret only in the call, a redirect refused, the response cut and with the secret taken out. `fetch` is a fake: nothing
// here reaches the network.

const declaration = (offers: Record<string, unknown>) => JSON.stringify({ id: 'web-search', name: 'Web search', offers: { entry: 'index.mjs', ...offers } });
const settings = [
  { key: 'url', label: 'URL', kind: 'url' },
  { key: 'token', label: 'Key', kind: 'secret' },
];

describe('what a declaration may say about settings and requests', () => {
  it('reads settings and requests of a JavaScript plugin', () => {
    const r = readPluginDeclaration(declaration({ settings, requests: [{ id: 'search', url: '{settings.url}/search', secret: { setting: 'token', in: 'header', name: 'Authorization', format: 'Bearer {secret}' } }, { id: 'post', method: 'post', url: 'https://hooks.example.com/notify', write: true }] }), '/p');
    expect(r.refused).toBeNull();
    expect(r.declaration?.offers.runtime).toBe('js');
    expect(r.declaration?.offers.requests).toEqual([
      { id: 'search', method: 'GET', url: '{settings.url}/search', secret: { setting: 'token', in: 'header', name: 'Authorization', format: 'Bearer {secret}' }, write: false, reversible: false },
      { id: 'post', method: 'POST', url: 'https://hooks.example.com/notify', secret: null, write: true, reversible: false },
    ]);
  });

  it('refuses settings and requests on a shell plugin', () => {
    expect(readPluginDeclaration(JSON.stringify({ id: 'x', name: 'X', offers: { entry: 'run.sh', settings } }), '/p').refused).toContain('JavaScript');
  });

  it('refuses a request it could not check', () => {
    const bad = [
      { id: 'a', url: 'http://plain.example.com/x' },
      { id: 'b', url: 'https://user:pw@example.com/x' },
      { id: 'c', url: 'https://example.com/x?q=1' },
      { id: 'd', url: '{settings.missing}/x' },
      { id: 'e', url: '{settings.token}/x' },
      { id: 'f', url: 'https://example.com', method: 'TRACE' },
      { id: 'G', url: 'https://example.com' },
      { id: 'h', url: 'https://example.com', secret: { setting: 'url', name: 'x' } },
      { id: 'i', url: 'https://example.com', secret: { setting: 'token', in: 'body', name: 'x' } },
      { id: 'j', url: 'https://localhost/x' },
      { id: 'k', url: 'https://127.0.0.1:8080/x' },
      { id: 'l', url: 'https://2130706433/x' },
      { id: 'm', url: 'https://0x7f.1/x' },
      { id: 'n', url: 'https://[::1]/x' },
      { id: 'o', url: 'https://metadata.internal/x' },
      { id: 'p', url: 'https://intranet/x' },
      { id: 'q', url: 'https://api.example.com/v1', method: 'DELETE' },
      { id: 'r', url: 'https://api.example.com/v1', method: 'POST' },
    ];
    for (const req of bad) expect(readPluginDeclaration(declaration({ settings, requests: [req] }), '/p').refused, req.id).toBeTruthy();
    expect(readPluginDeclaration(declaration({ settings, requests: [{ id: 'a', url: 'https://example.com' }, { id: 'a', url: 'https://example.com' }] }), '/p').refused).toBeTruthy();
  });

  it('refuses a setting key that is not plain, repeated, of an unknown kind, or a secret whose reference would be too long', () => {
    for (const s of [[{ key: 'Url', kind: 'url' }], [{ key: 'u', kind: 'url' }, { key: 'u', kind: 'text' }], [{ key: 'u', kind: 'number' }]]) {
      expect(readPluginDeclaration(declaration({ settings: s }), '/p').refused, JSON.stringify(s)).toBeTruthy();
    }
    const longId = JSON.stringify({ id: 'a'.repeat(30), name: 'X', offers: { entry: 'index.mjs', settings: [{ key: 'k'.repeat(30), kind: 'secret' }] } });
    expect(readPluginDeclaration(longId, '/p').refused).toBeTruthy();
  });
});

const plugin = (over: Partial<RequestingPlugin> = {}): RequestingPlugin => ({
  id: 'web-search',
  settings: [
    { key: 'url', label: 'URL', kind: 'url', required: true },
    { key: 'token', label: 'Key', kind: 'secret', required: false },
  ],
  values: { url: 'http://127.0.0.1:8888/' },
  requests: [
    { id: 'search', method: 'GET', url: '{settings.url}/search', secret: { setting: 'token', in: 'header', name: 'Authorization', format: 'Bearer {secret}' }, write: false, reversible: false },
    { id: 'keyed', method: 'GET', url: 'https://api.example.com/v1', secret: { setting: 'token', in: 'query', name: 'key', format: '{secret}' }, write: false, reversible: false },
    { id: 'post', method: 'POST', url: 'https://hooks.example.com/notify', secret: null, write: true, reversible: false },
  ],
  ...over,
});

describe('checking a call against the declaration', () => {
  it('builds the address from the setting, the declared path, the asked path and the query', () => {
    const r = resolvePluginRequest(plugin(), { id: 'search', path: '/more', query: { q: 'a b', format: 'json' } });
    expect(r.ok && r.url.href).toBe('http://127.0.0.1:8888/search/more?q=a+b&format=json');
    expect(r.ok && requestTarget(r)).toBe('GET http://127.0.0.1:8888/search/more');
  });

  it('refuses an undeclared id, an empty setting, a path that leaves the declared one, a query that overrides the secret, and a body on a GET', () => {
    const refused = (call: Parameters<typeof resolvePluginRequest>[1], p = plugin()) => {
      const r = resolvePluginRequest(p, call);
      return r.ok ? null : r.refused;
    };
    expect(refused({ id: 'ghost' })).toBeTruthy();
    expect(refused({ id: 'search' }, plugin({ values: {} }))).toBeTruthy();
    for (const path of ['/../admin', '/a/../../b', 'relative', '/%2e%2e/x', '/x?y=1', '//evil.example.com', '/x%2f..%2f..%2fadmin', '/x%5cy', '/x%00', '/x%252f']) expect(refused({ id: 'search', path }), path).toBeTruthy();
    expect(refused({ id: 'keyed', query: { key: 'mine' } })).toBeTruthy();
    expect(refused({ id: 'search', body: '{}' })).toBeTruthy();
    expect(refused({ id: 'post', body: '{}', contentType: 'application/xml' })).toBeTruthy();
    expect(refused({ id: 'post', body: '{}' })).toBeNull();
  });
});

describe('making the call', () => {
  const SECRET = 'sk-test-0123456789/=&';
  type Seen = { url: string; init: Parameters<Transport>[1] };
  const fake = (status: number, body: string, seen: Seen[] = []): Transport => async (url, init) => {
    seen.push({ url: url.href, init });
    return { status, contentType: 'application/json', read: async (max) => ({ text: body.slice(0, max), truncated: body.length > max }), dispose: () => undefined };
  };
  const secret = (ref: string) => (ref === pluginSecretRef('web-search', 'token') ? SECRET : null);
  const resolved = (call: Parameters<typeof resolvePluginRequest>[1]) => {
    const r = resolvePluginRequest(plugin(), call);
    if (!r.ok) throw new Error(r.refused);
    return r;
  };

  it('puts the secret in the declared header only, and takes it out of the response in every form', async () => {
    const seen: Seen[] = [];
    const echo = JSON.stringify({ raw: SECRET, bearer: `Bearer ${SECRET}`, encoded: encodeURIComponent(SECRET) });
    const out = await performPluginRequest({ transport: fake(200, echo, seen), secret }, plugin(), resolved({ id: 'search', query: { q: 'x' } }));
    expect(seen[0].init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(seen[0].init.allowPrivate).toBe(true);
    expect(out.ok && out.body).not.toContain(SECRET);
    expect(out.ok && out.body).not.toContain(encodeURIComponent(SECRET));
    expect(out.ok && out.status).toBe(200);
  });

  it('never lets a declared address reach a private one, only the person\'s setting', async () => {
    const seen: Seen[] = [];
    await performPluginRequest({ transport: fake(200, 'ok', seen), secret }, plugin(), resolved({ id: 'keyed' }));
    expect(seen[0].init.allowPrivate).toBe(false);
  });

  it('puts a query secret in the address of the call, never in what the plugin sees', async () => {
    const seen: Seen[] = [];
    const r = resolved({ id: 'keyed' });
    await performPluginRequest({ transport: fake(200, 'ok', seen), secret }, plugin(), r);
    expect(seen[0].url).toContain(`key=${encodeURIComponent(SECRET)}`);
    expect(r.url.href).not.toContain('sk-test');
  });

  it('refuses when the secret is not filled in, without calling', async () => {
    const seen: Seen[] = [];
    const out = await performPluginRequest({ transport: fake(200, 'x', seen), secret: () => null }, plugin(), resolved({ id: 'search' }));
    expect(out.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it('refuses a redirect, cuts a long response, and masks a failure', async () => {
    expect((await performPluginRequest({ transport: fake(302, ''), secret }, plugin(), resolved({ id: 'search' }))).ok).toBe(false);
    const long = await performPluginRequest({ transport: fake(200, 'x'.repeat(5000)), secret, maxBytes: 1000 }, plugin(), resolved({ id: 'search' }));
    expect(long.ok && long.body.length).toBe(1000);
    expect(long.ok && long.truncated).toBe(true);
    const failed = await performPluginRequest({ transport: async () => { throw new Error(`refused with ${SECRET}`); }, secret }, plugin(), resolved({ id: 'search' }));
    expect(failed.ok).toBe(false);
    expect(failed.ok ? '' : failed.refused).not.toContain(SECRET);
  });
});

describe('the real transport', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => (req.url === '/redirect' ? res.writeHead(302, { location: 'https://example.com' }).end() : res.writeHead(200, { 'content-type': 'text/plain' }).end(`hello ${req.method}`)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('reaches a loopback address only when the person set it', async () => {
    const url = new URL(`http://127.0.0.1:${port}/x`);
    const ok = await realTransport(url, { method: 'GET', headers: {}, timeoutMs: 5000, allowPrivate: true });
    expect(ok.status).toBe(200);
    expect((await ok.read(1000)).text).toBe('hello GET');
    await expect(realTransport(url, { method: 'GET', headers: {}, timeoutMs: 5000, allowPrivate: false })).rejects.toThrow();
  });

  it('refuses a name that resolves to a private address, on the address it connects to', async () => {
    await expect(realTransport(new URL(`http://localhost:${port}/x`), { method: 'GET', headers: {}, timeoutMs: 5000, allowPrivate: false })).rejects.toThrow();
  });

  it('does not follow a redirect', async () => {
    const res = await realTransport(new URL(`http://127.0.0.1:${port}/redirect`), { method: 'GET', headers: {}, timeoutMs: 5000, allowPrivate: true });
    expect(res.status).toBe(302);
  });
});

describe('the kit example in JavaScript', () => {
  it('has a declaration the platform reads', async () => {
    const { readFileSync } = await import('node:fs');
    const r = readPluginDeclaration(readFileSync(new URL('../docs/plugins/example-notify/plugin.json', import.meta.url), 'utf8'), '/p');
    expect(r.refused).toBeNull();
    expect(r.declaration?.offers.requests[0]).toMatchObject({ id: 'notify', write: true, reversible: false });
  });
});
