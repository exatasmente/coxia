// The runtime of the app's browser: the argument lists of its sandboxes (pure), the proxy's summary, the start and its failures with a fake server, and, only where `bwrap`,
// `Xvfb`, a full Chromium and `openssl` exist, a real browser behind a real proxy and a fake site on this machine's loopback. No test reaches a real host.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { type AddressInfo, type Socket, connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { EXPOSED_TOOLS, PROBE_TOOLS } from '../src/main/browser/allowlist';
import { countsText } from '../src/main/browser/audit';
import { findChromium } from '../src/main/browser/chromium';
import { createHostsTally } from '../src/main/browser/hosts';
import { createIntermediary } from '../src/main/browser/intermediary';
import { createMaskSet } from '../src/main/browser/mask';
import { createStepLog } from '../src/main/browser/stepLog';
import { BrowserStartError, type BrowserRuntime, startBrowser } from '../src/main/browser/launch';
import { BROWSER_PROXY_URL, browserBwrapArgs, browserEnv, browserNetwork, displayBwrapArgs, displayNameOf, serverArgs, serverConfig, serverEnv, shellQuote, wrapperScript } from '../src/main/browser/policy';
import { displayProgram } from '../src/main/sandbox';
import { probeSandbox } from '../src/main/sandbox/probe';
import type { ProxyDecision } from '../src/main/sandbox/proxy';

const SYSTEM = { roDirs: ['/usr', '/etc'], links: [['/bin', 'usr/bin']] as [string, string][] };
const spec = (over: Partial<Parameters<typeof browserBwrapArgs>[0]> = {}) => ({
  system: SYSTEM,
  sessionDir: '/data/sandbox/abc123',
  profile: '/data/workspaces/w1/browser/agent-a',
  browsers: '/home/p/.cache/ms-playwright',
  chromium: '/home/p/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  executable: '/opt/app/app',
  extraReadOnly: ['/opt/app'],
  display: { socket: '/data/sandbox/xyz/x11/X101', name: 'X101' },
  network: 'proxy' as const,
  resolver: [] as [string, string][],
  fileMb: 512,
  tmpMb: 512,
  ...over,
});
const pairs = (args: string[], flag: string): string[][] => args.flatMap((a, i) => (a === flag ? [[args[i + 1], args[i + 2]]] : []));

