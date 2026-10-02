import { join } from 'node:path';
import type { BuildInfo, LatestCommit } from '../shared/update';

export { buildState, stripDirty } from '../shared/update';

// scripts/update.sh starts the installed binary with this flag: the running instance receives it as a
// second-instance argv and quits cleanly; the process that sent it exits at once.
export const QUIT_FLAG = '--quit-for-update';

export function wantsQuitForUpdate(argv: readonly string[]): boolean {
  return argv.includes(QUIT_FLAG);
}

export function readBuild(version: string, commit?: string, builtAt?: string): BuildInfo {
  return { version, commit: commit || 'dev', builtAt: builtAt || '' };
}

// `git log -1 --format=%h%x1f%cI%x1f%s`
export function parseLatest(out: string): Omit<LatestCommit, 'behind'> | null {
  const [commit, date, ...subject] = out.trim().split('\x1f');
  if (!commit || !/^[0-9a-f]{4,40}$/.test(commit) || !date) return null;
  return { commit, date, subject: subject.join('\x1f') };
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

// update.sh leaves this after installing; the next start announces it once.
export function parseUpdatedMarker(text: string): { commit: string | null } | null {
  try {
    const data = JSON.parse(text) as { commit?: unknown };
    return { commit: typeof data.commit === 'string' ? data.commit : null };
  } catch {
    return null;
  }
}

export function runInfo(pid: number, build: BuildInfo, startedAt: string): Record<string, string | number> {
  return { pid, version: build.version, commit: build.commit, builtAt: build.builtAt, startedAt };
}
