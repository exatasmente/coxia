import { join } from 'node:path';
import type { BuildInfo } from '../shared/update';

export { stripDirty } from '../shared/update';

// scripts/update.sh starts the installed binary with this flag: the running instance receives it as a
// second-instance argv and quits cleanly; the process that sent it exits at once.
export const QUIT_FLAG = '--quit-for-update';

export function wantsQuitForUpdate(argv: readonly string[]): boolean {
  return argv.includes(QUIT_FLAG);
}

export function readBuild(version: string, commit?: string, builtAt?: string): BuildInfo {
  return { version, commit: commit || 'dev', builtAt: builtAt || '' };
}

// `git rev-list --count <installed>..main`
export function parseBehind(out: string): number | null {
  const n = Number(out.trim());
  return /^\d+$/.test(out.trim()) && Number.isSafeInteger(n) ? n : null;
}

// update.sh must not mistake itself, or the instance it is about to replace, for the running app, and the new
// instance must not inherit the paths of the AppImage mount that is going away.
const APPIMAGE_VARS = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];

export function updateEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const appDir = env.APPDIR;
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of APPIMAGE_VARS) delete out[key];
  if (appDir) {
    for (const key of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'PYTHONPATH', 'GSETTINGS_SCHEMA_DIR']) {
      const value = out[key];
      if (value === undefined) continue;
      const kept = value.split(':').filter((p) => p && !p.startsWith(appDir));
      if (kept.length) out[key] = kept.join(':');
      else delete out[key];
    }
  }
  return out;
}

export function stateDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.XDG_STATE_HOME || join(home, '.local/state'), 'cerimonias');
}

export const updateLogName = 'update.log';
export const updatedMarkerName = 'updated.json';

// update.sh (commit) or the app itself before a published-release install (version) leaves this; the next start announces it once.
export function parseUpdatedMarker(text: string): { commit: string | null; version: string | null } | null {
  try {
    const data = JSON.parse(text) as { commit?: unknown; version?: unknown };
    return { commit: typeof data.commit === 'string' ? data.commit : null, version: typeof data.version === 'string' ? data.version : null };
  } catch {
    return null;
  }
}

// A source install announces the commit it now runs; a release install announces the version, and only once the app really runs it
// (the marker is left when the update is downloaded, and the install may happen on a later quit).
export function announcement(marker: { commit: string | null; version: string | null } | null, build: BuildInfo): string | null {
  if (!marker) return null;
  if (marker.version) return marker.version === build.version ? marker.version : null;
  return build.commit;
}

export function runInfo(pid: number, build: BuildInfo, startedAt: string): Record<string, string | number> {
  return { pid, version: build.version, commit: build.commit, builtAt: build.builtAt, startedAt };
}

export interface Proc {
  pid: number;
  ppid: number;
  cmd: string;
}

// /proc/<pid>/stat is `pid (comm) state ppid ...` and comm may itself contain spaces and parentheses.
export function parseStat(stat: string): { pid: number; ppid: number } | null {
  const m = /^(\d+) \(.*\) \S (\d+) /s.exec(stat);
  return m ? { pid: Number(m[1]), ppid: Number(m[2]) } : null;
}

// What the app itself started (git fetch, the provider CLI, the card source command, the voice sidecar, the agent binary and whatever they
// spawn), not Chromium's own helpers (zygote, GPU, renderers, utilities: `--type=`). Each of them holds files of the
// AppImage mount open, so one still running keeps the AppImage from unmounting and exiting after the app is gone.
export function ownedDescendants(procs: readonly Proc[], root: number): number[] {
  const kids = new Map<number, Proc[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  const out: number[] = [];
  const walk = (pid: number): void => {
    for (const child of kids.get(pid) ?? []) {
      if (/(^| )--type=/.test(child.cmd)) continue;
      out.push(child.pid);
      walk(child.pid);
    }
  };
  walk(root);
  return out;
}
