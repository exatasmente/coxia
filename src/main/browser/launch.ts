import { type ChildProcess, type SpawnOptions, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { RunnerSandbox } from '../../shared/config/types';
import type { EffectiveNetwork } from '../../shared/network';
import { PLAYWRIGHT_MCP_CLI } from '../paths';
import { removeTree } from '../sandbox/remove';
import { FORWARDER_JS } from '../sandbox/policy';
import { type ProxyOptions, type RegistryProxy, createRegistryProxy } from '../sandbox/proxy';
import { displayProgram } from '../sandbox';
import { etcEntries, nameResolverBinds, systemLayout } from '../sandbox/system';
import { dropControlSockets } from './controlSocket';
import { type DisplayDeps, type DisplaySandbox, startDisplaySandbox } from './display';
import { type HostsTally, createHostsTally } from './hosts';
import { EXPOSED_TOOLS, PROBE_TOOLS } from './allowlist';
import { type McpClient, spawnMcp } from './mcpClient';
import { BROWSER_PROXY_LIMITS, CHROMIUM_POLICY, CHROMIUM_POLICY_ETC_NAMES, CHROMIUM_POLICY_FILE, LAUNCH_SH, browserBwrapArgs, displayNameOf, serverArgs, serverConfig, serverEnv, wrapperScript } from './policy';

// Starts the app's browser for one screen session. Three things, none of them in the agent's reach: the Playwright MCP server, a child of the app that holds the control
// channel on its standard input and output (nothing else can write to it); the browser, which the server launches through a script of the app's that makes it a `bwrap`
// of its own (its network is the sandbox's own loopback and a forwarder to the app's filtering proxy, so there is no route around the proxy); and the display it draws on,
// either one the agent's shell session lends or one of the app's own. Everything it makes is in one folder that ends with the session.

export type StartFailure = 'folder' | 'proxy' | 'display' | 'server' | 'contract';

/** A browser that could not be started. The detail is for the log and the thread line, never the agent. */
export class BrowserStartError extends Error {
  constructor(
    readonly code: StartFailure,
    readonly detail: string = '',
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BrowserStartError';
  }
}

export interface BrowserStartOptions {
  /** Where the session folders are made (the sandbox's own folder, which the start-up purge walks). */
  dir: string;
  config: Pick<RunnerSandbox, 'limits'>;
  /** The network the browser has (see `browserNetwork`). */
  network: EffectiveNetwork;
  /** The profile folder the browser works on (already made and checked, `profile.ts`); null: a throwaway one inside the session. */
  profile: string | null;
  /** The display to draw on: the socket of the agent's shell session; null: the app starts one of its own (unless `headless`). */
  display: { socket: string; name: string } | null;
  /** No window and no display: for reading or clearing what a profile holds, with no agent in it. */
  headless?: boolean;
  /** The browsers folder, as the sandbox's guards made it real, and the Chromium in it. */
  browsers: string;
  chromium: string;
  /** Whether the agent's engine takes images (the server sends none otherwise). */
  seesImages: boolean;
  /** Told once per host the first time the proxy refuses it while a call is in flight. */
  onFirstRefusal?: (host: string, why: string) => void;
}

export interface BrowserDeps {
  spawn?: (file: string, args: string[], options: SpawnOptions) => ChildProcess;
  bwrap?: string;
  /** The app's own executable (runs the server and the forwarder in Node mode). */
  executable?: string;
  /** The Playwright MCP's `cli.js`. */
  cli?: string;
  proxy?: Pick<ProxyOptions, 'resolve' | 'open'>;
  display?: DisplayDeps;
  /** More arguments for the server, for a test (a fake site's certificate). */
  serverExtra?: string[];
  /** How long the server may take to start (ms). */
  startMs?: number;
}

export interface BrowserRuntime {
  /** The control channel of the server. Only the app holds it. */
  client: McpClient;
  /** The display the browser draws on: the socket, its name, and whether the app started it (and ends it). null: a headless browser. */
  display: { socket: string; name: string; own: boolean } | null;
  network: EffectiveNetwork;
  hosts: HostsTally;
  profile: { dir: string; fresh: boolean };
  sessionDir: string;
  /** Ends the server, the browser, the proxy and the display of its own, and removes the session folder (a throwaway profile with it). Idempotent. */
  close(): Promise<void>;
}

const FILE_MB = 512;
const TMP_MB = 512;

function folder(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

export async function startBrowser(o: BrowserStartOptions, deps: BrowserDeps = {}): Promise<BrowserRuntime> {
  let sessionDir: string;
  try {
    folder(o.dir);
    sessionDir = folder(join(realpathSync(o.dir), randomUUID().slice(0, 12)));
    for (const d of ['ctl', 'ready', 'home', 'tmp', 'out']) folder(join(sessionDir, d));
  } catch (e) {
    throw new BrowserStartError('folder', e instanceof Error ? e.message : String(e));
  }
  const cleanup: (() => Promise<void> | void)[] = [];
  const undo = async (): Promise<void> => {
    for (const c of cleanup.splice(0).reverse()) await Promise.resolve(c()).catch(() => undefined);
    removeTree(sessionDir);
  };

  try {
    const executable = deps.executable ?? process.execPath;
    const bwrap = deps.bwrap ?? 'bwrap';
    const hosts = createHostsTally({ onFirstRefusal: o.onFirstRefusal });

    // The profile: the agent's own, or a throwaway one that goes with the session.
    const profile = o.profile ?? folder(join(sessionDir, 'profile'));

    // The proxy, for a network that is only some hosts. The browser reaches it through a forwarder inside its sandbox and a socket in the session folder.
    if (o.network.mode === 'proxy') {
      writeFileSync(join(sessionDir, 'ctl', 'forward.js'), FORWARDER_JS, { mode: 0o600 });
      let proxy: RegistryProxy;
      try {
        proxy = await createRegistryProxy({ socketPath: join(sessionDir, 'ctl', 'proxy.sock'), hosts: o.network.hosts, onDecision: (d) => hosts.decide(d), ...BROWSER_PROXY_LIMITS, ...deps.proxy });
      } catch (e) {
        throw new BrowserStartError('proxy', e instanceof Error ? e.message : String(e));
      }
      cleanup.push(() => proxy.close());
    }

    // The display: lent by the agent's shell session, or one of the app's own.
    let display: BrowserRuntime['display'] = null;
    if (o.headless) {
      display = null;
    } else if (o.display) {
      display = { ...o.display, own: false };
    } else {
      const xvfb = displayProgram([]);
      if (!xvfb) throw new BrowserStartError('display', 'no display program');
      const own: DisplaySandbox | null = await startDisplaySandbox({ sessionDir, xvfb, tmpMb: 128 }, { bwrap, ...deps.display });
      if (!own) throw new BrowserStartError('display', 'the display did not come up');
      cleanup.push(() => own.stop());
      display = { socket: own.socket, name: own.name, own: true };
    }
    const displayName = display ? displayNameOf(display.name) : null;
    if (display && !displayName) throw new BrowserStartError('display', 'a display with a name that is not one');

    // What the browser's sandbox binds besides the system: the app's executable (it runs the forwarder), unless it is already under a system folder.
    const system = systemLayout();
    const exeDir = dirname(executable);
    const underSystem = system.roDirs.some((d) => exeDir === d || exeDir.startsWith(`${d}/`));
    const spec = {
      system,
      sessionDir,
      profile,
      browsers: o.browsers,
      chromium: o.chromium,
      executable,
      extraReadOnly: o.network.mode === 'proxy' && !underSystem ? [exeDir] : [],
      display: display ? { socket: display.socket, name: display.name } : null,
      network: o.network.mode,
      resolver: o.network.mode === 'open' ? nameResolverBinds() : [],
      // `/etc` is rebuilt to hold the managed policy; the folders Chromium reads policies from are left out of it, since the policy is the app's.
      etc: etcEntries(CHROMIUM_POLICY_ETC_NAMES),
      fileMb: FILE_MB,
      tmpMb: TMP_MB,
    };
    writeFileSync(join(sessionDir, 'ctl', 'launch.sh'), LAUNCH_SH, { mode: 0o600 });
    writeFileSync(join(sessionDir, 'ctl', CHROMIUM_POLICY_FILE), JSON.stringify(CHROMIUM_POLICY), { mode: 0o600 });
    const wrapper = join(sessionDir, 'chrome.sh');
    writeFileSync(wrapper, wrapperScript(bwrap, browserBwrapArgs(spec)), { mode: 0o700 });
    chmodSync(wrapper, 0o700);
    const config = join(sessionDir, 'server.json');
    writeFileSync(config, JSON.stringify(serverConfig()), { mode: 0o600 });

    // A short folder of its own for the server's socket, taken away with the session.
    const sockets = folder(join(tmpdir(), `cxpw-${basename(sessionDir)}`));
    cleanup.push(() => void removeTree(sockets));
    // The server's own control socket is of no use to the app and a way around it for anyone who could reach it: its name is taken away as it appears (`controlSocket.ts`).
    cleanup.push(dropControlSockets(folder(join(sockets, 'browser'))));
    const args = [...serverArgs({ cli: deps.cli ?? PLAYWRIGHT_MCP_CLI, profile, outDir: join(sessionDir, 'out'), wrapper, config, images: o.seesImages, proxy: o.network.mode === 'proxy', headless: o.headless }), ...(deps.serverExtra ?? [])];
    const { child, client } = spawnMcp(
      { command: executable, args, env: serverEnv({ home: join(sessionDir, 'home'), tmp: join(sessionDir, 'tmp'), display: displayName, browsers: o.browsers, sockets }), cwd: join(sessionDir, 'home'), detached: true },
      deps.spawn,
    );
    // The server's group leads the browser's sandbox too: one signal ends the lot.
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // Gone already.
      }
    };
    let exited = child.exitCode !== null || child.signalCode !== null;
    child.once('exit', () => {
      exited = true;
    });
    cleanup.push(async () => {
      await client.close();
      const until = Date.now() + 2000;
      while (!exited && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
      killGroup('SIGKILL');
    });

    // The server must answer, and have every tool the app offers and reads the page with; one that does not is a version the app was not made for.
    try {
      const hello = await Promise.race([
        client.initialize().then(() => client.listTools()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new BrowserStartError('server', 'the server did not answer in time')), deps.startMs ?? 30_000).unref()),
      ]);
      const names = new Set(hello.map((t) => t.name));
      const missing = [...EXPOSED_TOOLS.map((t) => t.name), ...PROBE_TOOLS].filter((n) => !names.has(n));
      if (missing.length) throw new BrowserStartError('contract', `the server has no ${missing.join(', ')}`);
    } catch (e) {
      if (e instanceof BrowserStartError) throw e;
      throw new BrowserStartError('server', `${e instanceof Error ? e.message : String(e)} ${client.stderrTail()}`.trim().slice(0, 500));
    }

    let closing: Promise<void> | null = null;
    return {
      client,
      display,
      network: o.network,
      hosts,
      profile: { dir: profile, fresh: o.profile === null },
      sessionDir,
      close: () =>
        (closing ??= (async () => {
          // The browser is asked to close itself first, so what a profile keeps (cookies, storage) is written out before the processes are ended.
          await client.callTool('browser_close', {}, { timeoutMs: 4000 }).catch(() => undefined);
          await undo();
        })()),
    };
  } catch (e) {
    await undo();
    throw e;
  }
}