describe('the browser\'s sandbox', () => {
  it('has its own network (the loopback and nothing else) unless the agent works on the computer', () => {
    for (const mode of ['off', 'proxy'] as const) expect(browserBwrapArgs(spec({ network: mode }))).toContain('--unshare-net');
    expect(browserBwrapArgs(spec({ network: 'open' }))).not.toContain('--unshare-net');
  });

  it('is a fresh set of namespaces with no nested user namespace, an empty environment and nothing of the home folder', () => {
    process.env.COXIA_TEST_SECRET = 'must-not-pass';
    try {
      const a = browserBwrapArgs(spec());
      for (const flag of ['--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-uts', '--disable-userns', '--die-with-parent', '--clearenv']) expect(a, flag).toContain(flag);
      expect(a.join(' ')).not.toContain('must-not-pass');
      expect(a.join(' ')).not.toContain(homedir());
      // Only these paths of this computer are visible, and the profile is the one writable folder besides /tmp, /dev and the forwarder's mark.
      const writable = pairs(a, '--bind').map(([src, dest]) => `${src}>${dest}`);
      expect(writable).toEqual(['/data/sandbox/xyz/x11/X101>/tmp/.X11-unix/X101', '/data/workspaces/w1/browser/agent-a>/data/workspaces/w1/browser/agent-a', '/data/sandbox/abc123/ready>/coxia/out']);
      const readOnly = pairs(a, '--ro-bind').map(([src, dest]) => `${src}>${dest}`);
      expect(readOnly).toEqual(expect.arrayContaining(['/usr>/usr', '/etc>/etc', '/home/p/.cache/ms-playwright>/home/p/.cache/ms-playwright', '/opt/app>/opt/app', '/data/sandbox/abc123/ctl>/coxia/ctl']));
      // Another agent's profile, the workspace folder and the app's data are not there.
      expect(a.join(' ')).not.toMatch(/agent-b|workspaces\/w1\/(?!browser\/agent-a)|\.config/);
    } finally {
      delete process.env.COXIA_TEST_SECRET;
    }
  });

  it('binds the resolver only on a shared network, and the forwarder only when there is a proxy', () => {
    const resolver: [string, string][] = [['/run/stub/resolv.conf', '/etc/resolv.conf']];
    expect(pairs(browserBwrapArgs(spec({ network: 'open', resolver })), '--ro-bind')).toContainEqual(['/run/stub/resolv.conf', '/etc/resolv.conf']);
    expect(browserEnv(spec({ network: 'proxy' })).COXIA_FORWARD).toBe('1');
    for (const mode of ['off', 'open'] as const) expect(browserEnv(spec({ network: mode })).COXIA_FORWARD).toBeUndefined();
  });

  it('sets the display from the socket\'s name, and refuses a name that is not an X server\'s', () => {
    expect(browserEnv(spec()).DISPLAY).toBe(':101');
    expect(displayNameOf('X99')).toBe(':99');
    for (const bad of ['X', 'Xa', 'x99', 'X99;x', '../X99', 'X123456']) expect(displayNameOf(bad), bad).toBeNull();
  });

  it('is started by a script that quotes every argument and passes the browser\'s own arguments through', () => {
    expect(shellQuote("a b'c")).toBe(`'a b'\\''c'`);
    const script = wrapperScript('/usr/bin/bwrap', ['--setenv', 'X', "it's"]);
    expect(script.startsWith('#!/bin/sh\nexec ')).toBe(true);
    expect(script).toContain(`'--setenv' 'X' 'it'\\''s' -- /bin/sh /coxia/ctl/launch.sh "$@"`);
  });

  it('gives a display of its own no network at all and a socket folder the app can reach', () => {
    const a = displayBwrapArgs({ system: SYSTEM, sessionDir: '/data/sandbox/abc123', tmpMb: 128 });
    expect(a).toContain('--unshare-net');
    expect(pairs(a, '--bind')).toEqual([['/data/sandbox/abc123/x11', '/tmp/.X11-unix']]);
    expect(a).toContain('--clearenv');
  });
});

