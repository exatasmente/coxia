import type { SandboxLimits } from '../../shared/config/types';

// What a sandbox is, as data: the argument list of `bwrap`, the environment of what runs inside and the supervisor that runs it. Pure (no file system, no process): the
// machine's facts (which of /bin and /lib are links, which folders exist, the git directories) come in through the spec, so every line of it is testable.
//
// The root of the sandbox is built from an allow-list of binds. /home, /root, /run, /mnt, /media and /var are not there at all: the home folder does not exist inside,
// and with it go the keys, the tokens, the agent sockets and the container daemon's socket. Nothing of the app's environment passes: the environment is built here.

/** Where the stage folder shows up inside. */
export const CTL = '/coxia/ctl';
export const OUT = '/coxia/out';
export const SANDBOX_HOME = '/home/sandbox';
/** The loopback port the forwarder of the registry mode listens on, inside. */
export const PROXY_PORT = 3128;
export const PROXY_SOCKET = `${CTL}/proxy.sock`;

export interface SandboxSpec {
  /** The worktree's real path: also its path inside. */
  worktree: string;
  /** A copy of the tree to put at the worktree's path instead of the worktree itself (an agent that only reads); null: the worktree. */
  tree: string | null;
  /** The folder made for this stage: `ctl` (read-only inside), `out` and `home` (read-write). */
  stageDir: string;
  /** What the host has at the top: the folders to bind and the links to make (`/bin -> usr/bin`). */
  system: { roDirs: string[]; links: [string, string][] };
  /** More read-only binds: the git directories, the folders the workspace listed. [source, destination]. */
  roBinds: [string, string][];
  /** Entries to put in front of PATH inside (the `bin` of a folder the workspace listed). */
  pathDirs: string[];
  /** `off`: no network. `proxy`: the registry through the app's proxy. `open`: the computer's own network, shared whole, with the resolver configuration bound in. */
  network: 'off' | 'proxy' | 'open';
  limits: SandboxLimits;
  /** The size of /tmp, in MiB. */
  tmpMb: number;
  /** What the sandbox offers to test an interface: the browsers folder (already among the read-only binds) and the display program to start. */
  gui?: { browsers: string | null; xvfb: string | null };
  /** The test environment's variables, applied over every other environment decision (delivered by the launcher, never by the agent). */
  testEnv?: Record<string, string>;
}

/** The display a sandbox starts for a stage: the socket of `:99` lives in the sandbox's own /tmp. */
export const DISPLAY = ':99';
export const DISPLAY_SOCKET = '/tmp/.X11-unix/X99';

const BASE_PATH = ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'];

