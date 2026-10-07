import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import type { Readable } from 'node:stream';

// The virtual display of a stage whose agent runs on this computer (`shell: host`): an Xvfb of its own, so a window app under test never opens on the person's screen. The
// server picks a free display number itself (`-displayfd`), listens on a socket only (no TCP) and ends with the stage.

export interface HostDisplay {
  /** What `DISPLAY` is set to for the stage's commands (`:101`). */
  name: string;
  /** Ends the server; idempotent. */
  stop(): Promise<void>;
}

export interface HostDisplayDeps {
  spawn?: (file: string, args: string[], options: { detached: true; stdio: ['ignore', 'ignore', 'ignore', 'pipe'] }) => ChildProcess;
  /** How long to wait for the server to say which display it took (ms). */
  readyMs?: number;
}

/** The screen the stage's windows open on; the same size the sandbox's display has. */
export const HOST_DISPLAY_ARGS = ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'];

/** Starts the display program; null when it did not come up in time or ended on its own (the stage goes on without a display and the app says so). */
export function startHostDisplay(program: string, deps: HostDisplayDeps = {}): Promise<HostDisplay | null> {
  const spawn = deps.spawn ?? ((f, a, opt) => nodeSpawn(f, a, opt));
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(program, HOST_DISPLAY_ARGS, { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    let ended = false;
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The group is already gone.
      }
    };
    const gone = new Promise<void>((r) => {
      child.once('exit', () => {
        ended = true;
        r();
      });
      child.once('error', () => {
        ended = true;
        r();
      });
    });
    const stop = async (): Promise<void> => {
      if (ended) return;
      kill('SIGTERM');
      await Promise.race([gone, new Promise((r) => setTimeout(r, 1000))]);
      if (!ended) kill('SIGKILL');
    };
    let settled = false;
    const finish = (name: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (name) resolve({ name, stop });
      else void stop().then(() => resolve(null));
    };
    const timer = setTimeout(() => finish(null), deps.readyMs ?? 5000);
    const pipe = child.stdio[3] as Readable | null | undefined;
    if (!pipe) return finish(null);
    let text = '';
    pipe.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const m = /^(\d{1,5})\n/.exec(text);
      if (m) finish(`:${m[1]}`);
    });
    pipe.on('error', () => finish(null));
    void gone.then(() => finish(null));
  });
}
