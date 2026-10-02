import { afterEach, describe, expect, it } from 'vitest';
import { VcsError, scrubSecrets, serverMessage } from '../src/main/vcs/errors';
import { HttpClient } from '../src/main/vcs/http';
import { cliFailure } from '../src/main/vcs/transport';
import { type FakeHost, noSleep, startFakeHost } from './helpers/fakeHost';
import { setLanguage } from '../src/shared/i18n';

const TOKEN = 'TESTTOKEN-not-a-real-secret-0001';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
  setLanguage('pt-BR');
});

async function client(routes: Parameters<typeof startFakeHost>[0], o: { retries?: number; timeoutMs?: number; maxWaitMs?: number; sleeps?: number[]; now?: () => number } = {}) {
  host = await startFakeHost(routes);
  const sleeps = o.sleeps ?? [];
  return new HttpClient({
    host: 'git.example.test',
    baseUrl: `${host.url}/api/v4`,
    headers: () => ({ 'PRIVATE-TOKEN': TOKEN, Accept: 'application/json' }),
    retries: o.retries,
    timeoutMs: o.timeoutMs,
    maxWaitMs: o.maxWaitMs,
    deps: { sleep: async (ms) => void sleeps.push(ms), now: o.now },
  });
}

const failure = async (p: Promise<unknown>): Promise<VcsError> => {
  try {
    await p;
  } catch (e) {
    return e as VcsError;
  }
  throw new Error('expected a failure');
};

