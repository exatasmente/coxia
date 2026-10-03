import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SandboxLimits } from '../../shared/config/types';
import { SHELL_COMMAND_MAX } from '../../shared/sandbox';
import { redact } from '../errorlog-core';
import { tail } from '../runner/commands';
import { FORWARDER_JS, SUPERVISOR_COMMAND, SUPERVISOR_SH } from './policy';
import { SandboxError } from './errors';

// One sandbox for one stage: a `bwrap` process that stays up and runs a supervisor, so a process one command starts (a dev server) is still there for the next, and
// everything ends together when the stage does. The commands go in as files of a read-only folder and a line on its standard input; the answer is a line on its standard
// output carrying a token the app made for that command, and the output is read from a file the sandbox can write.

/** What one command did. `output` is the end of its output, masked. */
export interface ExecResult {
  /** 1-based, in the order of the stage. */
  n: number;
  command: string;
  /** null when it did not run to an exit (refused, or the sandbox ended). */
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  ms: number;
  /** Why the command was not run at all. */
  refused?: 'empty' | 'size' | 'budget' | 'closed';
}

export interface SandboxSession {
  /** Runs one command; one at a time per stage (calls queue). Never throws for a command that fails. */
  exec(command: string): Promise<ExecResult>;
  /** Every command of the stage, in order, with what it did. */
  readonly log: readonly ExecResult[];
  /** Ends the sandbox and everything in it, and removes the stage folder. Idempotent. */
  close(): Promise<void>;
}

export interface SessionOptions {
  /** The folder made for the stage: `ctl`, `out` and `home` are made inside it. */
  stageDir: string;
  /** The options of `bwrap`, built by `bwrapArgs`. */
  args: string[];
  /** What runs inside (default: the supervisor). */
  command?: string[];
  limits: SandboxLimits;
  /** In registry mode: the forwarder is written beside the supervisor. */
  proxy: boolean;
  /** Told about every command as it ends (the thread, the audit log, the live activity). */
  onExec?: (result: ExecResult, mode: 'run' | 'refused') => void;
  /** What to undo besides the stage folder: the proxy of the registry mode. */
  cleanup?: (() => Promise<void> | void)[];
  /** How long to wait for the supervisor to say it is ready (ms). */
  readyMs?: number;
}

export interface SessionDeps {
  spawn?: (file: string, args: string[], options: { stdio: ['pipe', 'pipe', 'pipe', 'pipe']; detached: true; env: NodeJS.ProcessEnv }) => ChildProcess;
  /** The program that builds the sandbox. */
  bwrap?: string;
}

const OUTPUT_READ = 256 * 1024;