describe('the Playwright MCP server\'s command line', () => {
  const base = { cli: '/app/node_modules/@playwright/mcp/cli.js', profile: '/p', outDir: '/o', wrapper: '/s/chrome.sh', config: '/s/server.json', images: true, proxy: true };

  it('reads nothing back from the page on its own, and asks for no capability, origin list, secrets, state or trace', () => {
    const args = serverArgs(base);
    const at = (flag: string): string => args[args.indexOf(flag) + 1];
    expect(at('--codegen')).toBe('none');
    expect(at('--snapshot-mode')).toBe('none');
    expect(at('--idle-timeout')).toBe('0');
    expect(at('--user-data-dir')).toBe('/p');
    expect(at('--executable-path')).toBe('/s/chrome.sh');
    expect(args).toContain('--no-webmcp');
    for (const flag of ['--cdp-endpoint', '--caps', '--allowed-origins', '--blocked-origins', '--secrets', '--storage-state', '--save-trace', '--save-session', '--save-video', '--extension', '--isolated', '--headless', '--init-script', '--init-page', '--allow-unrestricted-file-access', '--port', '--host']) expect(args, flag).not.toContain(flag);
  });

  it('hands the browser the proxy only in proxy mode, and sends images only where the engine takes them', () => {
    expect(serverArgs(base)).toContain(BROWSER_PROXY_URL);
    expect(serverArgs({ ...base, proxy: false })).not.toContain('--proxy-server');
    expect(serverArgs(base)[serverArgs(base).indexOf('--image-responses') + 1]).toBe('allow');
    expect(serverArgs({ ...base, images: false })[serverArgs({ ...base, images: false }).indexOf('--image-responses') + 1]).toBe('omit');
  });

  it('switches off what Chromium does on its own, and leaves no way for a page to open a UDP path', () => {
    const flags = serverConfig().browser.launchOptions.args.join(' ');
    expect(flags).toContain('AutofillServerCommunication');
    expect(flags).toContain('--disable-quic');
    expect(flags).toContain('--no-pings');
    expect(flags).toContain('--dns-prefetch-disable');
    expect(flags).toContain('disable_non_proxied_udp');
  });

  it('runs with an environment of its own: the session\'s folders, a display name and no proxy, token or home of the app\'s', () => {
    process.env.HTTPS_PROXY = 'http://proxy.invalid:1';
    try {
      const env = serverEnv({ home: '/s/home', tmp: '/s/tmp', display: ':101', browsers: '/b', sockets: '/tmp/cxpw-abc' });
      expect(env.HOME).toBe('/s/home');
      expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
      expect(JSON.stringify(env)).not.toContain('proxy.invalid');
      expect(Object.keys(env).sort()).toEqual(['DISPLAY', 'ELECTRON_RUN_AS_NODE', 'HOME', 'LANG', 'NO_COLOR', 'PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS', 'PWTEST_SOCKETS_DIR', 'TMPDIR']);
    } finally {
      delete process.env.HTTPS_PROXY;
    }
  });
});

describe('the network of the app\'s browser', () => {
  const ws = (network: 'off' | 'registry' | 'open') => ({ network, registryHosts: ['registry.example.com'] });
  it('is the computer\'s own for an agent that runs there, and the agent\'s sandbox table for the rest', () => {
    expect(browserNetwork(ws('off'), { shell: 'host' }, ['a.example.com'])).toEqual({ mode: 'open', hosts: [] });
    expect(browserNetwork(ws('off'), { shell: 'none' }, [])).toEqual({ mode: 'off', hosts: [] });
    expect(browserNetwork(ws('off'), { shell: 'none' }, ['a.example.com'])).toEqual({ mode: 'proxy', hosts: ['a.example.com'] });
    expect(browserNetwork(ws('registry'), { shell: 'sandbox' }, ['a.example.com'])).toEqual({ mode: 'proxy', hosts: ['registry.example.com', 'a.example.com'] });
    expect(browserNetwork(ws('open'), { shell: 'sandbox' }, ['a.example.com'])).toEqual({ mode: 'proxy', hosts: ['a.example.com'] });
    expect(browserNetwork(ws('open'), { shell: 'sandbox' }, [])).toEqual({ mode: 'open', hosts: [] });
  });
});