describe('requests', () => {
  it('sends the credential in a header and parses JSON', async () => {
    const c = await client({ 'GET /api/v4/user': { json: { username: 'ana' } } });
    expect(await c.getJson('user')).toEqual({ username: 'ana' });
    expect(host?.hits[0].headers['private-token']).toBe(TOKEN);
  });

  it('merges the query into the path and keeps percent-encoding of the path', async () => {
    const c = await client({ 'GET /api/v4/projects/a%2Fb/issues': { json: [] } });
    await c.request('GET', 'projects/a%2Fb/issues?state=opened', { query: { page: 2, skip: undefined } });
    expect(host?.log()).toEqual(['GET /api/v4/projects/a%2Fb/issues?state=opened&page=2']);
  });

  it('refuses a path that could leave the API root or the host', async () => {
    const c = await client({});
    for (const bad of ['https://evil.test/x', '//evil.test/x', '/api/v4/user', '../../etc', 'a/../b', 'a/%2e%2e/b', 'a\\b', 'a\nb']) {
      await expect(c.request('GET', bad), bad).rejects.toBeInstanceOf(VcsError);
    }
    expect(host?.hits).toHaveLength(0);
  });

  it('sends JSON and form bodies', async () => {
    const c = await client({ 'POST /api/v4/a': { json: {} }, 'PUT /api/v4/b': { json: {} } });
    await c.request('POST', 'a', { json: { body: 'x' } });
    await c.request('PUT', 'b', { form: { 'reviewer_ids[]': '7' } });
    expect(host?.hits[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(host?.hits[0].body ?? '')).toEqual({ body: 'x' });
    expect(host?.hits[1].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(decodeURIComponent(host?.hits[1].body ?? '')).toBe('reviewer_ids[]=7');
  });
});

describe('errors', () => {
  it('maps the statuses to translated errors that never carry the token', async () => {
    const c = await client({
      'GET /api/v4/a': { status: 401, json: { message: `bad token ${TOKEN}` } },
      'GET /api/v4/b': { status: 403, json: { message: 'insufficient_scope' } },
      'GET /api/v4/c': { status: 404, json: { message: '404 Not Found' } },
      'GET /api/v4/d': { status: 422, json: { message: 'nope' } },
      'GET /api/v4/e': { status: 500, json: {} },
    });
    const a = await failure(c.getJson('a'));
    expect(a.code).toBe('auth');
    expect(a.message).toContain('git.example.test');
    expect(a.message).not.toContain(TOKEN);
    expect((await failure(c.getJson('b'))).code).toBe('forbidden');
    expect((await failure(c.getJson('b'))).message).toContain('insufficient_scope');
    expect((await failure(c.getJson('c', undefined, '!7'))).message).toContain('!7');
    expect((await failure(c.getJson('d'))).code).toBe('invalid');
    expect((await failure(c.getJson('e'))).code).toBe('server');
  });

  it('speaks English when the language is English', async () => {
    setLanguage('en');
    const c = await client({ 'GET /api/v4/a': { status: 401, json: {} } });
    expect((await failure(c.getJson('a'))).message).toMatch(/rejected the credential/);
    setLanguage('pt-BR');
    expect((await failure(c.getJson('a'))).message).toMatch(/recusou a credencial/);
  });

  it('scrubs token shapes from a server message', () => {
    const body = { message: 'x glpat-abcdefghij0123456789 y ghp_abcdefghijklmnopqrstuvwxyz0123456789 Bearer abcdef1234567890 z' };
    const out = serverMessage(body);
    expect(out).not.toMatch(/glpat-|ghp_|abcdef1234567890/);
    expect(scrubSecrets('https://u:pw@host/x?access_token=abc123&b=1')).not.toMatch(/pw@|abc123/);
  });
});

describe('retries', () => {
  it('retries a read after a 503 and then succeeds', async () => {
    const sleeps: number[] = [];
    const c = await client({ 'GET /api/v4/a': (_h, n) => (n < 3 ? { status: 503, json: {} } : { json: { ok: true } }) }, { sleeps });
    expect(await c.getJson('a')).toEqual({ ok: true });
    expect(host?.hits).toHaveLength(3);
    expect(sleeps).toEqual([400, 800]);
  });

  it('gives up after the retries and reports the server error', async () => {
    const c = await client({ 'GET /api/v4/a': { status: 502, json: {} } }, { retries: 1 });
    expect((await failure(c.getJson('a'))).code).toBe('server');
    expect(host?.hits).toHaveLength(2);
  });

  it('retries a network failure', async () => {
    const c = await client({ 'GET /api/v4/a': (_h, n) => (n === 1 ? { drop: true } : { json: { ok: 1 } }) });
    expect(await c.getJson('a')).toEqual({ ok: 1 });
    expect(host?.hits).toHaveLength(2);
  });

  it('never retries a write', async () => {
    const c = await client({ 'POST /api/v4/a': { status: 503, json: {} } });
    await expect(c.request('POST', 'a', { json: {} })).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(1);
  });

  it('retries a POST that only reads when it says so', async () => {
    const c = await client({ 'POST /api/v4/graphql': (_h, n) => (n === 1 ? { status: 503, json: {} } : { json: { data: {} } }) });
    await c.request('POST', 'graphql', { json: { query: '{ a }' }, idempotent: true });
    expect(host?.hits).toHaveLength(2);
  });

  it('times out and says how long it waited', async () => {
    const c = await client({ 'GET /api/v4/slow': { delayMs: 400, json: {} } }, { timeoutMs: 100, retries: 0 });
    const e = await failure(c.getJson('slow'));
    expect(e.code).toBe('timeout');
    expect(e.message).toMatch(/git\.example\.test/);
  });
});

describe('rate limits', () => {
  it('waits for Retry-After and retries a read', async () => {
    const sleeps: number[] = [];
    const c = await client({ 'GET /api/v4/a': (_h, n) => (n === 1 ? { status: 429, headers: { 'retry-after': '3' }, json: {} } : { json: { ok: 1 } }) }, { sleeps });
    expect(await c.getJson('a')).toEqual({ ok: 1 });
    expect(sleeps).toEqual([3000]);
  });

  it('reads GitHub-style x-ratelimit-reset on a 403', async () => {
    const sleeps: number[] = [];
    const now = 1_000_000_000_000;
    const c = await client(
      { 'GET /api/v4/a': (_h, n) => (n === 1 ? { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 5) }, json: { message: 'API rate limit exceeded' } } : { json: { ok: 1 } }) },
      { sleeps, now: () => now },
    );
    expect(await c.getJson('a')).toEqual({ ok: 1 });
    expect(sleeps[0]).toBe(5500);
  });

  it('does not sit through a long wait: it fails at once, saying how long to wait', async () => {
    const c = await client({ 'GET /api/v4/a': { status: 429, headers: { 'retry-after': '120' }, json: {} } }, { maxWaitMs: 20_000 });
    const e = await failure(c.getJson('a'));
    expect(e.code).toBe('rate_limited');
    expect(e.retryAfterMs).toBe(120_000);
    expect(e.message).toContain('120');
    expect(host?.hits).toHaveLength(1);
  });

  it('a plain 403 is a permission problem, not a rate limit', async () => {
    const c = await client({ 'GET /api/v4/a': { status: 403, json: { message: 'forbidden' } } });
    expect((await failure(c.getJson('a'))).code).toBe('forbidden');
    expect(host?.hits).toHaveLength(1);
  });
});

