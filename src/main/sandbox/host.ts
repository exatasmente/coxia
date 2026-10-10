import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxLimits } from '../../shared/config/types';
import { SHELL_COMMAND_MAX } from '../../shared/sandbox';
import { redact } from '../errorlog-core';
import { scrubbedEnv } from '../engine/guard';
import { type ExecResult, type OutputMask, type SandboxGui, type SandboxSession, type ScreenSocket, handoffRefusal, readOutputImage, readTailNoFollow, shownOutput } from './session';

// The session of an agent set to `shell: host`: the same Shell tool, log and limits of time as a sandbox, but every command runs on this computer, as the person who runs
// the app, with the login PATH and the app's environment cleaned of what looks like a credential. Nothing confines it: it reaches what the person reaches (the network,
// the container engine, a display, an emulator). It is the person's choice, made on the computer, for one agent. Each command starts its own process group, so a process
// it leaves in the background (a dev server) stays up for the next command and is ended with the others when the stage ends. With `approve`, no command starts before the
// person allows it: the time spent waiting is not the stage's time for commands.
//
// To test an interface (`gui`), the session adds what a sandbox gives by itself: the browsers folder in `PLAYWRIGHT_BROWSERS_PATH`, the stage's own virtual display in
// `DISPLAY` (never the person's screen: without the virtual display, none) and a folder to save screenshots in, the only place `ViewImage` reads from.

export interface HostSessionOptions {
  /** Where the commands run: the worktree, or the throwaway copy of an agent that only reads. */
  cwd: string;
  /** Only the limits of time apply: memory, processes and file size are the computer's own. */
  limits: Pick<SandboxLimits, 'commandMs' | 'stageMs'>;
  /** The environment a command starts from, before it is cleaned (the real one adds the login PATH). */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** Told about every command as it ends (the thread, the audit log, the live activity). */
  onExec?: (result: ExecResult, mode: 'run' | 'refused') => void;
  /** Asked before each command starts; a refusal comes back to the model as a command that did not run, with the person's note. */
  approve?: (command: string) => Promise<{ ok: boolean; note?: string }>;
  /** What to undo once everything has ended: the copy of a reader, the display. */
  cleanup?: (() => Promise<void> | void)[];
  /**
   * The entries of the workspace's test environment the launcher already resolved. Merged over the cleaned environment after the scrub, so the scrub can
   * never drop a test name and no person credential ever rides under one. A stage that tests the app under development itself — this app — also has its
   * data folder pointed inside the stage's throwaway folder here: fresh empty folders, never the person's real data or secrets file.
   */
  testEnv?: { vars?: Record<string, string>; emptyDataDirs?: string[] };
  /** Asked for by the caller, who found the browsers and started the display: the session makes the output folder and adds the variables. Absent: nothing changes. */
  gui?: { browsers: string | null; browsersGone?: string; display: SandboxGui['display']; /** `DISPLAY` for the commands; set when `display` is `on`. */ displayName?: string };
  /** The person has the screen for a hand-off (#178): a command is refused, unlogged, before the person is asked to allow it, while this answers true. */
  held?: () => boolean;
  /** Takes what the person typed during a hand-off out of a command's output, before the pattern-based masking. */
  mask?: OutputMask;
}

export interface HostSessionDeps {
  spawn?: (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: ['ignore', number, number] }) => ChildProcess;
  platform?: NodeJS.Platform;
}

/** Where a display of this computer has its socket, from the name `DISPLAY` is set to (`:101`); null for a name that is not a plain display number. */
export function hostDisplaySocket(name: string): string | null {
  const m = /^:(\d{1,5})$/.exec(name);
  return m ? `/tmp/.X11-unix/X${m[1]}` : null;
}

/** The most of a command's output that is read back: what the model gets is the end of it. */
const OUTPUT_READ = 256 * 1024;

// i18n-ignore-next-line: tool description for the model: English by design
export const HOST_SHELL_DESCRIPTION = 'Runs one shell command on this computer, as the person who runs the app, in your working folder: it reaches what they reach (the network, installed tools, containers, emulators), without their credentials in the environment. A process you start in the background stays until the end of your stage. One command at a time.';

