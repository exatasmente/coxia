import { describe, expect, it } from 'vitest';
import { readPluginDeclaration } from '../src/shared/plugins/declaration';
import { performPluginRequest, pluginSecretRef, requestTarget, resolvePluginRequest, type RequestingPlugin } from '../src/main/plugins/requests';

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
    ];
    for (const req of bad) expect(readPluginDeclaration(declaration({ settings, requests: [req] }), '/p').refused, req.id).toBeTruthy();
    expect(readPluginDeclaration(declaration({ settings, requests: [{ id: 'a', url: 'https://example.com' }, { id: 'a', url: 'https://example.com' }] }), '/p').refused).toBeTruthy();
  });

  it('reads the note to the agents, and refuses one that is not text or too long', () => {
    expect(readPluginDeclaration(declaration({ agents: 'ask me' }), '/p').declaration?.offers.agents).toBe('ask me');
    expect(readPluginDeclaration(declaration({}), '/p').declaration?.offers.agents).toBeNull();
    expect(readPluginDeclaration(declaration({ agents: 42 }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ agents: 'x'.repeat(1001) }), '/p').refused).toBeTruthy();
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
    for (const path of ['/../admin', '/a/../../b', 'relative', '/%2e%2e/x', '/x?y=1', '//evil.example.com']) expect(refused({ id: 'search', path }), path).toBeTruthy();
    expect(refused({ id: 'keyed', query: { key: 'mine' } })).toBeTruthy();
    expect(refused({ id: 'search', body: '{}' })).toBeTruthy();
    expect(refused({ id: 'post', body: '{}', contentType: 'application/xml' })).toBeTruthy();
    expect(refused({ id: 'post', body: '{}' })).toBeNull();
  });
});

describe('making the call', () => {
  const SECRET = 'sk-test-0123456789';
  const fakeFetch = (response: () => Response, seen: { url: string; init: RequestInit }[] = []) =>
    (async (url: URL | string, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return response();
    }) as typeof fetch;
  const secret = (ref: string) => (ref === pluginSecretRef('web-search', 'token') ? SECRET : null);
  const resolved = (call: Parameters<typeof resolvePluginRequest>[1]) => {
    const r = resolvePluginRequest(plugin(), call);
    if (!r.ok) throw new Error(r.refused);
    return r;
  };

  it('puts the secret in the declared header only, and takes it out of the response', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const out = await performPluginRequest({ fetch: fakeFetch(() => new Response(`{"echo":"Bearer ${SECRET}"}`, { headers: { 'content-type': 'application/json' } }), seen), secret }, plugin(), resolved({ id: 'search', query: { q: 'x' } }));
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(seen[0].init.redirect).toBe('manual');
    expect(out.ok && out.body).not.toContain(SECRET);
    expect(out.ok && out.status).toBe(200);
  });

  it('puts a query secret in the address of the call, never in what the plugin sees', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const r = resolved({ id: 'keyed' });
    await performPluginRequest({ fetch: fakeFetch(() => new Response('ok'), seen), secret }, plugin(), r);
    expect(seen[0].url).toContain(`key=${SECRET}`);
    expect(r.url.href).not.toContain(SECRET);
  });

  it('refuses when the secret is not filled in, without calling', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const out = await performPluginRequest({ fetch: fakeFetch(() => new Response('x'), seen), secret: () => null }, plugin(), resolved({ id: 'search' }));
    expect(out.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it('refuses a redirect, cuts a long response, and masks a failure', async () => {
    const redirect = await performPluginRequest({ fetch: fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com' } })), secret }, plugin(), resolved({ id: 'search' }));
    expect(redirect.ok).toBe(false);
    const long = await performPluginRequest({ fetch: fakeFetch(() => new Response('x'.repeat(5000))), secret, maxBytes: 1000 }, plugin(), resolved({ id: 'search' }));
    expect(long.ok && long.body.length).toBe(1000);
    expect(long.ok && long.truncated).toBe(true);
    const failed = await performPluginRequest({ fetch: (async () => { throw new Error(`refused with ${SECRET}`); }) as typeof fetch, secret }, plugin(), resolved({ id: 'search' }));
    expect(failed.ok).toBe(false);
    expect(failed.ok ? '' : failed.refused).not.toContain(SECRET);
  });
});