/** The end of a file, at most `max` bytes, as text; empty when it is not there. */
function tailOfFile(path: string, max: number): string {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    fd = openSync(path, 'r');
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export async function openSession(o: SessionOptions, deps: SessionDeps = {}): Promise<SandboxSession> {
  const ctl = join(o.stageDir, 'ctl');
  const out = join(o.stageDir, 'out');
  for (const d of [o.stageDir, ctl, out, join(o.stageDir, 'home')]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(ctl, 'supervisor.sh'), SUPERVISOR_SH, { mode: 0o700 });
  if (o.proxy) writeFileSync(join(ctl, 'forward.js'), FORWARDER_JS, { mode: 0o600 });

  const spawn = deps.spawn ?? ((f, a, opt) => nodeSpawn(f, a, opt));
  // The program that builds the sandbox gets an empty environment but a PATH to find itself with; the options go through a pipe, so no path of the host is on a command line a process inside could read with `ps`.
  const child = spawn(deps.bwrap ?? 'bwrap', ['--args', '3', '--', ...(o.command ?? SUPERVISOR_COMMAND)], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], detached: true, env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
  let exited = false;
  let stderr = '';
  let buffer = '';
  const lines: ((line: string) => void)[] = [];
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      for (const l of [...lines]) l(line);
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (c: string) => {
    if (stderr.length < 2000) stderr += c;
  });
  const gone = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
    child.once('error', () => {
      exited = true;
      resolve();
    });
  });
  child.stdin?.on('error', () => undefined);
  const argsPipe = child.stdio[3] as NodeJS.WritableStream | null | undefined;
  argsPipe?.on('error', () => undefined);
  argsPipe?.end(Buffer.from(`${o.args.join('\0')}\0`));

  const kill = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The group is already gone.
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // So is the process.
    }
  };

  let closed = false;
  const results: ExecResult[] = [];
  let spent = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      child.stdin?.write('quit 0 0\n');
    } catch {
      // Killed below anyway.
    }
    kill();
    await Promise.race([gone, new Promise<void>((r) => setTimeout(r, 3000))]);
    for (const c of o.cleanup ?? []) {
      try {
        await c();
      } catch (e) {
        console.error('[sandbox] cleanup', e instanceof Error ? e.message : e);
      }
    }
    rmSync(o.stageDir, { recursive: true, force: true });
  };

  // The supervisor says "ready" (after starting the forwarder, when there is one), or the program that builds the sandbox says why it could not.
  const ready = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(stderr.trim() || 'timeout'), o.readyMs ?? 10_000);
    const onLine = (line: string): void => {
      if (line === 'ready' || line === 'no-node' || line === 'no-forwarder') {
        clearTimeout(timer);
        resolve(line === 'ready' ? null : line);
      }
    };
    lines.push(onLine);
    void gone.then(() => {
      clearTimeout(timer);
      resolve(stderr.trim() || 'exited');
    });
  });
  if (ready !== null) {
    await close();
    if (ready === 'no-node') throw new SandboxError('no-node');
    if (ready === 'no-forwarder') throw new SandboxError('start-failed', { detail: 'the forwarder of the registry mode did not start' });
    throw new SandboxError('start-failed', { detail: redact(ready.split('\n')[0]).slice(0, 300) });
  }

  const run = (command: string): Promise<ExecResult> =>
    new Promise((resolve) => {
      const n = results.length + 1;
      const record = (r: Omit<ExecResult, 'n'>, mode: 'run' | 'refused'): void => {
        const full: ExecResult = { n, ...r };
        results.push(full);
        try {
          o.onExec?.(full, mode);
        } catch (e) {
          console.error('[sandbox] reporting a command', e instanceof Error ? e.message : e);
        }
        resolve(full);
      };
      const refuse = (refused: NonNullable<ExecResult['refused']>): void => record({ command, exitCode: null, timedOut: false, output: '', ms: 0, refused }, 'refused');
      if (closed || exited) return refuse('closed');
      if (!command.trim()) return refuse('empty');
      if (Buffer.byteLength(command) > SHELL_COMMAND_MAX) return refuse('size');
      const left = o.limits.stageMs - spent;
      if (left <= 0) return refuse('budget');
      const secs = Math.max(1, Math.ceil(Math.min(o.limits.commandMs, left) / 1000));
      writeFileSync(join(ctl, `cmd.${n}`), `${command}\n`, { mode: 0o600 });
      const token = randomBytes(8).toString('hex');
      const started = Date.now();
      let settled = false;
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        const at = lines.indexOf(onLine);
        if (at >= 0) lines.splice(at, 1);
        const ms = Date.now() - started;
        spent += ms;
        const text = tailOfFile(join(out, `out.${n}`), OUTPUT_READ);
        const timedOut = code === 124 || (code === 137 && ms >= secs * 1000);
        record({ command, exitCode: code, timedOut, output: redact(tail(text)), ms }, 'run');
      };
      const onLine = (line: string): void => {
        const m = /^done (\d+) (\w+) (\d+)$/.exec(line);
        if (m && Number(m[1]) === n && m[2] === token) finish(Number(m[3]));
      };
      lines.push(onLine);
      void gone.then(() => finish(null));
      child.stdin?.write(`${n} ${token} ${secs}\n`);
    });

  return {
    exec: (command) => {
      const next = queue.then(() => run(command));
      queue = next.catch(() => undefined);
      return next;
    },
    get log() {
      return results;
    },
    close,
  };
}
