import type { RunnerSandbox } from '../../shared/config/types';
import { SandboxError } from '../sandbox/errors';
import { readOnlyFolders } from '../sandbox';
import { findChromium } from './chromium';

// The browsers folder the person set, as the sandbox's guards make it real, and the full Chromium in it: what the app's browser is started with. The same guards that bind the
// folder into a sandbox: a folder that is the home, the app's data or a place that looks like a secret is refused.

export type BrowsersResolved = { ok: true; browsers: string; chromium: string; build: number } | { ok: false; why: 'unset' | 'missing' | 'refused' | 'none' };

export function resolveBrowsers(config: Pick<RunnerSandbox, 'browsersPath'>, home: string, protect: string[]): BrowsersResolved {
  if (!config.browsersPath) return { ok: false, why: 'unset' };
  let dir: string;
  try {
    dir = readOnlyFolders([config.browsersPath], home, protect)[0];
  } catch (e) {
    return { ok: false, why: e instanceof SandboxError && e.code === 'path-refused' ? 'refused' : 'missing' };
  }
  const found = findChromium(dir);
  return found.ok ? { ok: true, browsers: dir, chromium: found.executable, build: found.build } : { ok: false, why: 'none' };
}
