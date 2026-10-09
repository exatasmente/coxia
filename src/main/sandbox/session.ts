import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SandboxLimits } from '../../shared/config/types';
import { SHELL_COMMAND_MAX } from '../../shared/sandbox';
import { redact } from '../errorlog-core';
import { tail } from '../runner/commands';
import { MAX_IMAGE_BYTES, imageMediaType } from '../imageType';
import { CTL, DISPLAY_SOCKET_NAME, FORWARDER_JS, OUT, SUPERVISOR_COMMAND, SUPERVISOR_SH, X11_DIR } from './policy';
import { SandboxError } from './errors';
import { removeTree } from './remove';

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
  /** The file the sandbox writes a command's output to was not a plain file (a link, a pipe): nothing of it was read. */
  outputUnavailable?: true;
  ms: number;
  /** Why the command was not run at all. */
  refused?: 'empty' | 'size' | 'budget' | 'closed' | 'denied';
}

/** What a stage's sandbox offers to test an interface. */
export interface SandboxGui {
  /** The browsers folder, bound read-only with `PLAYWRIGHT_BROWSERS_PATH` pointing at it; null: none was set, or it is gone. */
  browsers: string | null;
  /** The folder the workspace names for the browsers no longer exists: the stage goes on without them. */
  browsersGone?: string;
  /** The virtual display: on, asked for and no display program found (`missing`), started and never came up (`failed`); null: not asked for. */
  display: 'on' | 'missing' | 'failed' | null;
  /** A host session only: the real folder the stage saves screenshots in (a sandbox has `/coxia/out` at a fixed place). */
  out?: string;
}

/** An image the stage saved in its output folder, read for the model, or why it was not. `file` is the real path on this computer of the file the picture came from. */
export type ImageRead = { ok: true; path: string; mediaType: string; data: string; file?: string } | { ok: false; why: 'outside' | 'missing' | 'not-file' | 'too-big' | 'not-image' };

/** Where the app reaches a stage's virtual display from outside: the socket of the display, and whose it is. */
export interface ScreenSocket {
  /** The socket's real path on this computer. */
  socket: string;
  kind: 'sandbox' | 'host';
}

export interface SandboxSession {
  /** What the Shell tool tells the model about where its commands run; absent: the sandbox's own text. */
  readonly description?: string;
  /** The folder made for the stage (`ctl`, `out` and `home` inside it): what the evidence tools read the stage's output from. Absent: no evidence tools. */
  readonly stageDir?: string;
  /** The folder of this stage the evidence tools and `ViewImage` read from: `out` inside a sandbox's stage folder, the output folder of a host session that tests an interface. Absent: no evidence tools. */
  readonly outputDir?: string;
  /** What the sandbox offers to test an interface; absent: nothing was asked for (a session with neither setting on). */
  readonly gui?: SandboxGui;
  /** The stage's virtual display, reachable for the live screen; set only when `gui.display` is `on`. Absent: there is no screen to show. */
  readonly screen?: ScreenSocket;
  /** Reads an image the stage saved in its output folder (`/coxia/out` inside; a host session's own folder, `gui.out`); absent where there is no such folder. */
  readImage?(path: string): ImageRead;
  /**
   * Hands a file to the inside, read-only, without a command: the app writes it into the stage's control folder, which the sandbox sees at `/coxia/ctl`.
   * Returns the path inside. For what is too big for a command (a plugin's code, the responses the app fetched for it). Absent where there is no such
   * folder (a host session).
   */
  put?(name: string, content: string): string;
  /**
   * Reads a text file a command left in the stage's output folder (`/coxia/out` inside), whole, never through a link and up to `max` bytes; null when it
   * is not there, is not a plain file or is bigger. For a result too long for a command's output (a plugin's). Absent where there is no such folder.
   */
  take?(name: string, max: number): string | null;
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
  /** What was asked for to test an interface: the browsers folder, and the display (`start`: a program to start was found; `missing`: none was). */
  gui?: { browsers: string | null; browsersGone?: string; display: 'start' | 'missing' | null };
}

export interface SessionDeps {
  spawn?: (file: string, args: string[], options: { stdio: ['pipe', 'pipe', 'pipe', 'pipe']; detached: true; env: NodeJS.ProcessEnv }) => ChildProcess;
  /** The program that builds the sandbox. */
  bwrap?: string;
}

const OUTPUT_READ = 256 * 1024;

/**
 * The end of a file the sandbox could write to, at most `max` bytes, as text; null when it is not there or is not a plain file. The sandbox owns that folder, so
 * what is at the path is what a hostile command put there: a link to a file of the person's, a pipe that never ends. The path is opened without following a link
 * and without waiting on a pipe, and what was opened is checked on the descriptor itself before a byte is read.
 */
export function readTailNoFollow(path: string, max: number): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const len = Math.min(st.size, max);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, st.size - len + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The most the app keeps of what the supervisor writes without a line end: it only ever writes short lines. */
const LINE_MAX = 4096;