describe('pagination', () => {
  it('walks page/per_page until a short page', async () => {
    const page = (n: number) => Array.from({ length: n === 3 ? 4 : 100 }, (_, i) => ({ id: n * 1000 + i }));
    const c = await client({ 'GET /api/v4/items': (h) => ({ json: page(Number(h.query.get('page'))) }) });
    const rows = await c.pages<{ id: number }>('items');
    expect(rows).toHaveLength(204);
    expect(host?.log()).toEqual(['GET /api/v4/items?per_page=100&page=1', 'GET /api/v4/items?per_page=100&page=2', 'GET /api/v4/items?per_page=100&page=3']);
  });

  it('stops at maxPages', async () => {
    const c = await client({ 'GET /api/v4/items': { json: Array.from({ length: 100 }, (_, i) => i) } });
    expect(await c.pages('items', { maxPages: 2 })).toHaveLength(200);
  });

  it('follows next links of a values/next API, only on the same origin', async () => {
    host = await startFakeHost();
    const base = host.url;
    host.route('GET /api/v4/vals', (h) => (h.query.get('page') === '2' ? { json: { values: [3] } } : { json: { values: [1, 2], next: `${base}/api/v4/vals?page=2` } }));
    const c = new HttpClient({ host: 'x', baseUrl: `${base}/api/v4`, headers: () => ({}) });
    expect(await c.values<number>('vals')).toEqual([1, 2, 3]);
    host.route('GET /api/v4/evil', { json: { values: [1], next: 'http://127.0.0.1:1/steal' } });
    await expect(c.values('evil')).rejects.toBeInstanceOf(VcsError);
  });
});

describe('CLI failures read like HTTP failures', () => {
  const fail = (stderr: string, code: string | number = 1) => cliFailure(Object.assign(new Error(`Command failed: x\n${stderr}`), { stderr, code }), 'glab', 'git.example.test');

  it('maps the status the CLI prints', () => {
    expect(fail('glab: 404 Not Found (HTTP 404)').code).toBe('not_found');
    expect(fail('gh: Resource not accessible (HTTP 403)').code).toBe('forbidden');
    expect(fail('HTTP 429: API rate limit exceeded').code).toBe('rate_limited');
    expect(fail('glab: 500 Internal Server Error').code).toBe('server');
    expect(fail('You are not logged in to git.example.test').code).toBe('auth');
  });

  it('does not take a port or an id for a status', () => {
    expect(fail('dial tcp 127.0.0.1:5432: connect: connection refused').code).toBe('network');
    expect(fail('something failed for id 503 and 404 items').code).toBe('invalid');
  });

  it('knows a missing CLI and a killed one', () => {
    expect(fail('', 'ENOENT').code).toBe('cli_missing');
    expect(cliFailure(Object.assign(new Error('timed out'), { killed: true }), 'glab', 'h').code).toBe('timeout');
  });
});
