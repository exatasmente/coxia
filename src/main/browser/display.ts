import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DISPLAY_SOCKET_NAME, X11_DIR } from '../sandbox/policy';
import { systemLayout } from '../sandbox/system';
import { displayBwrapArgs, displayCommand } from './policy';

// The display of an agent that has no shell session to lend one (`shell: none` or a host list): a `bwrap` of the app's own with no network at all that runs only the display
// program. Its socket is made in a folder of the session, so the app (never a program inside) reads the screen and sends the person's input, as for a stage's display.

export interface DisplaySandbox {
  /** The socket's real path on this computer, and its name (`X99`). */
  socket: string;
  name: string;
  /** Ends the display and everything in it; idempotent. */
  stop(): Promise<void>;
}

export interface DisplayDeps {
  spawn?: (file: string, args: string[], options: { detached: true; stdio: 'ignore'; env: NodeJS.ProcessEnv }) => ChildProcess;
  bwrap?: string;
  /** Replaced in tests: the machine's top-level folders. */
  system?: () => ReturnType<typeof systemLayout>;
  /** How long to wait for the socket to appear (ms). */
  readyMs?: number;
}

/** Starts the display sandbox in `sessionDir`; null when it did not come up in time or ended on its own (the browser is not started without a screen). */
export async function startDisplaySandbox(o: { sessionDir: string; xvfb: string; tmpMb?: number }, deps: DisplayDeps = {}): Promise<DisplaySandbox | null> {
  mkdirSync(join(o.sessionDir, X11_DIR), { recursive: true, mode: 0o700 });
  const args = displayBwrapArgs({ system: (deps.system ?? systemLayout)(), sessionDir: o.sessionDir, tmpMb: o.tmpMb ?? 128 });
  const spawn = deps.spawn ?? ((f, a, opt) => nodeSpawn(f, a, opt));
  let child: ChildProcess;
  try {
    child = spawn(deps.bwrap ?? 'bwrap', [...args, '--', ...displayCommand(o.xvfb)], { detached: true, stdio: 'ignore', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
  } catch {
    return null;
  }
  let ended = false;
  const gone = new Promise<void>((resolve) => {
    child.once('exit', () => {
      ended = true;
      resolve();
    });
    child.once('error', () => {
      ended = true;
      resolve();
    });
  });
  const kill = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The group is already gone.
    }
  };
  const stop = async (): Promise<void> => {
    if (ended) return;
    kill('SIGTERM');
    await Promise.race([gone, new Promise((r) => setTimeout(r, 1000))]);
    if (!ended) kill('SIGKILL');
  };
  const socket = join(o.sessionDir, X11_DIR, DISPLAY_SOCKET_NAME);
  const deadline = Date.now() + (deps.readyMs ?? 5000);
  while (Date.now() < deadline && !ended && !existsSync(socket)) await new Promise((r) => setTimeout(r, 50));
  if (ended || !existsSync(socket)) {
    await stop();
    return null;
  }
  return { socket, name: DISPLAY_SOCKET_NAME, stop };
}