/** The environment of everything that runs inside: built from nothing, never copied from the app's. */
export function sandboxEnv(spec: SandboxSpec): Record<string, string> {
  const l = spec.limits;
  const env: Record<string, string> = {
    PATH: [...spec.pathDirs, ...BASE_PATH].join(':'),
    HOME: SANDBOX_HOME,
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    // Git inside reads the repository's own (cleaned) configuration and nothing of the person's, never asks a question and never writes an optional lock.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath',
    GIT_CONFIG_VALUE_1: '/dev/null',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_cache: `${SANDBOX_HOME}/.npm`,
    // What the supervisor reads to limit each command.
    COXIA_WT: spec.worktree,
    COXIA_DATA: String(l.memoryMb * 1024 * 1024),
    COXIA_PROCS: String(l.processes),
    COXIA_FSIZE: String(l.fileMb * 1024 * 1024),
  };
  // Playwright finds the browsers the person offered without the agent setting anything; the display program is started by the supervisor, which sets DISPLAY.
  if (spec.gui?.browsers) env.PLAYWRIGHT_BROWSERS_PATH = spec.gui.browsers;
  if (spec.gui?.xvfb) Object.assign(env, { COXIA_XVFB: spec.gui.xvfb, DISPLAY });
  if (spec.network === 'proxy') {
    const url = `http://127.0.0.1:${PROXY_PORT}`;
    Object.assign(env, { HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url, npm_config_proxy: url, npm_config_https_proxy: url, YARN_HTTPS_PROXY: url, YARN_HTTP_PROXY: url, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', COXIA_PROXY: '1' });
  }
  // Last, over every decision above: the environment is built from nothing, so a test name can never be shadowed by a base one, and the base ones cannot drop it.
  Object.assign(env, spec.testEnv ?? {});
  return env;
}

/** The command a sandbox runs unless told otherwise: the supervisor of the stage. */
export const SUPERVISOR_COMMAND = ['/bin/sh', `${CTL}/supervisor.sh`];

/**
 * The options of `bwrap` (everything but the command, which goes on its command line after `--`: it takes the command only from there). Every flag is one the installed 0.9 knows. In `off` and `proxy` the sandbox has its own loopback and nothing else (the registry mode reaches the world only through a socket in the stage folder);
 * in `open` the network is the computer's own, shared whole.
 */
export function bwrapArgs(spec: SandboxSpec): string[] {
  // Spelled out instead of --unshare-all: --disable-userns needs --unshare-user itself, and the network is unshared on purpose, not by default (except in open mode).
  const a: string[] = ['--unshare-user', '--unshare-ipc', '--unshare-pid', ...(spec.network === 'open' ? [] : ['--unshare-net']), '--unshare-uts', '--unshare-cgroup-try', '--disable-userns', '--die-with-parent', '--new-session', '--clearenv'];
  for (const dir of spec.system.roDirs) a.push('--ro-bind', dir, dir);
  for (const [name, target] of spec.system.links) a.push('--symlink', target, name);
  // /dev is a memory filesystem too, as large as half the memory unless it is made read-only: it is, and /dev/shm gets a size of its own like /tmp.
  const tmp = String(spec.tmpMb * 1024 * 1024);
  a.push('--proc', '/proc', '--dev', '/dev', '--size', tmp, '--tmpfs', '/dev/shm', '--remount-ro', '/dev', '--size', tmp, '--tmpfs', '/tmp');
  a.push('--bind', `${spec.stageDir}/home`, SANDBOX_HOME);
  a.push('--ro-bind', `${spec.stageDir}/ctl`, CTL, '--bind', `${spec.stageDir}/out`, OUT);
  for (const [src, dest] of spec.roBinds.filter(([, d]) => !d.startsWith(`${spec.worktree}/`) && d !== spec.worktree)) a.push('--ro-bind', src, dest);
  a.push('--bind', spec.tree ?? spec.worktree, spec.worktree);
  // Inside the worktree, over what was just bound: the git pointer and the files that make git or a package manager run code on their own.
  for (const [src, dest] of spec.roBinds.filter(([, d]) => d.startsWith(`${spec.worktree}/`))) a.push('--ro-bind', src, dest);
  for (const [k, v] of Object.entries(sandboxEnv(spec))) a.push('--setenv', k, v);
  a.push('--chdir', spec.worktree);
  return a;
}

/**
 * Runs inside the sandbox, from the stage folder. It reads one line per command from the app (`<id> <token> <seconds>`), runs the file `cmd.<id>` with the limits, and
 * answers `done <id> <token> <exit code>`. A process a command started in the background stays until the sandbox ends; `timeout` stops one that runs too long.
 */
export const SUPERVISOR_SH = `#!/bin/sh
if [ -n "$COXIA_PROXY" ]; then
  command -v node >/dev/null 2>&1 || { echo no-node; exit 3; }
  node ${CTL}/forward.js >/dev/null 2>&1 &
  # Ready means the forwarder listens: a command that runs at once must find the proxy.
  i=0
  while [ ! -e ${OUT}/forward.ready ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
  [ -e ${OUT}/forward.ready ] || { echo no-forwarder; exit 4; }
fi
if [ -n "$COXIA_XVFB" ]; then
  # The display runs for the stage under the same per-process limits as a command, with no TCP listener; its socket stays in the sandbox's own /tmp.
  prlimit --data="$COXIA_DATA" --nproc="$COXIA_PROCS" --fsize="$COXIA_FSIZE" --core=0 -- "$COXIA_XVFB" ${DISPLAY} -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  i=0
  while [ ! -S ${DISPLAY_SOCKET} ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done
  # A display that did not come up is no reason to stop the stage: the commands run without DISPLAY and the app says so.
  if [ -S ${DISPLAY_SOCKET} ]; then echo ready; else unset DISPLAY; echo ready-nodisplay; fi
else
  echo ready
fi
while IFS=' ' read -r id token secs; do
  [ "$id" = quit ] && exit 0
  (
    cd "$COXIA_WT" || exit 126
    # The output file is opened inside the timed command: a pipe put there by an earlier command would block the open for ever, and only a timeout can end that.
    exec prlimit --data="$COXIA_DATA" --nproc="$COXIA_PROCS" --fsize="$COXIA_FSIZE" --core=0 -- \\
      timeout -k 3 "$secs" /bin/sh -c 'exec /bin/sh "$1" >"$2" 2>&1 </dev/null' sh "${CTL}/cmd.$id" "${OUT}/out.$id"
  ) &
  wait $!
  printf 'done %s %s %s\\n' "$id" "$token" "$?"
done
`;

/** Runs inside, in registry mode: the sandbox's own loopback port, piped to the app's proxy through the socket in the stage folder. */
export const FORWARDER_JS = `const net = require('net');
net.createServer((c) => {
  const u = net.connect('${PROXY_SOCKET}');
  const end = () => { c.destroy(); u.destroy(); };
  c.on('error', end); u.on('error', end);
  c.pipe(u); u.pipe(c);
}).listen(${PROXY_PORT}, '127.0.0.1', () => require('fs').writeFileSync('${OUT}/forward.ready', '1'));
`;