describe('what the proxy decided, as a summary', () => {
  const allowed = (host: string): ProxyDecision => ({ host, port: 443, allowed: true });
  const refused = (host: string, why: 'host' | 'method' | 'bad-request' = 'host'): ProxyDecision => ({ host, port: 443, allowed: false, why });

  it('counts 200 tunnels into a summary the audit line holds, and says nothing per tunnel', () => {
    const told: string[] = [];
    const tally = createHostsTally({ onFirstRefusal: (h) => told.push(h) });
    for (let i = 0; i < 200; i++) tally.decide(i % 4 === 0 ? refused('tracker.example.com') : allowed('site.example.com'));
    expect(tally.total).toBe(200);
    expect(tally.summary()).toEqual({ allowed: { 'site.example.com': 150 }, refused: { 'tracker.example.com': 50 } });
    // No call was in flight: the browser's own traffic is not blamed on a page.
    expect(told).toEqual([]);
  });

  it('keeps the number of names it counts bounded, and what the audit line holds bounded', () => {
    const tally = createHostsTally({ maxHosts: 10 });
    for (let i = 0; i < 200; i++) tally.decide(refused(`h${i}.example.com`));
    const names = Object.keys(tally.summary().refused);
    expect(names.length).toBeLessThanOrEqual(11);
    expect(names).toContain('(other hosts)');
    expect(Object.values(tally.summary().refused).reduce((a, b) => a + b, 0)).toBe(200);
    expect(countsText(tally.summary().refused).length).toBeLessThanOrEqual(300);
  });

  it('says one line the first time a host is refused during a call, and tells the call which hosts it ran into', () => {
    const told: string[] = [];
    const tally = createHostsTally({ onFirstRefusal: (h, why) => told.push(`${h}:${why}`) });
    tally.decide(refused('before.example.com'));
    const end = tally.beginCall();
    for (let i = 0; i < 30; i++) tally.decide(refused('cdn.example.com'));
    tally.decide(refused('before.example.com'));
    tally.decide(allowed('site.example.com'));
    tally.decide({ host: '', port: 0, allowed: false, why: 'method' });
    expect(end()).toEqual(['cdn.example.com', 'before.example.com', '(not a tunnel)']);
    expect(told).toEqual(['cdn.example.com:host', 'before.example.com:host', '(not a tunnel):method']);
    // After the call, nothing more is said; a second call hears only about new refusals of its own.
    tally.decide(refused('later.example.com'));
    const second = tally.beginCall();
    tally.decide(refused('cdn.example.com'));
    expect(second()).toEqual(['cdn.example.com']);
    expect(told).toHaveLength(3);
  });
});

describe('finding a Chromium', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-chromium-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const make = (path: string, executable = true): void => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), '#!/bin/sh\n', { mode: executable ? 0o755 : 0o644 });
  };

  it('takes the newest full build with a runnable executable, in either layout, and never a headless shell', () => {
    expect(findChromium(join(dir, 'gone'))).toEqual({ ok: false, why: 'unreadable' });
    expect(findChromium(dir)).toEqual({ ok: false, why: 'none' });
    make('chromium_headless_shell-2000/chrome-linux/headless_shell');
    make('chromium-1100/chrome-linux64/chrome', false);
    expect(findChromium(dir)).toEqual({ ok: false, why: 'none' });
    make('chromium-1000/chrome-linux/chrome');
    expect(findChromium(dir)).toEqual({ ok: true, executable: join(dir, 'chromium-1000/chrome-linux/chrome'), build: 1000 });
    make('chromium-1234/chrome-linux64/chrome');
    expect(findChromium(dir)).toEqual({ ok: true, executable: join(dir, 'chromium-1234/chrome-linux64/chrome'), build: 1234 });
  });
});

// ---- starting the browser, with a fake server in the server's place ----------------------------------------------------------------------

const fakeServer = (tools: string[], extra = ''): string => `
const { createInterface } = require('node:readline');
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  ${extra}
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake' } } });
  if (m.method === 'tools/call') return send({ jsonrpc: '2.0', id: m.id, result: { content: [] } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: ${JSON.stringify(tools.map((name) => ({ name, inputSchema: { type: 'object' } })))} } });
});
`;

