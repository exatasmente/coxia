import type { AgentDef, RunnerSandbox } from '../../shared/config/types';
import { type EffectiveNetwork, effectiveNetwork } from '../../shared/network';
import { CTL, DISPLAY, DISPLAY_SOCKET_NAME, OUT, PROXY_PORT, SANDBOX_HOME, X11_DIR } from '../sandbox/policy';

// What the app's browser is, as data: the argument lists of the two `bwrap` processes it needs (the browser's, and the display's when the agent has no shell session to lend
// one), the script that runs inside the first, and the command line of the Playwright MCP server. Pure (no file system, no process), so every line of it is testable. The
// browser's sandbox is the agent's shell sandbox minus the worktree plus what a page needs: its own profile and the display socket. In `off` and `proxy` its network is its
// own loopback and nothing else, so there is no route around the proxy (DNS, UDP and QUIC have no interface to leave by); in `open` it is the computer's own.

/** The browser's own port for the forwarder inside, and the address the server hands Chromium (`--proxy-server`). */
export const BROWSER_PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

/** A proxy made for a page, not for installing packages: dozens of tunnels at once, and connections that sit idle (a socket the page keeps open). */
export const BROWSER_PROXY_LIMITS = { maxConnections: 48, maxClients: 96, idleMs: 120_000 } as const;

/** What Chromium does on its own that the proxy would otherwise see and blame on the page; the rest of its traffic stays and shows up in the refusals. */
export const CHROMIUM_FLAGS = [
  '--disable-features=AutofillServerCommunication,OptimizationHints,Translate,MediaRouter',
  '--disable-quic',
  '--no-pings',
  '--dns-prefetch-disable',
  // WebRTC may only use the proxy: a page cannot open a UDP path of its own.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
] as const;

/**
 * What Chromium may not open, whoever asks it to: the files of its sandbox (the profile is among them), its own pages (they show cookies and saved data) and its tools. The agent's
 * shell session shares the display, and an X client can drive the browser with the keyboard; the browser's own policy is what stops it from going there. `about:blank` and the
 * error pages Playwright relies on are not in the list.
 */
export const CHROMIUM_POLICY = { URLBlocklist: ['file://*', 'chrome://*', 'chrome-untrusted://*', 'chrome-search://*', 'devtools://*', 'view-source:*'] } as const;
/**
 * The policy's file name in the session's `ctl` folder, and where Chromium reads managed policies from inside the browser's sandbox: the builds Playwright downloads read
 * different folders (Chromium's own, Chrome for Testing's, Chrome's), and the policy is put in each.
 */
export const CHROMIUM_POLICY_FILE = 'chromium-policy.json';
export const CHROMIUM_POLICY_DESTS = ['/etc/chromium/policies/managed/coxia.json', '/etc/opt/chrome_for_testing/policies/managed/coxia.json', '/etc/opt/chrome/policies/managed/coxia.json'] as const;
/** The top-level names of `/etc` the policy folders live under: not linked to the real `/etc`, since a path cannot be made through a link into a read-only folder. */
export const CHROMIUM_POLICY_ETC_NAMES = ['chromium', 'opt'] as const;
/** Where the real `/etc` is bound when `/etc` is rebuilt to hold the policy. */
const HOST_ETC = '/.coxia-etc';

export interface SystemFolders {
  roDirs: string[];
  links: [string, string][];
}

/** The network of the app's browser for an agent: the computer's own for one that runs there, the agent's sandbox table (rule 25) for the rest. */
export function browserNetwork(config: Pick<RunnerSandbox, 'network' | 'registryHosts'>, agent: Pick<AgentDef, 'shell'>, allowedHosts: string[]): EffectiveNetwork {
  if (agent.shell === 'host') return { mode: 'open', hosts: [] };
  return effectiveNetwork(config, { allowedHosts });
}

/** `X99` -> `:99`: the display a socket named like an X server's belongs to. null for any other name. */
export function displayNameOf(socketName: string): string | null {
  const m = /^X(\d{1,5})$/.exec(socketName);
  return m ? `:${m[1]}` : null;
}

export interface BrowserSandboxSpec {
  system: SystemFolders;
  /** The session's folder: `ctl` (read-only inside) and `ready` (read-write, the forwarder's mark) are in it. */
  sessionDir: string;
  /** The profile folder, bound read-write at its own path. */
  profile: string;
  /** The browsers folder, read-only at its own path. */
  browsers: string;
  /** The Chromium executable inside it. */
  chromium: string;
  /** The app's own executable, which runs the forwarder in Node mode. */
  executable: string;
  /** Folders to bind read-only besides the above (the executable's folder when it is not under a system folder). */
  extraReadOnly: string[];
  /** The display socket on this computer, and its name (`X99`): it shows up at `/tmp/.X11-unix/<name>`. null: a browser with no window (it reads a profile and draws nothing). */
  display: { socket: string; name: string } | null;
  network: EffectiveNetwork['mode'];
  /** Binds a shared network needs to resolve names. */
  resolver: [string, string][];
  /**
   * The names `/etc` holds, when the browser's managed policy is to be put there: `/etc` is then a folder of links to the real one (bound beside it) with the policy file in it.
   * Absent: `/etc` is the read-only bind it always was and no policy applies.
   */
  etc?: { name: string; link: string | null }[];
  /** The biggest file the browser may write, in MiB. */
  fileMb: number;
  /** The size of /tmp and /dev/shm in MiB. */
  tmpMb: number;
}

