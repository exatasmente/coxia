import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ID } from '../../shared/config/schema';
import { removeTree } from '../sandbox/remove';

// The logged-in browser of an agent: one profile folder per agent, `<workspace>/browser/<agent id>/`, made by the app with mode 0700 and read by nothing but the browser
// the app launches on it. It is the same kind of thing as `secrets.json`: never in a worktree, never in what a model reads (see `isInsideProfiles`, which the engines'
// read guard asks), never exported, never in a retention group. Electron-free: every folder comes in as an argument.

export const BROWSER_DIR = 'browser';

const AGENT_ID = new RegExp(ID);
// What Chromium leaves in a profile to say that a browser has it: a dead process leaves them behind and the next start would take the profile for busy.
const SINGLETON = /^Singleton(?:Lock|Socket|Cookie)$/;

export type ProfileFailure = 'id' | 'link' | 'owner' | 'inside' | 'create';

/** A profile that cannot be made safe to start a browser on. The code says why; whoever shows it to a person puts it in words. */
export class ProfileError extends Error {
  constructor(readonly code: ProfileFailure) {
    super(code);
    this.name = 'ProfileError';
  }
}

/** The folder that holds every profile of a workspace. */
export const browserRoot = (workspaceDir: string): string => join(workspaceDir, BROWSER_DIR);

/** The profile folder of an agent, as written (not checked). Throws `ProfileError('id')` for an id that is not a plain agent id: the id is a folder name. */
export function profileDirOf(workspaceDir: string, agentId: string): string {
  if (!AGENT_ID.test(agentId)) throw new ProfileError('id');
  return join(browserRoot(workspaceDir), agentId);
}

const real = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

// The forms a folder of the profiles can be named by: as written and with the workspace folder's links resolved. Cached: the read guard asks for every file of a search.
const rootsCache = new Map<string, string[]>();
function rootsOf(workspaceDir: string): string[] {
  const hit = rootsCache.get(workspaceDir);
  if (hit) return hit;
  const forms = [browserRoot(workspaceDir)];
  const ws = real(workspaceDir);
  if (ws) forms.push(browserRoot(ws));
  const roots = [...new Set(forms)];
  // A workspace folder that is not there yet is not cached: it may be made, behind a link, later.
  if (ws) rootsCache.set(workspaceDir, roots);
  return roots;
}

/** Whether `path` is the folder of the profiles or anything under it, by the name it is given or by where it really leads. */
export function isInsideProfiles(workspaceDir: string, path: string): boolean {
  const roots = rootsOf(workspaceDir);
  const inside = (p: string): boolean => roots.some((r) => p === r || p.startsWith(r + sep));
  if (inside(path)) return true;
  const resolved = real(path);
  return resolved !== null && inside(resolved);
}

/** The deny rules (`Read(//absolute/path/**)` in the SDK's syntax) that keep a search with no path out of the profiles, one per name the folder has. */
export const profileDenyGlobs = (workspaceDir: string): string[] => rootsOf(workspaceDir).map((r) => `/${r}/**`);

function ensureFolder(path: string): void {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch {
      throw new ProfileError('create');
    }
    st = lstatSync(path);
  }
  // A link would carry the profile (and the cookies in it) wherever it leads.
  if (st.isSymbolicLink() || !st.isDirectory()) throw new ProfileError('link');
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new ProfileError('owner');
  // The mode asked of mkdir is cut by the umask but never widened; a folder made by an earlier version, or by hand, is tightened.
  if ((st.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

export interface EnsureOptions {
  /** Folders the profile must never be in: the worktrees, the projects' roots. Compared by real path. */
  avoid?: string[];
}

/**
 * The profile folder of an agent, made when it is not there: 0700, owned by the app's user, its real path the very path it is given (no link on the way) and not
 * inside any folder in `avoid`. Returns that real path, which is what the browser is started on. Throws `ProfileError`.
 */
export function ensureProfile(workspaceDir: string, agentId: string, options: EnsureOptions = {}): string {
  if (!AGENT_ID.test(agentId)) throw new ProfileError('id');
  const ws = real(workspaceDir);
  if (!ws) throw new ProfileError('create');
  const root = browserRoot(ws);
  ensureFolder(root);
  const dir = join(root, agentId);
  ensureFolder(dir);
  if (real(dir) !== dir) throw new ProfileError('link');
  for (const a of options.avoid ?? []) {
    const forbidden = real(a) ?? a;
    if (dir === forbidden || dir.startsWith(forbidden + sep)) throw new ProfileError('inside');
  }
  return dir;
}

/** Takes away the marks a browser that died left, so the next one does not find the profile taken. Only under the lock: no browser is on the profile. */
export function clearSingletons(dir: string): number {
  let removed = 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!SINGLETON.test(name)) continue;
    try {
      // The lock is a link to a name that no longer exists: it is taken off as a link, never followed.
      unlinkSync(join(dir, name));
      removed++;
    } catch {
      // Gone already, or not ours: the browser says so when it starts.
    }
  }
  return removed;
}

