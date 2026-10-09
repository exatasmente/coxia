// The sites an agent's logged-in browser holds: listed and revoked by the browser itself, started on the closed profile with no window and no network. The unit part runs the
// two code strings against a fake page and the flow against a fake runtime; the real part, only where a sandbox, a display program, a Chromium and openssl exist, seeds a
// real profile through a real proxy and then lists and revokes it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { type AddressInfo, connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { findChromium } from '../src/main/browser/chromium';
import { type BrowserRuntime, startBrowser } from '../src/main/browser/launch';
import { createProfileLocks, ensureProfile, openProfile, profileDirOf } from '../src/main/browser/profile';
import { CANDIDATES_MAX, LIST_CODE, candidateHosts, createSitesApi, isSite, listCode, listSites, parseSites, revokeAll, revokeCode, revokeSite } from '../src/main/browser/sites';
import { displayProgram } from '../src/main/sandbox';
import { probeSandbox } from '../src/main/sandbox/probe';

// ---- the two code strings, against a fake page ---------------------------------------------------------------------------------------------

interface Cookie {
  domain: string;
  name: string;
  value: string;
}

/** A page that keeps `storage` by origin (the count the page itself would give) and records what the code did to it. */
function fakePage(cookies: Cookie[], storage: Record<string, number>) {
  const cleared: RegExp[] = [];
  const cdp: { origin: string; storageTypes: string }[] = [];
  const visited: string[] = [];
  const routes: string[] = [];
  let current = '';
  const context = {
    cookies: async () => cookies,
    clearCookies: async (o: { domain: RegExp }) => void cleared.push(o.domain),
    newCDPSession: async () => ({ send: async (method: string, p: { origin: string; storageTypes: string }) => void (method === 'Storage.clearDataForOrigin' && cdp.push(p)) }),
  };
  const page = {
    context: () => context,
    route: async (glob: string) => void routes.push(`route ${glob}`),
    unroute: async (glob: string) => void routes.push(`unroute ${glob}`),
    goto: async (url: string) => {
      current = new URL(url).origin;
      visited.push(current);
      if (current.includes('broken')) throw new Error('cannot go there');
    },
    evaluate: async () => storage[current] ?? 0,
  };
  return { page, cleared, cdp, visited, routes };
}
const run = (code: string, page: unknown): Promise<unknown> => (vm.runInNewContext(`(${code})`, { URL }) as (p: unknown) => Promise<unknown>)(page);

const COOKIES: Cookie[] = [
  { domain: '.example.com', name: 'sid', value: 'a-secret-session-value' },
  { domain: 'example.com', name: 'pref', value: 'dark' },
  { domain: 'www.example.com', name: 'sid', value: 'another-secret' },
  { domain: '.shop.example.net', name: 'cart', value: 'three-items' },
];
const STORAGE: Record<string, number> = { 'https://example.com': 3, 'https://www.example.com': 1 };

