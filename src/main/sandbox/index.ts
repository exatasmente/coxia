import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentDef, RunnerSandbox } from '../../shared/config/types';
import { effectiveNetwork } from '../../shared/network';
import { readOnlyPathProblem } from '../../shared/sandboxPaths';
import type { SandboxGuiStatus, SandboxStatus } from '../../shared/sandbox';
import { t } from '../../shared/i18n';
import { copyTree } from './copy';
import { dependencyBinds } from './dependencies';
import { removeTree } from './remove';
import { SandboxError } from './errors';
import { gitMounts } from './gitView';
import { bwrapArgs } from './policy';
import { invalidateSandboxStatus, sandboxStatus } from './probe';
import { type ProxyDecision, type ProxyOptions, createRegistryProxy } from './proxy';
import { type ExecResult, type SandboxSession, type SessionDeps, openSession } from './session';
import { type HostSessionDeps, type HostSessionOptions, openHostSession } from './host';
import { type HostDisplay, startHostDisplay } from './display';
import { loginEnv } from '../loginPath';
import { nameResolverBinds, systemLayout } from './system';
import { findChromium } from '../browser/chromium';

export type { ExecResult, SandboxSession } from './session';
export { SandboxError } from './errors';

// The sandbox of the app: what a stage asks for to give an agent commands. It checks the machine (probe), builds the stage folder, the copy an agent that only reads works
// in, the git binds and the proxy of the registry mode, and returns the session. Everything it makes is the app's own and is removed when the session closes.

export interface SandboxNote {
  code: 'runner.sandbox.repoFolder' | 'runner.sandbox.depsOutside';
  params: Record<string, string>;
}

export interface OpenOptions {
  /** The run's worktree. */
  worktree: string;
  /** An agent that only reads: it works in a copy, never in the worktree. */
  reader: boolean;
  /** What the workspace allows (`runner.sandbox`). */
  config: RunnerSandbox;
  /** Told about every command as it ends. */
  onExec?: (result: ExecResult, mode: 'run' | 'refused') => void;
  /** Told about every request the registry proxy decided on. */
  onProxy?: (decision: ProxyDecision) => void;
  /**
   * Told about what the person should know and that does not stop the stage: a listed folder that holds a repository (its `.git/config` is shown as it is, the cleaned
   * copy is only for the run's own repository), and a dependency link that leads outside the clone (left dangling).
   */
  onNote?: (note: SandboxNote) => void;
  /** Aborting it stops the copy of a reader's tree. */
  signal?: AbortSignal;
  /** The stage asks for a virtual display (a QA stage); it is started only when the workspace's `display` switch is on too. */
  display?: boolean;
  /**
   * The repository a tree that is not a git worktree was copied from (a mention's throwaway copy): its dependency links lead there, and are bound read-only like a
   * worktree's. Ignored when the tree is a worktree, whose clone git names.
   */
  clone?: string;
  /**
   * The agent the sandbox is for: its own list of hosts (`allowedHosts`) meets the workspace's network setting (see `effectiveNetwork`). Absent, or without a list: the
   * workspace's setting alone, as before. Not used by `openHost`: an agent on the computer has the computer's own network.
   */
  agent?: Pick<AgentDef, 'allowedHosts'>;
}

/** What a stage of an agent set to `shell: host` asks for: no sandbox, so no proxy and no extra folders; to test an interface it asks, like a sandbox, for the browsers folder and (a QA stage) a display. */
export type HostOpenOptions = Pick<OpenOptions, 'worktree' | 'reader' | 'config' | 'onExec' | 'signal' | 'display'> & Pick<HostSessionOptions, 'approve'>;

export interface SandboxService {
  /** The cached answer to "can this machine make a sandbox"; `force` asks again. */
  status(force?: boolean): Promise<SandboxStatus>;
  /** Makes the sandbox of one stage. Throws `SandboxError` when it cannot. */
  open(o: OpenOptions): Promise<SandboxSession>;
  /** Makes the session of an agent set to `shell: host`: its commands run on this computer, in the worktree (a copy of it for a reader). */
  openHost(o: HostOpenOptions): Promise<SandboxSession>;
  /** Removes what a sandbox of an earlier process left (the app was killed). */
  purge(): void;
  /** What a sandbox would have to test an interface with these settings: checked on this computer, never by starting anything. */
  guiStatus(config: RunnerSandbox): SandboxGuiStatus;
}