const BASE_PATH = '/usr/local/bin:/usr/bin:/bin';

/** The environment of everything inside the browser's sandbox: built from nothing, never copied from the app's. */
export function browserEnv(spec: BrowserSandboxSpec): Record<string, string> {
  const display = spec.display ? displayNameOf(spec.display.name) : null;
  return {
    PATH: BASE_PATH,
    HOME: '/tmp',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    ...(display ? { DISPLAY: display } : {}),
    COXIA_CHROME: spec.chromium,
    COXIA_NODE: spec.executable,
    COXIA_FSIZE: String(spec.fileMb * 1024 * 1024),
    ...(spec.network === 'proxy' ? { COXIA_FORWARD: '1' } : {}),
  };
}

/**
 * The options of the browser's `bwrap` (the command goes after `--`). The user, IPC, process and host-name namespaces are always new and a new user namespace cannot be made
 * inside; the network is new unless the agent works on the computer's own. Nothing of the home folder is there: only the profile, the browsers folder, the display socket and
 * the system's read-only folders.
 */
export function browserBwrapArgs(spec: BrowserSandboxSpec): string[] {
  const a: string[] = ['--unshare-user', '--unshare-ipc', '--unshare-pid', ...(spec.network === 'open' ? [] : ['--unshare-net']), '--unshare-uts', '--unshare-cgroup-try', '--disable-userns', '--die-with-parent', '--clearenv'];
  const rebuilt = spec.etc && spec.etc.length > 0;
  for (const dir of spec.system.roDirs) a.push('--ro-bind', dir, rebuilt && dir === '/etc' ? HOST_ETC : dir);
  for (const [name, target] of spec.system.links) a.push('--symlink', target, name);
  const tmp = String(spec.tmpMb * 1024 * 1024);
  a.push('--proc', '/proc', '--dev', '/dev', '--size', tmp, '--tmpfs', '/dev/shm', '--remount-ro', '/dev', '--size', tmp, '--tmpfs', '/tmp');
  if (rebuilt && spec.etc) {
    // A name the sandbox binds a file over itself (the resolver) is not linked: the bind would follow the link into the read-only folder.
    const own = new Set(spec.resolver.map(([, dest]) => dest));
    a.push('--size', String(1024 * 1024), '--tmpfs', '/etc');
    for (const e of spec.etc) if (!own.has(`/etc/${e.name}`)) a.push('--symlink', e.link ?? `${HOST_ETC}/${e.name}`, `/etc/${e.name}`);
    for (const dest of CHROMIUM_POLICY_DESTS) a.push('--ro-bind', `${spec.sessionDir}/ctl/${CHROMIUM_POLICY_FILE}`, dest);
  }
  // The display's socket alone, at its own name: the agent's shell session keeps the rest of its display folder.
  if (spec.display) a.push('--bind', spec.display.socket, `/tmp/.X11-unix/${spec.display.name}`);
  a.push('--bind', spec.profile, spec.profile);
  a.push('--ro-bind', spec.browsers, spec.browsers);
  for (const folder of spec.extraReadOnly) a.push('--ro-bind', folder, folder);
  for (const [src, dest] of spec.resolver) a.push('--ro-bind', src, dest);
  a.push('--ro-bind', `${spec.sessionDir}/ctl`, CTL, '--bind', `${spec.sessionDir}/ready`, OUT);
  for (const [k, v] of Object.entries(browserEnv(spec))) a.push('--setenv', k, v);
  a.push('--chdir', '/tmp');
  return a;
}

/**
 * Runs inside the browser's sandbox, as the browser's executable: the forwarder first (the sandbox's own loopback port, piped to the app's proxy through the socket in
 * the session folder), then the browser with its arguments. The server hands the arguments over; this script adds none.
 */
export const LAUNCH_SH = `#!/bin/sh
if [ -n "$COXIA_FORWARD" ]; then
  # The browser's control pipes (descriptors 3 and 4) stay with the browser alone.
  ELECTRON_RUN_AS_NODE=1 "$COXIA_NODE" ${CTL}/forward.js >/dev/null 2>&1 3<&- 4<&- &
  i=0
  while [ ! -e ${OUT}/forward.ready ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
  [ -e ${OUT}/forward.ready ] || { echo "the forwarder did not start" >&2; exit 4; }
fi
exec prlimit --core=0 --fsize="$COXIA_FSIZE" -- "$COXIA_CHROME" "$@"
`;