describe('the code that reads and clears a profile', () => {
  it('lists the sites that hold a cookie with counts only: no cookie name, no value, no storage key, and no request for the page to make', async () => {
    const { page, visited, routes } = fakePage([...COOKIES, { domain: '.broken.example.org', name: 'x', value: 'y' }], STORAGE);
    const sites = (await run(LIST_CODE, page)) as unknown[];
    expect(sites).toEqual([
      { site: 'example.com', cookies: 2, storage: 3 },
      { site: 'www.example.com', cookies: 1, storage: 1 },
      { site: 'shop.example.net', cookies: 1, storage: 0 },
      { site: 'broken.example.org', cookies: 1, storage: 0 },
    ]);
    // Every site is asked on a page that is answered before the network: the interception comes first and is taken off last.
    expect(routes).toEqual(['route **/*', 'unroute **/*']);
    expect(visited).toEqual(['https://example.com', 'https://www.example.com', 'https://shop.example.net', 'https://broken.example.org']);
    const text = JSON.stringify(sites);
    for (const secret of ['a-secret-session-value', 'dark', 'a-token-value', 'three-items', 'sid', 'token', 'cart']) expect(text).not.toContain(secret);
  });

  it('finds a site that keeps a login in local storage alone when its host is one the app already knows, and asks about nothing that is not a host name', async () => {
    const { page, visited } = fakePage(COOKIES, { ...STORAGE, 'https://app.example.com': 2 });
    const sites = (await run(listCode(['app.example.com', 'example.com', '"; process.exit(1); "', 'Has Space.example.com']), page)) as { site: string }[];
    expect(sites.map((x) => x.site)).toEqual(['example.com', 'www.example.com', 'shop.example.net', 'app.example.com']);
    expect(sites.find((x) => x.site === 'app.example.com')).toEqual({ site: 'app.example.com', cookies: 0, storage: 2 });
    expect(visited).not.toContain('https://has space.example.com');
    expect(listCode(['"; process.exit(1); "'])).not.toContain('process.exit');
    // Without hosts it is the code it always was.
    expect(listCode()).toBe(LIST_CODE);
  });

  it('clears the cookies of exactly one host, with or without its leading dot, and the storage of its origins only', async () => {
    const fake = fakePage(COOKIES, STORAGE);
    expect(await run(revokeCode('example.com'), fake.page)).toBe('cleared');
    expect(fake.cleared).toHaveLength(1);
    const re = fake.cleared[0];
    for (const hit of ['example.com', '.example.com']) expect(re.test(hit), hit).toBe(true);
    for (const miss of ['www.example.com', 'badexample.com', 'exampleXcom', 'example.com.evil.net', '.shop.example.net']) expect(re.test(miss), miss).toBe(false);
    expect(fake.cdp).toEqual([
      { origin: 'https://example.com', storageTypes: 'all' },
      { origin: 'http://example.com', storageTypes: 'all' },
    ]);
  });

  it('puts a host name into the code and nothing else, as a string literal', () => {
    expect(revokeCode('a.example.com')).toContain('const site = "a.example.com";');
    expect(LIST_CODE).not.toMatch(/\$\{|fetch|\beval\(|require|import\(/);
    expect(LIST_CODE).not.toContain('storageState');
  });
});

describe('the hosts a login may hide at', () => {
  it('are the hosts the agent may reach, then the ones its earlier screens reached, each once, as host names only', () => {
    const closings: { fields?: Record<string, string> }[] = [
      { fields: { hostsAllowed: 'App.Example.com=12, cdn.example.com=40, …' } },
      { fields: { hostsAllowed: 'app.example.com=3, bad host=1, evil.example.net/x=2' } },
      { fields: {} },
      {},
    ];
    expect(candidateHosts(['docs.example.com', 'app.example.com'], closings)).toEqual(['docs.example.com', 'app.example.com', 'cdn.example.com']);
    expect(candidateHosts(undefined, [])).toEqual([]);
  });

  it('are bounded', () => {
    const many = Array.from({ length: CANDIDATES_MAX + 30 }, (_, i) => `h${i}.example.com`);
    expect(candidateHosts(many, [])).toHaveLength(CANDIDATES_MAX);
    expect(candidateHosts([], [{ fields: { hostsAllowed: many.map((h) => `${h}=1`).join(', ') } }])).toHaveLength(CANDIDATES_MAX);
  });
});

describe('what a site may be', () => {
  it('is a host name: lowercase letters, digits, dots and hyphens', () => {
    for (const ok of ['example.com', 'a.b.example.com', 'localhost', 'xn--bcher-kva.example', '127.0.0.1']) expect(isSite(ok), ok).toBe(true);
    for (const bad of ['', 'Example.com', 'example.com/', 'a b', 'a"b', "a'b", 'a;b', '.example.com', 'example.com.', '-a.com', '${x}', 'a\nb', 'x'.repeat(260), 7, null]) expect(isSite(bad), String(bad)).toBe(false);
  });

  it('is read out of what the browser answered, as counts, and nothing else of it', () => {
    const answer = `### Result\n${JSON.stringify([
      { site: 'b.example.com', cookies: 2, storage: 0, value: 'leak' },
      { site: 'a.example.com', cookies: 1, storage: 4 },
      { site: 'bad host', cookies: 9, storage: 9 },
      { site: 'empty.example.com', cookies: 0, storage: 0 },
      { site: 'odd.example.com', cookies: -3, storage: 'many' },
      'text',
    ])}\n### Ran Playwright code\nawait (async () => {})(page);`;
    expect(parseSites(answer)).toEqual([
      { site: 'a.example.com', cookies: 1, storage: 4 },
      { site: 'b.example.com', cookies: 2, storage: 0 },
    ]);
    expect(JSON.stringify(parseSites(answer))).not.toContain('leak');
    expect(parseSites('### Error\nboom')).toBeNull();
    expect(parseSites('### Result\n{"a":1}')).toBeNull();
    expect(parseSites('### Result\nnot json')).toBeNull();
    expect(parseSites('')).toBeNull();
  });
});

// ---- the flow, with a fake runtime -----------------------------------------------------------------------------------------------------------

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-sites-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fakeLaunch(over: { answers?: string[]; launchFails?: boolean; callFails?: boolean } = {}) {
  const state = { launched: [] as string[], codes: [] as string[], closed: 0, held: [] as (string | null)[] };
  const answers = [...(over.answers ?? [])];
  const locks = createProfileLocks();
  const launch = async (profileDir: string): Promise<BrowserRuntime> => {
    if (over.launchFails) throw new Error('no browser here');
    state.launched.push(profileDir);
    state.held.push(locks.holder(profileDir));
    return {
      client: {
        callTool: async (_name: string, args: Record<string, unknown>) => {
          if (over.callFails) throw new Error('the browser went away');
          state.codes.push(String(args.code));
          return { content: [{ type: 'text', text: answers.shift() ?? '### Result\n[]' }] };
        },
      },
      close: async () => void state.closed++,
    } as unknown as BrowserRuntime;
  };
  return { state, locks, launch };
}
const list = (sites: object[]): string => `### Result\n${JSON.stringify(sites)}`;

describe('listing and revoking the sites of a profile', () => {
  it('starts the browser on the profile with the profile locked, reads the list, and lets everything go', async () => {
    const dir = ensureProfile(root, 'reader');
    const { state, locks, launch } = fakeLaunch({ answers: [list([{ site: 'example.com', cookies: 1, storage: 0 }])] });
    expect(await listSites('reader', { workspaceDir: root, launch, locks })).toEqual({ ok: true, sites: [{ site: 'example.com', cookies: 1, storage: 0 }] });
    expect(state.launched).toEqual([dir]);
    expect(state.held).toEqual(['sites:reader']);
    expect(state.codes).toEqual([LIST_CODE]);
    expect(state.closed).toBe(1);
    expect(locks.holder(dir)).toBeNull();
  });

  it('asks the browser about the hosts it is told the agent may have kept something at, and about no other', async () => {
    ensureProfile(root, 'hosted');
    const { state, locks, launch } = fakeLaunch({ answers: [list([{ site: 'app.example.com', cookies: 0, storage: 2 }])] });
    const got = await listSites('hosted', { workspaceDir: root, launch, locks, candidates: (agent) => (agent === 'hosted' ? ['app.example.com'] : ['other.example.com']) });
    expect(got).toEqual({ ok: true, sites: [{ site: 'app.example.com', cookies: 0, storage: 2 }] });
    expect(state.codes).toEqual([listCode(['app.example.com'])]);
    expect(state.codes[0]).not.toContain('other.example.com');
  });

  it('is refused while a screen of the agent holds the profile, and starts nothing', async () => {
    const dir = ensureProfile(root, 'busy-agent');
    const { state, locks, launch } = fakeLaunch();
    const held = openProfile(root, 'busy-agent', 'call:thread-1:busy-agent', { locks });
    expect(held.ok).toBe(true);
    expect(await listSites('busy-agent', { workspaceDir: root, launch, locks })).toEqual({ ok: false, why: 'open' });
    expect(await revokeSite('busy-agent', 'example.com', { workspaceDir: root, launch, locks })).toEqual({ ok: false, why: 'open' });
    writeFileSync(join(dir, 'Cookies'), 'x');
    expect(revokeAll('busy-agent', { workspaceDir: root, locks })).toEqual({ ok: false, why: 'open' });
    expect(existsSync(join(dir, 'Cookies'))).toBe(true);
    expect(state.launched).toEqual([]);
    if (held.ok) held.release();
    expect(revokeAll('busy-agent', { workspaceDir: root, locks })).toEqual({ ok: true, removed: true, sites: [] });
    expect(existsSync(dir)).toBe(false);
  });

  it('says a profile is being read when the second ask comes while it is', async () => {
    ensureProfile(root, 'twice');
    const { locks, launch } = fakeLaunch();
    const held = openProfile(root, 'twice', 'sites:twice', { locks });
    expect(held.ok).toBe(true);
    expect(await listSites('twice', { workspaceDir: root, launch, locks })).toEqual({ ok: false, why: 'busy' });
    if (held.ok) held.release();
  });

  it('makes no profile to find out that there is none', async () => {
    const { state, launch } = fakeLaunch();
    expect(await listSites('never-used', { workspaceDir: root, launch })).toEqual({ ok: true, sites: [] });
    expect(await revokeSite('never-used', 'example.com', { workspaceDir: root, launch })).toEqual({ ok: true, removed: false, sites: [] });
    expect(existsSync(profileDirOf(root, 'never-used'))).toBe(false);
    expect(state.launched).toEqual([]);
  });

  it('clears one site and reads what is left', async () => {
    ensureProfile(root, 'revoker');
    const { state, launch } = fakeLaunch({ answers: ['### Result\n"cleared"', list([{ site: 'b.example.com', cookies: 1, storage: 1 }])] });
    const r = await revokeSite('revoker', 'a.example.com', { workspaceDir: root, launch });
    expect(r).toEqual({ ok: true, removed: true, sites: [{ site: 'b.example.com', cookies: 1, storage: 1 }] });
    expect(state.codes).toEqual([revokeCode('a.example.com'), LIST_CODE]);
    // A site that is still there after the clearing is said so.
    const again = fakeLaunch({ answers: ['### Result\n"cleared"', list([{ site: 'a.example.com', cookies: 1, storage: 0 }])] });
    expect(await revokeSite('revoker', 'a.example.com', { workspaceDir: root, launch: again.launch })).toMatchObject({ ok: true, removed: false });
  });

  it('refuses a site that is not a host name before any browser is started', async () => {
    ensureProfile(root, 'careful');
    const { state, launch } = fakeLaunch();
    for (const site of ['', 'a"; process.exit(1); "', 'Example.com', 'a b', '../x']) expect(await revokeSite('careful', site, { workspaceDir: root, launch }), site).toEqual({ ok: false, why: 'site' });
    expect(state.launched).toEqual([]);
  });

  it('lets the profile go and closes the browser however it fails', async () => {
    const dir = ensureProfile(root, 'failing');
    for (const over of [{ launchFails: true }, { callFails: true }, { answers: ['### Error\nboom'] }]) {
      const { state, locks, launch } = fakeLaunch(over);
      const r = await listSites('failing', { workspaceDir: root, launch, locks });
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ why: over.launchFails ? 'browser' : 'failed' });
      expect(locks.holder(dir)).toBeNull();
      expect(state.closed).toBe(over.launchFails ? 0 : 1);
    }
  });

  it('answers only for an agent that is in the team, and revokes everything when no site is named', async () => {
    const dir = ensureProfile(root, 'member');
    writeFileSync(join(dir, 'Cookies'), 'x');
    const { launch } = fakeLaunch();
    const api = createSitesApi({ agents: () => ['member'], workspaceDir: () => root, launch });
    expect(await api.sites('ghost')).toEqual({ ok: false, why: 'agent' });
    expect(await api.sites(42)).toEqual({ ok: false, why: 'agent' });
    expect(await api.revoke('ghost')).toEqual({ ok: false, why: 'agent' });
    expect(await api.revoke('member', 'bad site')).toEqual({ ok: false, why: 'site' });
    expect(existsSync(join(dir, 'Cookies'))).toBe(true);
    expect(await api.revoke('member')).toEqual({ ok: true, removed: true, sites: [] });
    expect(existsSync(dir)).toBe(false);
    // A new empty profile is made at the next use, not by revoking.
    expect(await api.sites('member')).toEqual({ ok: true, sites: [] });
  });
});

// ---- a real profile ------------------------------------------------------------------------------------------------------------------------

const sandbox = await probeSandbox();
const chromium = (() => {
  const dir = join(homedir(), '.cache', 'ms-playwright');
  return existsSync(dir) ? findChromium(dir) : ({ ok: false, why: 'none' } as const);
})();
const openssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const real = sandbox.available && displayProgram([]) !== null && chromium.ok && openssl;

describe.skipIf(!real)('a real profile', () => {
  const A = 'a.example.com';
  const B = 'b.example.com';
  let site: ReturnType<typeof createServer>;
  let port: number;
  const cookiesSeen: Record<string, string> = {};
  const storageSeen: Record<string, string> = {};
  const live: BrowserRuntime[] = [];
  const browsers = join(homedir(), '.cache', 'ms-playwright');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'coxia-sites-real-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'k.pem'), '-out', join(root, 'c.pem'), '-days', '1', '-subj', '/CN=a.example.com'], { stdio: 'ignore' });
    site = createServer({ key: readFileSync(join(root, 'k.pem')), cert: readFileSync(join(root, 'c.pem')) }, (req, res) => {
      // The page itself, not the icon the browser asks for after it (which already carries the cookie the page just set).
      if (req.url === '/') cookiesSeen[String(req.headers.host)] = String(req.headers.cookie ?? '');
      if (req.url?.startsWith('/seen?k=')) storageSeen[String(req.headers.host)] = decodeURIComponent(req.url.slice('/seen?k='.length));
      res.setHeader('content-type', 'text/html');
      res.setHeader('set-cookie', 'sid=session-1; Max-Age=3600; Secure; Path=/');
      // The page says what its local storage held when it was opened, then keeps something in it.
      res.end('<html><body>hello<script>fetch("/seen?k=" + encodeURIComponent(String(localStorage.getItem("k")))); localStorage.setItem("k", "v")</script></body></html>');
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    port = (site.address() as AddressInfo).port;
  }, 30_000);
  afterEach(async () => {
    for (const r of live.splice(0)) await r.close();
  });
  afterAll(async () => {
    await new Promise((r) => site?.close(r));
    rmSync(root, { recursive: true, force: true });
  });

  /** A session of the agent that visits both hosts through a proxy that sends every name to the fake site. */
  async function visit(profile: string, hosts: string[]): Promise<void> {
    const runtime = await startBrowser(
      { dir: join(root, 'sandbox'), config: neutralSandbox(), network: { mode: 'proxy', hosts: [A, B] }, profile, display: null, browsers, chromium: (chromium as { executable: string }).executable, seesImages: false },
      { proxy: { resolve: async () => ['8.8.8.8'], open: () => connect({ host: '127.0.0.1', port }) }, serverExtra: ['--ignore-https-errors'] },
    );
    live.push(runtime);
    for (const host of hosts) {
      const r = await runtime.client.callTool('browser_navigate', { url: `https://${host}/` }, { timeoutMs: 45_000 });
      expect(r.isError, host).not.toBe(true);
    }
    await runtime.close();
    live.splice(0);
  }
  const launch = (profileDir: string): Promise<BrowserRuntime> =>
    startBrowser({ dir: join(root, 'sandbox'), config: neutralSandbox(), network: { mode: 'off', hosts: [] }, profile: profileDir, display: null, headless: true, browsers, chromium: (chromium as { executable: string }).executable, seesImages: false });

  it('lists the sites that hold a session with no network, revokes one and leaves the other, and revokes all', async () => {
    const dir = ensureProfile(root, 'real-agent');
    await visit(dir, [A, B]);
    const locks = createProfileLocks();
    const deps = { workspaceDir: root, launch, locks };

    const before = await listSites('real-agent', deps);
    expect(before.ok, JSON.stringify(before)).toBe(true);
    const names = before.ok ? before.sites.map((s) => s.site) : [];
    expect(names).toEqual([A, B]);
    if (before.ok) for (const s of before.sites) expect(s.cookies).toBeGreaterThan(0);
    if (before.ok) for (const s of before.sites) expect(s.storage).toBeGreaterThan(0);
    // The listing is a session of its own: it left no process, no lock and no mark that a browser holds the profile.
    expect(locks.holder(dir)).toBeNull();

    const revoked = await revokeSite('real-agent', A, deps);
    expect(revoked, JSON.stringify(revoked)).toMatchObject({ ok: true, removed: true });
    expect(revoked.ok && revoked.sites.map((s) => s.site)).toEqual([B]);

    // The next visit: A is logged out, B is still logged in.
    for (const h of Object.keys(cookiesSeen)) delete cookiesSeen[h];
    for (const h of Object.keys(storageSeen)) delete storageSeen[h];
    await visit(dir, [A, B]);
    const seenA = Object.entries(cookiesSeen).find(([h]) => h.startsWith(A))?.[1];
    expect(seenA ?? '').toBe('');
    const seenB = Object.entries(cookiesSeen).find(([h]) => h.startsWith(B))?.[1];
    expect(seenB).toContain('sid=session-1');
    // And what A kept in its local storage is gone with the cookie, while B's is still there.
    expect(storageSeen[A]).toBe('null');
    expect(storageSeen[B]).toBe('v');

    expect(revokeAll('real-agent', { workspaceDir: root, locks })).toEqual({ ok: true, removed: true, sites: [] });
    expect(existsSync(dir)).toBe(false);
    mkdirSync(dir, { recursive: true });
  }, 180_000);
});
