// What happens to the app's browser when the app's process ends without closing it (a quit that does not wait for the screens, a crash): the Playwright MCP server is started
// detached, in a group of its own, so nothing but the pipe to the app ties it to the app. Its browser is a `bwrap` with `--die-with-parent` (pinned by the argument tests of
// browser-runtime), so it ends when the server does; what is left to show is that the server ends when the pipe closes.
import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { playwrightMcpCli } from '../src/main/paths';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const gone = async (pid: number, ms: number): Promise<boolean> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
};

// A stand-in for the app: it starts the server the way `launch.ts` does (detached, stdio held only by it) and says its pid; the test then kills it the hardest way.
const APP = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [process.argv[1], '--headless', '--no-sandbox'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, ELECTRON_RUN_AS_NODE: '1' } });
process.stdout.write('SERVER ' + child.pid + '\\n');
setInterval(() => undefined, 1000);
`;

describe('the app\'s browser when the app ends', () => {
  it('ends the Playwright MCP server when the app is killed, so its browser goes with it', async () => {
    const app: ChildProcess = spawn(process.execPath, ['-e', APP, playwrightMcpCli()], { stdio: ['ignore', 'pipe', 'inherit'] });
    const pid = await new Promise<number>((resolve, reject) => {
      app.stdout?.on('data', (d: Buffer) => {
        const m = /SERVER (\d+)/.exec(String(d));
        if (m) resolve(Number(m[1]));
      });
      app.once('error', reject);
      app.once('exit', () => reject(new Error('the stand-in ended before it started the server')));
    });
    try {
      // Give the server time to be up and listening on its input.
      await new Promise((r) => setTimeout(r, 1500));
      expect(alive(pid)).toBe(true);
      app.kill('SIGKILL');
      expect(await gone(pid, 8000)).toBe(true);
    } finally {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already gone, which is what the test is about.
      }
      app.kill('SIGKILL');
    }
  }, 20_000);
});
;
