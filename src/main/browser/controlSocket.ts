import { type FSWatcher, readdirSync, unlinkSync, watch } from 'node:fs';
import { join } from 'node:path';

// The Playwright MCP server binds every browser it starts to a unix socket (`<PWTEST_SOCKETS_DIR>/browser/browser-<hash>.sock`, mode 0775) that speaks the whole Playwright
// protocol with no token, for its own command-line client to attach. There is no option to turn that off, and the app never attaches: the intermediary talks to the server on
// its standard input and output. A process of the same user that could reach the socket would drive the browser around the hold, so the app takes the socket's name away the
// moment it appears. The listening socket stays open and unreachable; the server unlinks the name again when the browser ends and takes a missing one for done.

const SOCKET = /\.sock$/;
const POLL_MS = 200;

/** Unlinks every socket name in `dir` as it appears (a watch, and a poll for the events a watch can miss). Returns what stops it. */
export function dropControlSockets(dir: string): () => void {
  const sweep = (): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!SOCKET.test(name)) continue;
      try {
        unlinkSync(join(dir, name));
      } catch {
        // Gone already.
      }
    }
  };
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, sweep);
    watcher.on('error', () => undefined);
  } catch {
    // The poll covers it.
  }
  const timer = setInterval(sweep, POLL_MS);
  timer.unref();
  return () => {
    watcher?.close();
    clearInterval(timer);
  };
}