export interface SandboxServiceOptions {
  /** Where the stage folders are made. */
  dir: string;
  /** The person's home folder (what `~/` expands to, and what is never made visible whole). */
  home?: string;
  /** Folders a sandbox must never be given, whole or in part: the app's data. */
  protect?: string[];
  status?: (force: boolean) => Promise<SandboxStatus>;
  deps?: SessionDeps;
  hostDeps?: HostSessionDeps;
  /** Starts the display program of a host stage (default: the real one); for a test. */
  startDisplay?: (program: string) => Promise<HostDisplay | null>;
  /** The environment a host command starts from (default: the app's, with the login PATH). */
  hostEnv?: () => Promise<NodeJS.ProcessEnv>;
  /** How the proxy resolves a name and opens a connection (default: the real ones); for a test. */
  proxyDeps?: Pick<ProxyOptions, 'resolve' | 'open'>;
}

/** Why a machine cannot make a sandbox, in words (the detail is what the backend itself said). */
export const reasonText = (st: SandboxStatus): string => t(`main.sandbox.reason.${st.reason ?? 'platform'}`) + (st.detail ? ` (${st.detail})` : '');

const sameOrInside = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** Whether `folder` is a repository, or has a repository as a direct child: what a sandbox that is given it would see the `.git/config` of. */
export function holdsRepository(folder: string): boolean {
  try {
    if (existsSync(join(folder, '.git'))) return true;
    return readdirSync(folder, { withFileTypes: true }).some((e) => e.isDirectory() && existsSync(join(folder, e.name, '.git')));
  } catch {
    return false;
  }
}

/** The display program on the sandbox's own PATH: the `bin` of a listed folder (or the folder itself) first, then the system's. null: none, and the stage goes on without a display. */
export function displayProgram(pathDirs: string[], exists: (path: string) => boolean = executable): string | null {
  for (const dir of [...pathDirs, '/usr/local/bin', '/usr/bin']) {
    const candidate = join(dir, 'Xvfb');
    if (exists(candidate)) return candidate;
  }
  return null;
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The folders the workspace listed, made real and checked against the machine: they must exist and must not be the home, the app's data or anything that looks like a secret place. */
export function readOnlyFolders(list: string[], home: string, protect: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const expanded = raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
    let real: string;
    try {
      real = realpathSync(expanded);
      statSync(real);
    } catch {
      throw new SandboxError('path-missing', { path: raw });
    }
    // Never the home folder itself or anything that holds it (/, /home), and never the app's data, whole or in part; a folder inside the home is fine.
    const guarded = real === home || sameOrInside(home, real) || protect.some((p) => sameOrInside(real, p) || sameOrInside(p, real));
    if (guarded || readOnlyPathProblem(real) !== null) throw new SandboxError('path-refused', { path: raw });
    if (!out.includes(real)) out.push(real);
  }
  return out;
}

/**
 * The last check before a sandbox is built, over every bind it will make: nothing that sits inside the worktree (or its copy) may be a link, on either side, and the
 * folders outside it must be where they say they are. bwrap resolves links on both the source and the destination, so a link here is a way to mount something else.
 */
export function assertBindsSafe(binds: [string, string][], worktree: string, tree: string): void {
  // The main bind, which the others sit inside: a real folder, at its own real path.
  for (const main of [...new Set([worktree, tree])]) {
    let real: string;
    try {
      real = realpathSync(main);
      if (!lstatSync(main).isDirectory()) throw new Error('not a folder');
    } catch {
      throw new SandboxError('hostile-link', { name: main.slice(main.lastIndexOf('/') + 1) });
    }
    if (real !== main) throw new SandboxError('hostile-link', { name: main.slice(main.lastIndexOf('/') + 1) });
  }
  const inside = (p: string): boolean => p === worktree || p.startsWith(`${worktree}/`) || p === tree || p.startsWith(`${tree}/`);
  for (const [src, dest] of binds) {
    for (const p of [src, dest]) {
      if (!inside(p)) continue;
      try {
        if (lstatSync(p).isSymbolicLink()) throw new SandboxError('hostile-link', { name: p.slice(p.lastIndexOf('/') + 1) });
      } catch (e) {
        if (e instanceof SandboxError) throw e;
      }
    }
    if (!inside(src)) {
      let real: string;
      try {
        real = realpathSync(src);
      } catch {
        throw new SandboxError('path-missing', { path: src });
      }
      // A folder outside the worktree (the repository's directory, a listed folder) is bound as it is written: it must already be its own real path.
      if (real !== src) throw new SandboxError('path-refused', { path: src });
    }
  }
}

