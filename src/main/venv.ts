import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, statfsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

// The pieces the voice setup is built from: finding uv, the environment's marker, running a tool with progress and a cancel, sizes on disk.

/** Written after the packages are installed; an interrupted install has no marker and is resumed, not trusted. */
export const READY = '.cerimonias-ready';
/** Python the sidecar is built on. uv fetches it when the machine has none. */
export const PYTHON_VERSION = '3.12';

export function venvPython(venv: string): string {
  return join(venv, 'bin/python');
}

/** An environment the sidecar can run from: python is there and the install finished. */
export function venvReady(venv: string): boolean {
  return existsSync(venvPython(venv)) && existsSync(join(venv, READY));
}

/** First "uv" found in the given folders, then in PATH. A desktop session often lacks ~/.local/bin in PATH, so the home folder comes first. */
export function findUv(opts: { home: string; env: NodeJS.ProcessEnv; extraDirs?: string[] }): string | null {
  const dirs = [...(opts.extraDirs ?? []), join(opts.home, '.local/bin'), ...(opts.env.PATH ?? '').split(delimiter)];
  for (const dir of dirs) {
    const candidate = join(dir, 'uv');
    if (dir && existsSync(candidate)) return candidate;
  }
  return null;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface StepOptions {
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Every line the tool prints, stdout and stderr. */
  onLine?: (line: string, stream: 'out' | 'err') => void;
  cwd?: string;
  onChild?: (child: ChildProcess) => void;
}

const KILL_AFTER_MS = 3000;

/** Runs one tool to its end. Rejects with the tail of its stderr; a cancel kills it (SIGTERM, then SIGKILL) and rejects with CancelledError. */
export function runStep(cmd: string, args: string[], opts: StepOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    const child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    opts.onChild?.(child);
    const tail: string[] = [];
    let cancelled = false;
    let killer: NodeJS.Timeout | null = null;
    const feed = (stream: 'out' | 'err') => {
      let rest = '';
      return (chunk: Buffer) => {
        rest += chunk.toString('utf8');
        const parts = rest.split(/\r?\n|\r/);
        rest = parts.pop() ?? '';
        for (const line of parts) {
          if (!line.trim()) continue;
          if (stream === 'err') tail.push(line);
          if (tail.length > 12) tail.shift();
          opts.onLine?.(line, stream);
        }
      };
    };
    child.stdout?.on('data', feed('out'));
    child.stderr?.on('data', feed('err'));
    const onAbort = () => {
      cancelled = true;
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => {
      if (killer) clearTimeout(killer);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (e) => {
      done();
      reject(e);
    });
    child.on('close', (code, signal) => {
      done();
      if (cancelled) return reject(new CancelledError());
      if (code === 0) return resolve();
      reject(new Error(tail.join('\n') || `${cmd} exited with ${code ?? signal}`));
    });
  });
}

/** Bytes under a folder (links are not followed: a symlinked environment counts as nothing). */
export function dirSize(path: string): number {
  let total = 0;
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  for (const name of readdirSync(path)) total += dirSize(join(path, name));
  return total;
}

/** Free bytes on the volume that holds `dir` (or its nearest existing parent), or null when the platform cannot tell. */
export function freeBytes(dir: string): number | null {
  let at = dir;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  try {
    const fs = statfsSync(at);
    return Number(fs.bavail) * Number(fs.bsize);
  } catch {
    return null;
  }
}