export function openHostSession(o: HostSessionOptions, deps: HostSessionDeps = {}): SandboxSession {
  const spawn = deps.spawn ?? ((f, a, opt) => nodeSpawn(f, a, opt));
  const windows = (deps.platform ?? process.platform) === 'win32';
  const groups = new Set<ChildProcess>();
  const results: ExecResult[] = [];
  // Output goes to a file, not a pipe: a process left in the background keeps writing after the command ends, and a closed pipe would kill it.
  const outDir = mkdtempSync(join(tmpdir(), 'coxia-host-'));
  // Fresh empty folders per name (the data and specs folders of the app under development, when the launcher named them): made here, inside the session's
  // throwaway folder, so the person's real data never shows up under them, and removed with the session.
  const emptyDirs = new Map<string, string>();
  for (const name of o.testEnv?.emptyDataDirs ?? []) emptyDirs.set(name, join(outDir, name.replace(/[^A-Za-z0-9.-]/g, '')));
  for (const dir of emptyDirs.values()) mkdirSync(dir, { mode: 0o700 });
  // Every value here is the launcher's; merged over the scrub, it can never undo what the scrub did, and nothing real rides under a test name.
  const appliedVars = (): Record<string, string> => ({ ...(o.testEnv?.vars ?? {}), ...Object.fromEntries(emptyDirs) });
  // Screenshots and traces, apart from the commands' output files: the one folder `ViewImage` reads.
  const shots = o.gui ? join(outDir, 'out') : null;
  if (shots) mkdirSync(shots, { mode: 0o700 });
  const gui: SandboxGui | undefined = o.gui && shots ? { browsers: o.gui.browsers, ...(o.gui.browsersGone ? { browsersGone: o.gui.browsersGone } : {}), display: o.gui.display, out: shots } : undefined;
  const socket = o.gui?.display === 'on' && o.gui.displayName ? hostDisplaySocket(o.gui.displayName) : null;
  const screen: ScreenSocket | undefined = socket ? { socket, kind: 'host' } : undefined;
  // The variables a command starts with to test an interface. With the display on, a Wayland session or an authority file of the person's must not win over it.
  const guiEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
    if (!o.gui || !shots) return env;
    const next: NodeJS.ProcessEnv = { ...env, COXIA_OUT: shots };
    if (o.gui.browsers) next.PLAYWRIGHT_BROWSERS_PATH = o.gui.browsers;
    if (o.gui.display === 'on' && o.gui.displayName) {
      next.DISPLAY = o.gui.displayName;
      delete next.WAYLAND_DISPLAY;
      delete next.XAUTHORITY;
    } else if (o.gui.display === 'missing' || o.gui.display === 'failed') {
      // The person asked for the virtual display, not for their screen: a window app finds none and fails, and the agent was told to mark that scenario not run.
      delete next.DISPLAY;
      delete next.WAYLAND_DISPLAY;
    }
    return next;
  };
  let spent = 0;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  const kill = (child: ChildProcess, signal: NodeJS.Signals): void => {
    try {
      if (!windows && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The group is already gone.
    }
  };

  const run = (command: string): Promise<ExecResult> =>
    new Promise((resolve) => {
      const n = results.length + 1;
      // A command queued before the person took the screen is asked again here, before it reaches the person as a request to allow it.
      if (o.held?.()) return resolve(handoffRefusal(n, command));
      const record = (r: Omit<ExecResult, 'n'>, mode: 'run' | 'refused'): void => {
        const full: ExecResult = { n, ...r };
        results.push(full);
        try {
          o.onExec?.(full, mode);
        } catch (e) {
          console.error('[host] reporting a command', e instanceof Error ? e.message : e);
        }
        resolve(full);
      };
      const refuse = (refused: NonNullable<ExecResult['refused']>): void => record({ command, exitCode: null, timedOut: false, output: '', ms: 0, refused }, 'refused');
      if (closed) return refuse('closed');
      if (!command.trim()) return refuse('empty');
      if (Buffer.byteLength(command) > SHELL_COMMAND_MAX) return refuse('size');
      if (o.limits.stageMs - spent <= 0) return refuse('budget');
      void (o.approve ? o.approve(command) : Promise.resolve({ ok: true as boolean, note: undefined as string | undefined }))
        .catch(() => ({ ok: false, note: undefined }))
        .then(async (answer) => {
          if (closed) return refuse('closed');
          // The person took the screen for a hand-off while the command waited to be allowed.
          if (o.held?.()) return resolve(handoffRefusal(n, command));
          if (!answer.ok) return record({ command, exitCode: null, timedOut: false, output: answer.note ? redact(answer.note.slice(0, 500)) : '', ms: 0, refused: 'denied' }, 'refused');
          start(guiEnv(await o.env().catch(() => ({ ...process.env }))));
        });
      const start = (env: NodeJS.ProcessEnv): void => {
        if (closed) return refuse('closed');
        const left = o.limits.stageMs - spent;
        const started = Date.now();
        const outFile = join(outDir, `out.${n}`);
        let child: ChildProcess;
        const fd = openSync(outFile, 'w', 0o600);
        const finalEnv = (): NodeJS.ProcessEnv => {
          const base = scrubbedEnv(env) as NodeJS.ProcessEnv;
          // Over the scrub, on purpose: the test names were never in the person's environment, so the scrub has nothing of theirs to lose with them,
          // and nothing real can arrive under a test name — every value here is the launcher's.
          return { ...base, ...appliedVars() };
        };
        try {
          child = windows
            ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: o.cwd, env: finalEnv(), detached: false, stdio: ['ignore', fd, fd] })
            : spawn(existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', command], { cwd: o.cwd, env: finalEnv(), detached: true, stdio: ['ignore', fd, fd] });
        } catch (e) {
          return record({ command, exitCode: null, timedOut: false, output: redact(String(e instanceof Error ? e.message : e)), ms: 0 }, 'run');
        } finally {
          closeSync(fd);
        }
        groups.add(child);
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => {
          timedOut = true;
          kill(child, 'SIGKILL');
        }, Math.min(o.limits.commandMs, left));
        const finish = (code: number | null, error?: string): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const ms = Date.now() - started;
          spent += ms;
          const output = readTailNoFollow(outFile, OUTPUT_READ) ?? '';
          const shown = shownOutput(error ? `${output}\n${error}` : output, o.mask);
          record({ command, exitCode: timedOut ? null : code, timedOut, output: shown ?? '', ...(shown === null ? { outputUnavailable: true as const } : {}), ms }, 'run');
        };
        child.once('exit', (code, signal) => finish(code ?? (signal ? 128 + (signalNumber(signal) ?? 0) : null)));
        child.once('error', (e) => finish(null, e.message));
      };
    });

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // A command still running (the stage was stopped) ends with its group: its answer comes with the exit.
    for (const child of groups) kill(child, 'SIGTERM');
    if (groups.size) await new Promise((r) => setTimeout(r, 500));
    for (const child of groups) kill(child, 'SIGKILL');
    groups.clear();
    rmSync(outDir, { recursive: true, force: true });
    for (const c of o.cleanup ?? []) {
      try {
        await c();
      } catch (e) {
        console.error('[host] cleanup', e instanceof Error ? e.message : e);
      }
    }
  };

  return {
    description: HOST_SHELL_DESCRIPTION,
    ...(screen ? { screen } : {}),
    ...(gui ? { gui, outputDir: shots as string, readImage: (path: string) => readOutputImage(shots as string, path, shots as string) } : {}),
    exec: (command) => {
      // At the door, so a refusal does not wait behind a command that is still running.
      if (o.held?.()) return Promise.resolve(handoffRefusal(results.length + 1, command));
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

const SIGNALS: Partial<Record<NodeJS.Signals, number>> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
const signalNumber = (s: NodeJS.Signals): number | undefined => SIGNALS[s];
