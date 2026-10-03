import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunnerSandbox } from '../../shared/config/types';
import { readOnlyPathProblem } from '../../shared/sandboxPaths';
import type { SandboxStatus } from '../../shared/sandbox';
import { t } from '../../shared/i18n';
import { copyTree } from './copy';
import { SandboxError } from './errors';
import { gitMounts } from './gitView';
import { bwrapArgs } from './policy';
import { invalidateSandboxStatus, sandboxStatus } from './probe';
import { type ProxyDecision, createRegistryProxy } from './proxy';
import { type ExecResult, type SandboxSession, type SessionDeps, openSession } from './session';
import { systemLayout } from './system';

export type { ExecResult, SandboxSession } from './session';
export { SandboxError } from './errors';

// The sandbox of the app: what a stage asks for to give an agent commands. It checks the machine (probe), builds the stage folder, the copy an agent that only reads works
// in, the git binds and the proxy of the registry mode, and returns the session. Everything it makes is the app's own and is removed when the session closes.

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
  /** Told, once per folder, about a listed folder that holds a repository: its `.git/config` is shown to the sandbox as it is (the cleaned copy is only for the run's own repository). */
  onRepoFolder?: (path: string) => void;
}

export interface SandboxService {
  /** The cached answer to "can this machine make a sandbox"; `force` asks again. */
  status(force?: boolean): Promise<SandboxStatus>;
  /** Makes the sandbox of one stage. Throws `SandboxError` when it cannot. */
  open(o: OpenOptions): Promise<SandboxSession>;
  /** Removes what a sandbox of an earlier process left (the app was killed). */
  purge(): void;
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

  return {
    status: (force = false) => status(force),
    async open(opts) {
      const st = await status(false);
      if (!st.available) throw new SandboxError('unavailable', { reason: reasonText(st) });
      const roFolders = readOnlyFolders(opts.config.readOnlyPaths, home, protect);
      for (const f of roFolders) if (holdsRepository(f)) opts.onRepoFolder?.(f);
      mkdirSync(o.dir, { recursive: true, mode: 0o700 });
      const stageDir = join(o.dir, randomUUID().slice(0, 12));
      mkdirSync(join(stageDir, 'ctl'), { recursive: true, mode: 0o700 });
      const cleanup: (() => Promise<void> | void)[] = [];
      try {
        let tree: string | null = null;
        if (opts.reader) {
          tree = join(stageDir, 'tree');
          await copyTree(opts.worktree, tree, opts.config.limits.copyMb * 1024 * 1024);
        }
        const git = gitMounts(opts.worktree, tree ?? opts.worktree, stageDir);
        const registry = opts.config.network === 'registry';
        if (registry) {
          const proxy = await createRegistryProxy({ socketPath: join(stageDir, 'ctl', 'proxy.sock'), hosts: opts.config.registryHosts, onDecision: opts.onProxy });
          cleanup.push(() => proxy.close());
        }
        const roBinds: [string, string][] = [...git.binds, ...roFolders.map((p): [string, string] => [p, p])];
        assertBindsSafe(roBinds, opts.worktree, tree ?? opts.worktree);
        const args = bwrapArgs({
          worktree: opts.worktree,
          tree,
          stageDir,
          system: systemLayout(),
          roBinds,
          pathDirs: roFolders.flatMap((p) => [join(p, 'bin'), p]),
          network: registry ? 'proxy' : 'off',
          limits: opts.config.limits,
          tmpMb: 512,
        });
        return await openSession({ stageDir, args, limits: opts.config.limits, proxy: registry, onExec: opts.onExec, cleanup }, o.deps);
      } catch (e) {
        for (const c of cleanup) await Promise.resolve(c()).catch(() => undefined);
        rmSync(stageDir, { recursive: true, force: true });
        throw e;
      }
    },
    purge() {
      try {
        for (const name of readdirSync(o.dir)) rmSync(join(o.dir, name), { recursive: true, force: true });
      } catch {
        // Nothing was ever made.
      }
    },
  };
}

export { invalidateSandboxStatus };