// ---- one session at a time ---------------------------------------------------------------------------------------------------------------------

export interface ProfileLock {
  release(): void;
}

export type Acquired = { ok: true; lock: ProfileLock } | { ok: false; owner: string };

export interface ProfileLocks {
  /** Takes the profile folder for `owner` (a screen key), or says who holds it. */
  acquire(dir: string, owner: string): Acquired;
  /** Who holds the profile now, or null. */
  holder(dir: string): string | null;
  /** Told when any profile is let go, with its folder. Returns the way to stop being told. */
  onRelease(fn: (dir: string) => void): () => void;
}

/**
 * The lock of the profiles: in memory, so a crash or a quit lets every one go with the process, and a lock file can never outlive the app. A browser locks its own profile
 * by a file in it, and a stale one is taken off at the next start (`clearSingletons`).
 */
export function createProfileLocks(): ProfileLocks {
  const held = new Map<string, string>();
  const listeners = new Set<(dir: string) => void>();
  return {
    acquire(dir, owner) {
      const current = held.get(dir);
      if (current !== undefined) return { ok: false, owner: current };
      held.set(dir, owner);
      let released = false;
      return {
        ok: true,
        lock: {
          release() {
            if (released) return;
            released = true;
            held.delete(dir);
            for (const fn of [...listeners]) {
              try {
                fn(dir);
              } catch {
                // Whoever listens must not keep a profile locked.
              }
            }
          },
        },
      };
    },
    holder: (dir) => held.get(dir) ?? null,
    onRelease(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const profileLocks: ProfileLocks = createProfileLocks();

export type OpenedProfile = { ok: true; dir: string; release: () => void } | { ok: false; busy: true; owner: string };

/**
 * Takes the logged-in profile of an agent for a screen: the lock first, then the folder (made and checked), then the marks of a dead browser taken off. `busy` says
 * another screen of the agent has it, and the caller goes on with a fresh profile of its own. Throws `ProfileError` with the lock let go.
 */
export function openProfile(workspaceDir: string, agentId: string, owner: string, options: EnsureOptions & { locks?: ProfileLocks } = {}): OpenedProfile {
  const locks = options.locks ?? profileLocks;
  const written = profileDirOf(workspaceDir, agentId);
  const got = locks.acquire(written, owner);
  if (!got.ok) return { ok: false, busy: true, owner: got.owner };
  try {
    const dir = ensureProfile(workspaceDir, agentId, options);
    clearSingletons(dir);
    return { ok: true, dir, release: () => got.lock.release() };
  } catch (e) {
    got.lock.release();
    throw e;
  }
}

// ---- when the agent goes away -----------------------------------------------------------------------------------------------------------------

/**
 * Deletes what is in the folder of the profiles and belongs to no agent in `keep`: the profile of an agent that was removed while the app was off, or by a file that was
 * put in its place. A profile held by a screen is left (the agent is removed while its screen is closing); `onRelease` is the moment to sweep again. Returns the names
 * removed and the names left because they are held.
 */
export function sweepProfiles(workspaceDir: string, keep: Iterable<string>, locks: ProfileLocks = profileLocks): { removed: string[]; held: string[] } {
  const wanted = new Set(keep);
  const root = browserRoot(workspaceDir);
  const out = { removed: [] as string[], held: [] as string[] };
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(root, name);
    if (wanted.has(name)) {
      let st;
      try {
        st = lstatSync(path);
      } catch {
        continue;
      }
      // An agent's profile that is not a plain folder (a link, a file) is not a profile: it goes, and a real one is made at the next use.
      if (st.isDirectory() && !st.isSymbolicLink()) continue;
    }
    if (locks.holder(path) !== null) {
      out.held.push(name);
      continue;
    }
    if (removeTree(path)) out.removed.push(name);
  }
  return out;
}

/** Deletes the profile of one agent, whatever it holds (Revoke all, an agent removed). `held` says a screen had it: the caller closes that screen first. */
export function deleteProfile(workspaceDir: string, agentId: string, locks: ProfileLocks = profileLocks): { removed: boolean; held: boolean } {
  if (!AGENT_ID.test(agentId)) return { removed: false, held: false };
  const dir = profileDirOf(workspaceDir, agentId);
  const held = locks.holder(dir) !== null;
  return { removed: removeTree(dir), held };
}

/** Deletes every profile of the workspace, for a workspace that is going to the trash: cookies must never sit where nothing purges. Returns whether the folder is gone. */
export const deleteAllProfiles = (workspaceDir: string): boolean => removeTree(browserRoot(workspaceDir));