/** One plain argument, quoted for `/bin/sh`. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** The executable the server is told to launch: a script that becomes the browser's sandbox, with whatever the server asked of the browser passed through. */
export function wrapperScript(bwrap: string, args: string[]): string {
  return `#!/bin/sh\nexec ${shellQuote(bwrap)} ${args.map(shellQuote).join(' ')} -- /bin/sh ${CTL}/launch.sh "$@"\n`;
}

export interface DisplaySandboxSpec {
  system: SystemFolders;
  /** The folder of the session that holds `x11` (bound over `/tmp/.X11-unix`, so the socket shows up outside). */
  sessionDir: string;
  tmpMb: number;
}

/** A display of the app's own for an agent with no shell session: nothing but the display program, with no network at all and no listener but its socket. */
export function displayBwrapArgs(spec: DisplaySandboxSpec): string[] {
  const a: string[] = ['--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--unshare-cgroup-try', '--disable-userns', '--die-with-parent', '--clearenv'];
  for (const dir of spec.system.roDirs) a.push('--ro-bind', dir, dir);
  for (const [name, target] of spec.system.links) a.push('--symlink', target, name);
  const tmp = String(spec.tmpMb * 1024 * 1024);
  a.push('--proc', '/proc', '--dev', '/dev', '--size', tmp, '--tmpfs', '/dev/shm', '--remount-ro', '/dev', '--size', tmp, '--tmpfs', '/tmp');
  a.push('--bind', `${spec.sessionDir}/${X11_DIR}`, '/tmp/.X11-unix');
  a.push('--setenv', 'PATH', BASE_PATH, '--setenv', 'HOME', SANDBOX_HOME, '--setenv', 'TMPDIR', '/tmp');
  a.push('--chdir', '/tmp');
  return a;
}

/** The display program's command line inside the display sandbox. */
export const displayCommand = (xvfb: string): string[] => [xvfb, DISPLAY, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'];

/** Where the display of the display sandbox puts its socket, under the session folder. */
export const ownDisplaySocket = (sessionDir: string): string => `${sessionDir}/${X11_DIR}/${DISPLAY_SOCKET_NAME}`;

export interface ServerSpec {
  /** The cli of the Playwright MCP package. */
  cli: string;
  profile: string;
  outDir: string;
  /** The script that becomes the browser. */
  wrapper: string;
  /** The server's configuration file (`launchOptions.args`). */
  config: string;
  /** Whether the agent's engine takes images. */
  images: boolean;
  /** The proxy the browser is handed; only in `proxy` mode. */
  proxy: boolean;
  /** A browser with no window: for reading a profile, never for an agent. */
  headless?: boolean;
}

/**
 * The command line of the Playwright MCP server. Everything the app reads of the page it reads itself (the snapshot after an action, the target of a step), so the server
 * writes no snapshot file and echoes no code; it is never told to close on its own (the app owns the browser's life) and gets no origin list, no secrets file, no storage
 * state and no trace: the proxy is the boundary and a second, weaker one would only be a promise.
 */
export function serverArgs(s: ServerSpec): string[] {
  return [
    s.cli,
    '--codegen', 'none',
    '--snapshot-mode', 'none',
    '--no-webmcp',
    '--idle-timeout', '0',
    '--output-max-size', String(20 * 1024 * 1024),
    '--user-data-dir', s.profile,
    '--output-dir', s.outDir,
    '--image-responses', s.images ? 'allow' : 'omit',
    '--executable-path', s.wrapper,
    // The sandbox the browser is in is the boundary: a second one inside it cannot be made (no nested user namespace).
    '--no-sandbox',
    '--config', s.config,
    ...(s.proxy ? ['--proxy-server', BROWSER_PROXY_URL] : []),
    ...(s.headless ? ['--headless'] : []),
  ];
}

/** The server's configuration file: the flags Chromium gets besides the ones the server adds itself. */
export const serverConfig = (): { browser: { launchOptions: { args: string[] } } } => ({ browser: { launchOptions: { args: [...CHROMIUM_FLAGS] } } });

/** The environment of the server (a child of the app, outside any sandbox): built from nothing, with the session's folders for everything it writes. */
export function serverEnv(o: { home: string; tmp: string; display: string | null; browsers: string; sockets: string }): Record<string, string> {
  return {
    PATH: BASE_PATH,
    ELECTRON_RUN_AS_NODE: '1',
    HOME: o.home,
    TMPDIR: o.tmp,
    LANG: 'C.UTF-8',
    // Playwright refuses to launch a headed browser with no display set; the browser itself gets its display from its own sandbox.
    ...(o.display ? { DISPLAY: o.display } : {}),
    PLAYWRIGHT_BROWSERS_PATH: o.browsers,
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: '1',
    // The server opens a unix socket of its own, and a socket's path is short (about 100 bytes): the session folder under the app's data is too long for it.
    PWTEST_SOCKETS_DIR: o.sockets,
    NO_COLOR: '1',
  };
}