export async function openSession(o: SessionOptions, deps: SessionDeps = {}): Promise<SandboxSession> {
  const ctl = join(o.stageDir, 'ctl');
  const out = join(o.stageDir, 'out');
  // The display's own folder (bound over /tmp/.X11-unix, see bwrapArgs) must exist before the sandbox starts.
  for (const d of [o.stageDir, ctl, out, join(o.stageDir, 'home'), ...(o.gui?.display === 'start' ? [join(o.stageDir, X11_DIR)] : [])]) mkdirSync(d, { recursive: true, mode: 0o700 });
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
    // A process inside could write to the supervisor's pipe without ever ending a line: only the end of it is kept.
    if (buffer.length > LINE_MAX && !buffer.includes('\n')) buffer = buffer.slice(-LINE_MAX);
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
    removeTree(o.stageDir);
  };

  // The supervisor says "ready" (after starting the forwarder and the display, when there are), "ready-nodisplay" when the display did not come up, or the program
  // that builds the sandbox says why it could not.
  let noDisplay = false;
  const ready = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(stderr.trim() || 'timeout'), o.readyMs ?? 10_000);
    const onLine = (line: string): void => {
      if (line === 'ready' || line === 'ready-nodisplay' || line === 'no-node' || line === 'no-forwarder') {
        clearTimeout(timer);
        lines.splice(lines.indexOf(onLine), 1);
        noDisplay = line === 'ready-nodisplay';
        resolve(line === 'ready' || line === 'ready-nodisplay' ? null : line);
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
        const text = readTailNoFollow(join(out, `out.${n}`), OUTPUT_READ);
        const timedOut = code === 124 || (code === 137 && ms >= secs * 1000);
        record({ command, exitCode: code, timedOut, output: text === null ? '' : redact(tail(text)), ...(text === null ? { outputUnavailable: true as const } : {}), ms }, 'run');
      };
      const onLine = (line: string): void => {
        const m = /^done (\d+) (\w+) (\d+)$/.exec(line);
        if (m && Number(m[1]) === n && m[2] === token) finish(Number(m[3]));
      };
      lines.push(onLine);
      void gone.then(() => finish(null));
      child.stdin?.write(`${n} ${token} ${secs}\n`);
    });

  const gui: SandboxGui | undefined = o.gui ? { browsers: o.gui.browsers, ...(o.gui.browsersGone ? { browsersGone: o.gui.browsersGone } : {}), display: o.gui.display === 'start' ? (noDisplay ? 'failed' : 'on') : o.gui.display === 'missing' ? 'missing' : null } : undefined;
  return {
    stageDir: o.stageDir,
    outputDir: out,
    ...(gui ? { gui } : {}),
    ...(gui?.display === 'on' ? { screen: { socket: join(o.stageDir, X11_DIR, DISPLAY_SOCKET_NAME), kind: 'sandbox' as const } } : {}),
    readImage: (path) => readOutputImage(out, path),
    take: (name, max) => readOutputText(out, name, max),
    put: (name, content) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) throw new SandboxError('path-refused', { path: name });
      mkdirSync(join(ctl, 'files'), { recursive: true, mode: 0o700 });
      writeFileSync(join(ctl, 'files', name), content, { mode: 0o600 });
      return `${CTL}/files/${name}`;
    },
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

/** Where the stage's output folder shows up inside the sandbox: the only place the agent saves images it wants to look at. */
export const OUTPUT_DIR = OUT;

/** A plain text file of the output folder, read without following a link; null when missing, not a file, or over `max` bytes. */
export function readOutputText(outDir: string, name: string, max: number): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) return null;
  let fd: number | null = null;
  try {
    fd = openSync(join(outDir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * An image the stage saved in its output folder, for the model. The path is one the agent knows: a name in the folder, or the full path of the file as this computer
 * has it (a sandbox names the folder `/coxia/out` from the inside; a host stage saves in a real folder it is told the name of). Only a file of that folder is read.
 * What is there was written by a process the app does not trust, so it is opened like the commands' output: no link followed, no pipe waited on, a regular file
 * checked on the descriptor, a size cap, and the content (not the name) must be a picture.
 */
export function readOutputImage(outDir: string, path: string, shown: string = OUT): ImageRead {
  // The folder is named to the model in one of two ways: `shown` (the sandbox's `/coxia/out`, which its own tools hand over) or, for a stage that saves in a real
  // folder, the path of that folder itself. A path under either name is read against the folder; a name relative to it is read as it is; anything else — another
  // absolute path of this computer — is outside, and refused.
  const rel =
    path === shown || path === outDir ? '' : path.startsWith(`${shown}/`) ? path.slice(shown.length + 1) : path.startsWith(`${outDir}/`) ? path.slice(outDir.length + 1) : path.startsWith('/') ? null : path;
  // A path that leaves the folder, by walking with `..` or by aiming somewhere else on this computer, is refused before anything is opened.
  if (rel === null || rel.split('/').some((part) => part === '..' || part === '')) return { ok: false, why: 'outside' };
  let fd: number | null = null;
  try {
    try {
      fd = openSync(join(outDir, rel), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      return { ok: false, why: 'missing' };
    }
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, why: 'not-file' };
    if (st.size > MAX_IMAGE_BYTES) return { ok: false, why: 'too-big' };
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    const mediaType = imageMediaType(buf.subarray(0, Math.min(got, 12)));
    if (!mediaType) return { ok: false, why: 'not-image' };
    return { ok: true, path: `${shown}/${rel}`, mediaType, data: buf.subarray(0, got).toString('base64'), file: join(outDir, rel) };
  } catch {
    return { ok: false, why: 'not-file' };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