describe('starting the browser', () => {
  let root: string;
  let running: BrowserRuntime | null = null;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'coxia-browser-start-'));
  });
  afterEach(async () => {
    await running?.close();
    running = null;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const options = (over: Record<string, unknown> = {}) => ({
    dir: join(root, 'sandbox'),
    config: neutralSandbox(),
    network: { mode: 'off' as const, hosts: [] as string[] },
    profile: null,
    display: { socket: join(root, 'X101'), name: 'X101' },
    browsers: root,
    chromium: join(root, 'chrome'),
    seesImages: true,
    ...over,
  });
  const script = (name: string, body: string): string => {
    const path = join(root, name);
    writeFileSync(path, body);
    return path;
  };
  const folders = (): string[] => (existsSync(join(root, 'sandbox')) ? readdirSync(join(root, 'sandbox')) : []);

  it('makes one folder for the session, hands the display it was given over, and removes everything at close', async () => {
    const cli = script('ok.cjs', fakeServer([...EXPOSED_TOOLS.map((t) => t.name), ...PROBE_TOOLS]));
    running = await startBrowser(options(), { cli, bwrap: '/usr/bin/bwrap' });
    expect(running.display).toEqual({ socket: join(root, 'X101'), name: 'X101', own: false });
    expect(running.profile.fresh).toBe(true);
    expect(running.profile.dir.startsWith(running.sessionDir)).toBe(true);
    expect(statSync(running.sessionDir).mode & 0o777).toBe(0o700);
    const wrapper = readFileSync(join(running.sessionDir, 'chrome.sh'), 'utf8');
    expect(wrapper).toContain("'--unshare-net'");
    expect(statSync(join(running.sessionDir, 'chrome.sh')).mode & 0o777).toBe(0o700);
    expect(statSync(join(running.sessionDir, 'server.json')).mode & 0o777).toBe(0o600);
    expect(folders()).toHaveLength(1);
    const dir = running.sessionDir;
    await running.close();
    await running.close();
    expect(existsSync(dir)).toBe(false);
    running = null;
  });

  it('works on the profile it is given and leaves it when it closes', async () => {
    const cli = script('ok2.cjs', fakeServer([...EXPOSED_TOOLS.map((t) => t.name), ...PROBE_TOOLS]));
    const profile = join(root, 'profile-a');
    mkdirSync(profile);
    writeFileSync(join(profile, 'Cookies'), 'x');
    running = await startBrowser(options({ profile }), { cli, bwrap: '/usr/bin/bwrap' });
    expect(running.profile).toEqual({ dir: profile, fresh: false });
    await running.close();
    running = null;
    expect(existsSync(join(profile, 'Cookies'))).toBe(true);
  });

  it('refuses a server that lacks a tool the app offers or reads the page with, and leaves nothing behind', async () => {
    const before = folders().length;
    const cli = script('short.cjs', fakeServer(['browser_navigate']));
    const e = await startBrowser(options(), { cli }).catch((x) => x);
    expect(e).toBeInstanceOf(BrowserStartError);
    expect((e as BrowserStartError).code).toBe('contract');
    expect((e as BrowserStartError).detail).toContain('browser_snapshot');
    expect(folders()).toHaveLength(before);
  });

  it('says why a server that ends at once did, and leaves nothing behind', async () => {
    const before = folders().length;
    const cli = script('dies.cjs', "process.stderr.write('cannot find the browser'); process.exit(2);");
    const e = await startBrowser(options(), { cli }).catch((x) => x);
    expect(e).toBeInstanceOf(BrowserStartError);
    expect((e as BrowserStartError).code).toBe('server');
    expect((e as BrowserStartError).detail).toContain('cannot find the browser');
    expect(folders()).toHaveLength(before);
  });

  it('gives up on a server that never answers', async () => {
    const cli = script('silent.cjs', 'setInterval(() => {}, 1000);');
    const started = Date.now();
    const e = await startBrowser(options(), { cli, startMs: 300 }).catch((x) => x);
    expect((e as BrowserStartError).code).toBe('server');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('ends the server\'s process with the session', async () => {
    const cli = script('pid.cjs', fakeServer([...EXPOSED_TOOLS.map((t) => t.name), ...PROBE_TOOLS], "if (m.method === 'initialize') require('node:fs').writeFileSync(process.env.TMPDIR + '/pid', String(process.pid));"));
    running = await startBrowser(options(), { cli, bwrap: '/usr/bin/bwrap' });
    const pid = Number(readFileSync(join(running.sessionDir, 'tmp', 'pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await running.close();
    running = null;
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the server is still running');
  });
});

// ---- a real browser, in a real sandbox, behind a real proxy --------------------------------------------------------------------------------

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

describe.skipIf(!real)('a real browser in its sandbox', () => {
  let root: string;
  let site: ReturnType<typeof createHttpsServer>;
  let siteHits = 0;
  let loopback: ReturnType<typeof createHttpServer>;
  let loopbackHits = 0;
  let runtime: BrowserRuntime;
  const refusedBy: ProxyDecision[] = [];
  const HOST = 'allowed.example.com';

  const call = (name: string, args: Record<string, unknown>) => runtime.client.callTool(name, args, { timeoutMs: 45_000 });
  const textOf = (r: Awaited<ReturnType<typeof call>>): string => r.content.map((c) => ('text' in c ? String(c.text) : '')).join('\n');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'coxia-browser-real-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'k.pem'), '-out', join(root, 'c.pem'), '-days', '1', '-subj', `/CN=${HOST}`], { stdio: 'ignore' });
    site = createHttpsServer({ key: readFileSync(join(root, 'k.pem')), cert: readFileSync(join(root, 'c.pem')) }, (_req, res) => {
      siteHits++;
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>Fake site</title></head><body><h1>Welcome to the allowed site</h1><button>Next</button></body></html>');
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    loopback = createHttpServer((_req, res) => {
      loopbackHits++;
      res.end('a service on the computer\'s loopback');
    });
    await new Promise<void>((r) => loopback.listen(0, '127.0.0.1', r));
    const sitePort = (site.address() as AddressInfo).port;
    runtime = await startBrowser(
      {
        dir: join(root, 'sandbox'),
        config: neutralSandbox(),
        network: { mode: 'proxy', hosts: [HOST] },
        profile: null,
        display: null,
        browsers: join(homedir(), '.cache', 'ms-playwright'),
        chromium: (chromium as { executable: string }).executable,
        seesImages: true,
      },
      {
        // The name resolves to a public-looking address and the connection goes to the fake site: nothing leaves this machine.
        proxy: { resolve: async () => ['8.8.8.8'], open: (_address: string, _port: number): Socket => connect({ host: '127.0.0.1', port: sitePort }) },
        serverExtra: ['--ignore-https-errors'],
      },
    );
    const tally = runtime.hosts;
    const decide = tally.decide.bind(tally);
    tally.decide = (d) => {
      refusedBy.push(d);
      decide(d);
    };
  }, 60_000);

  afterAll(async () => {
    await runtime?.close();
    await new Promise((r) => site?.close(r));
    await new Promise((r) => loopback?.close(r));
    rmSync(root, { recursive: true, force: true });
  });

  it('loads a page of the listed host through the proxy, on a display of its own', async () => {
    expect(runtime.display?.own).toBe(true);
    expect(statSync(runtime.display?.socket as string).isSocket()).toBe(true);
    const nav = await call('browser_navigate', { url: `https://${HOST}/` });
    expect(nav.isError, textOf(nav)).not.toBe(true);
    const snap = await call('browser_snapshot', {});
    expect(textOf(snap)).toContain('Welcome to the allowed site');
    expect(siteHits).toBeGreaterThan(0);
    expect(runtime.hosts.summary().allowed[HOST]).toBeGreaterThan(0);
  }, 60_000);

  it('is driven through the intermediary: the app reads the page itself, holds a submit, and fences what comes back', async () => {
    const asked: string[] = [];
    const log = createStepLog();
    const inter = createIntermediary({
      client: runtime.client,
      network: runtime.network,
      hosts: runtime.hosts,
      masks: createMaskSet(),
      log,
      gate: { hold: async (r) => (asked.push(`${r.why} ${r.step.name ?? ''}`), 'no'), passed: () => false },
      seesImages: true,
    });
    const nav = await inter.call('browser_navigate', { url: `https://${HOST}/` });
    expect(nav.isError, nav.text).toBe(false);
    const snap = await inter.call('browser_snapshot', {});
    expect(snap.text).toContain('<data>');
    expect(snap.text).toContain('Welcome to the allowed site');
    const ref = /button "Next" \[ref=(\w+)\]/.exec(snap.text)?.[1] as string;
    expect(ref).toBeTruthy();
    // A click on a control named like any other is let through; the app asked the page about it with its own question, which the real server answered.
    const click = await inter.call('browser_click', { target: ref });
    expect(click.isError, click.text).toBe(false);
    expect(asked).toEqual([]);
    // A selector is refused before the browser sees it, and a host outside the list never reaches it.
    expect((await inter.call('browser_click', { target: 'button' })).isError).toBe(true);
    expect((await inter.call('browser_navigate', { url: 'https://other.example.com/' })).isError).toBe(true);
    expect(log.entries().map((e) => `${e.tool} ${e.outcome} ${e.class}`)).toEqual(['browser_navigate ok free', 'browser_snapshot ok free', 'browser_click ok free', 'browser_click not-run unclassified', 'browser_navigate not-run unclassified']);
    expect(log.entries()[2]).toMatchObject({ role: 'button', name: 'Next', site: HOST });
  }, 90_000);

  it('cannot reach another host, plain http, a service on the computer\'s loopback, a local-network address or a file', async () => {
    // (Chromium upgrades `http://` to `https://` before it falls back, so a listed host over plain http is just the listed host over https: the plain request that is
    // left, to a host that is not listed, is what reaches the proxy as something other than CONNECT.)
    const before = { site: siteHits, loopback: loopbackHits };
    const attempts = [`https://other.example.com/`, 'http://plain.example.com/', `http://127.0.0.1:${(loopback.address() as AddressInfo).port}/`, `http://${[10, 0, 0, 1].join('.')}/`, 'file:///etc/hostname'];
    for (const url of attempts) {
      const r = await call('browser_navigate', { url });
      const text = textOf(r);
      expect(r.isError === true || /ERR_|Error|error|blocked|Access to file/i.test(text), `${url}: ${text.slice(0, 200)}`).toBe(true);
      expect(text).not.toContain('Welcome to the allowed site');
      expect(text).not.toContain('a service on the computer');
    }
    expect(loopbackHits).toBe(before.loopback);
    expect(siteHits).toBe(before.site);
    const summary = runtime.hosts.summary();
    expect(summary.refused['other.example.com']).toBeGreaterThan(0);
    // `http://` reaches the proxy as a request that is not CONNECT: refused, and counted under no host.
    expect(refusedBy.some((d) => !d.allowed && d.why === 'method')).toBe(true);
  }, 120_000);

  it('has nothing but its own loopback to go out by', async () => {
    // The sandbox shows only `lo`: the executable of the browser's sandbox is the one the server launched, so look at it with a probe of the same arguments.
    const wrapper = readFileSync(join(runtime.sessionDir, 'chrome.sh'), 'utf8');
    const probe = wrapper.replace(/ -- \/bin\/sh \/coxia\/ctl\/launch\.sh "\$@"\n$/, ' -- /bin/sh -c \'tail -n +3 /proc/net/dev | cut -d: -f1\'\n');
    const out = execFileSync('/bin/sh', ['-c', probe], { encoding: 'utf8' });
    expect(out.trim()).toBe('lo');
  }, 30_000);

  it('ends with the session: no process of the browser is left and the folder is gone', async () => {
    const dir = runtime.sessionDir;
    const marker = `--user-data-dir=${runtime.profile.dir}`;
    const alive = (): boolean => {
      try {
        return execFileSync('pgrep', ['-f', '--', marker], { stdio: 'pipe' }).toString().trim().length > 0;
      } catch {
        return false;
      }
    };
    expect(alive()).toBe(true);
    await runtime.close();
    for (let i = 0; i < 60 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive()).toBe(false);
    expect(existsSync(dir)).toBe(false);
  }, 30_000);
});
