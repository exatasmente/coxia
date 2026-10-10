import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The browser the app's browser runs: a full Chromium out of the folder of browsers the person set (`runner.sandbox.browsersPath`, the one Playwright downloads into). The app
// downloads and ships none. A headless shell cannot draw on a display, so only `chromium-<build>` counts, never `chromium_headless_shell-<build>`.

export type ChromiumFound = { ok: true; executable: string; build: number } | { ok: false; why: 'none' | 'unreadable' };

// The folder inside a build differs by Playwright version: `chrome-linux64` today, `chrome-linux` before.
const INSIDE = ['chrome-linux64', 'chrome-linux'];

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The newest full Chromium in a browsers folder (already made real and checked by the sandbox's guards). */
export function findChromium(browsersDir: string): ChromiumFound {
  let names: string[];
  try {
    names = readdirSync(browsersDir);
  } catch {
    return { ok: false, why: 'unreadable' };
  }
  const builds = names
    .map((n) => /^chromium-(\d+)$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[0], build: Number(m[1]) }))
    .sort((a, b) => b.build - a.build);
  for (const { name, build } of builds) {
    for (const inside of INSIDE) {
      const executable = join(browsersDir, name, inside, 'chrome');
      if (isExecutable(executable)) return { ok: true, executable, build };
    }
  }
  return { ok: false, why: 'none' };
}