export function createSandboxService(o: SandboxServiceOptions): SandboxService {
  const home = o.home ?? homedir();
  const protect = (o.protect ?? []).map((p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  });
  const status = o.status ?? ((force: boolean) => sandboxStatus(force));

  /**
   * The browsers folder answers to the guards of a read-only folder and is bound like one, but is not put on PATH: it holds browsers, not tools. A folder the guards
   * refuse fails the stage, as a listed folder does; one that is gone only leaves the stage without browsers, and the app says so.
   */
  function browsersOf(config: RunnerSandbox): { browsers: string | null; browsersGone?: string } {
    if (!config.browsersPath) return { browsers: null };
    try {
      return { browsers: readOnlyFolders([config.browsersPath], home, protect)[0] };
    } catch (e) {
      if (!(e instanceof SandboxError && e.code === 'path-missing')) throw e;
      return { browsers: null, browsersGone: config.browsersPath };
    }
  }

  /** The `bin` of every read-only folder the workspace listed, for the display program to be looked for in; a folder that is gone or refused is left out. */
  function listedBins(config: RunnerSandbox): string[] {
    try {
      return readOnlyFolders(config.readOnlyPaths, home, protect).flatMap((p) => [join(p, 'bin'), p]);
    } catch {
      return [];
    }
  }

  return {
    status: (force = false) => status(force),
    async open(opts) {
      const st = await status(false);
      if (!st.available) throw new SandboxError('unavailable', { reason: reasonText(st) });
      const roFolders = readOnlyFolders(opts.config.readOnlyPaths, home, protect);
      for (const f of roFolders) if (holdsRepository(f)) opts.onNote?.({ code: 'runner.sandbox.repoFolder', params: { path: f } });
      mkdirSync(o.dir, { recursive: true, mode: 0o700 });
      // Everything is mounted by its real path: a data folder under a link (/home -> /var/home) must not make the checks that compare a path with its real one refuse it.
      const worktree = realpathSync(opts.worktree);
      const stageDir = join(realpathSync(o.dir), randomUUID().slice(0, 12));
      mkdirSync(join(stageDir, 'ctl'), { recursive: true, mode: 0o700 });
      const cleanup: (() => Promise<void> | void)[] = [];
      try {
        let tree: string | null = null;
        if (opts.reader) {
          tree = join(stageDir, 'tree');
          await copyTree(worktree, tree, opts.config.limits.copyMb * 1024 * 1024, opts.signal);
        }
        const git = gitMounts(worktree, tree ?? worktree, stageDir);
        const clone = git.clone ?? opts.clone ?? null;
        const deps = clone ? dependencyBinds(tree ?? worktree, worktree, clone) : { binds: [], outside: [] };
        for (const name of deps.outside) opts.onNote?.({ code: 'runner.sandbox.depsOutside', params: { name } });
        // The workspace's setting, met by the agent's own list: the proxy carries the hosts of both, or only the agent's when the workspace is open.
        const net = effectiveNetwork(opts.config, opts.agent);
        const registry = net.mode === 'proxy';
        const openNet = net.mode === 'open';
        if (registry) {
          const proxy = await createRegistryProxy({ socketPath: join(stageDir, 'ctl', 'proxy.sock'), hosts: net.hosts, onDecision: opts.onProxy, ...o.proxyDeps });
          cleanup.push(() => proxy.close());
        }
        const { browsers, browsersGone } = browsersOf(opts.config);
        const pathDirs = roFolders.flatMap((p) => [join(p, 'bin'), p]);
        const askedDisplay = opts.display === true && opts.config.display === true;
        const xvfb = askedDisplay ? displayProgram(pathDirs) : null;
        // A shared network still needs to resolve names: the computer's own resolver configuration is bound in, read-only, and nothing else of it.
        const resolver = openNet ? nameResolverBinds() : [];
        const roBinds: [string, string][] = [...git.binds, ...deps.binds, ...roFolders.map((p): [string, string] => [p, p]), ...(browsers && !roFolders.includes(browsers) ? [[browsers, browsers] as [string, string]] : []), ...resolver];
        assertBindsSafe(roBinds, worktree, tree ?? worktree);
        const args = bwrapArgs({
          worktree,
          tree,
          stageDir,
          system: systemLayout(),
          roBinds,
          pathDirs,
          network: net.mode,
          limits: opts.config.limits,
          tmpMb: 512,
          ...(browsers || xvfb ? { gui: { browsers, xvfb } } : {}),
        });
        const gui = browsers || browsersGone || askedDisplay ? { browsers, ...(browsersGone ? { browsersGone } : {}), display: askedDisplay ? (xvfb ? ('start' as const) : ('missing' as const)) : null } : undefined;
        return await openSession({ stageDir, args, limits: opts.config.limits, proxy: registry, onExec: opts.onExec, cleanup, ...(gui ? { gui } : {}) }, o.deps);
      } catch (e) {
        for (const c of cleanup) await Promise.resolve(c()).catch(() => undefined);
        removeTree(stageDir);
        throw e;
      }
    },
    async openHost(opts) {
      const worktree = realpathSync(opts.worktree);
      const env = o.hostEnv ?? (() => loginEnv());
      const { browsers, browsersGone } = browsersOf(opts.config);
      const askedDisplay = opts.display === true && opts.config.display === true;
      const wantsGui = !!browsers || !!browsersGone || askedDisplay;
      // An agent that only reads works in a copy, as in a sandbox: what it builds or installs there is thrown away. Its commands still reach the whole computer.
      let cwd = worktree;
      let cleanup: (() => Promise<void> | void)[] | undefined;
      if (opts.reader) {
        mkdirSync(o.dir, { recursive: true, mode: 0o700 });
        const stageDir = join(realpathSync(o.dir), randomUUID().slice(0, 12));
        cwd = join(stageDir, 'tree');
        try {
          await copyTree(worktree, cwd, opts.config.limits.copyMb * 1024 * 1024, opts.signal);
        } catch (e) {
          removeTree(stageDir);
          throw e;
        }
        cleanup = [() => void removeTree(stageDir)];
      }
      // The display is the stage's own, never the person's screen: a program of its own, started after the copy so a failed copy leaves nothing running.
      let display: 'on' | 'missing' | 'failed' | null = null;
      let displayName: string | undefined;
      if (askedDisplay) {
        const loginPath = ((await env().catch(() => process.env)).PATH ?? '').split(delimiter).filter((p) => isAbsolute(p));
        const program = displayProgram([...listedBins(opts.config), ...loginPath]);
        const started = program ? await (o.startDisplay ?? startHostDisplay)(program) : null;
        display = started ? 'on' : program ? 'failed' : 'missing';
        if (started) {
          displayName = started.name;
          cleanup = [...(cleanup ?? []), () => started.stop()];
        }
      }
      try {
        return openHostSession(
          { cwd, limits: opts.config.limits, env, onExec: opts.onExec, approve: opts.approve, ...(cleanup ? { cleanup } : {}), ...(wantsGui ? { gui: { browsers, ...(browsersGone ? { browsersGone } : {}), display, ...(displayName ? { displayName } : {}) } } : {}) },
          o.hostDeps,
        );
      } catch (e) {
        for (const c of cleanup ?? []) await Promise.resolve(c()).catch(() => undefined);
        throw e;
      }
    },
    guiStatus(config) {
      let browsers: SandboxGuiStatus['browsers'] = 'unset';
      let chromium: NonNullable<SandboxGuiStatus['chromium']> = config.browsersPath ? 'none' : 'unset';
      if (config.browsersPath) {
        try {
          const dir = readOnlyFolders([config.browsersPath], home, protect)[0];
          if (findChromium(dir).ok) chromium = 'ready';
          // Playwright keeps one folder per build (chromium-1234, chromium_headless_shell-1234, firefox-…): an empty folder offers nothing.
          browsers = readdirSync(dir).some((n) => /^(chromium|chrome|firefox|webkit)/.test(n)) ? 'ready' : 'empty';
        } catch (e) {
          browsers = e instanceof SandboxError && e.code === 'path-refused' ? 'refused' : 'missing';
        }
      }
      // A listed folder that is gone or refused already fails a sandbox stage on its own; the display is looked for on the system's path then.
      const display: SandboxGuiStatus['display'] = !config.display ? 'off' : displayProgram(listedBins(config)) ? 'ready' : 'missing';
      return { browsers, display, chromium };
    },
    purge() {
      try {
        for (const name of readdirSync(o.dir)) removeTree(join(o.dir, name));
      } catch {
        // Nothing was ever made.
      }
    },
  };
}

export { invalidateSandboxStatus };
