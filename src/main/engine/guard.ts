// The one place that decides whether an agent that writes may touch a path. The Claude SDK's PreToolUse hook and the open engine's
// Write and Edit tools both call it, so the two engines cannot disagree. Electron-free: the root comes in as an argument.
//
// What it refuses, for a write: a path that leaves the worktree (absolute, `..`, `~`, a symbolic link on the way, a dangling one),
// anything inside `.git` (config, hooks, refs), the files that make git or a package manager run code on its own (`.husky`, `.githooks`,
// `.gitattributes`, `.gitmodules`) and secret files. For a read it refuses the first three kinds: `.git/config` can carry a token in a remote URL.
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const DENIAL_CODES = ['no-path', 'traversal', 'outside', 'dangling', 'git', 'hooks', 'reserved', 'secret'] as const;
export type DenialCode = (typeof DENIAL_CODES)[number];

export type PathCheck = { ok: true; /** The path to use: parent resolved through real directories, inside the root. */ path: string; /** Relative to the real root. */ rel: string } | { ok: false; code: DenialCode };

export interface CheckOptions {
  /** True for a path that is only read: the rules about hooks and git attributes do not apply. */
  read?: boolean;
  /** The secret-file rule of the app (`secretPath` in agents.ts), asked with the resolved path. */
  isSecret?: (path: string) => boolean;
  /**
   * The folder `root` must really sit in, for a root narrower than the worktree (a documentation run's `.coxia/`): `root` has to be a real folder, not a link, whose real
   * place is inside the real `fence`. A narrow root that is a link would carry every write to wherever the link leads.
   */
  fence?: string;
  /** Names directly under `root` the app keeps for itself: a write to one (or under it) is refused, whatever the case it is spelled in. */
  reserved?: readonly string[];
  home?: string;
}

const GIT_DIR = '.git';
const HOOK_DIRS = new Set(['.husky', '.githooks']);
const GIT_FILES = new Set(['.gitattributes', '.gitmodules']);

function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Whether `folder` is a real folder (not a symbolic link) whose real place is inside the real `fence`. */
export function realFolderIn(folder: string, fence: string): boolean {
  try {
    if (!lstatSync(folder).isDirectory()) return false;
  } catch {
    return false;
  }
  const inner = real(folder);
  const outer = real(fence);
  return inner !== null && outer !== null && inner.startsWith(outer + sep);
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The real location a write to `abs` would land on: the closest existing ancestor with its symbolic links resolved, plus the names that do not
 * exist yet. A link that points nowhere cannot be resolved, so a write through it is refused rather than guessed.
 */
function landing(abs: string): string | 'dangling' {
  let probe = abs;
  const rest: string[] = [];
  while (!exists(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    rest.unshift(basename(probe));
    probe = parent;
  }
  const resolved = real(probe);
  if (resolved === null) return 'dangling';
  return join(resolved, ...rest);
}

function segmentsCode(segments: string[], read: boolean): DenialCode | null {
  const lower = segments.map((s) => s.toLowerCase());
  if (lower.includes(GIT_DIR)) return 'git';
  if (read) return null;
  if (lower.some((s) => HOOK_DIRS.has(s))) return 'hooks';
  if (GIT_FILES.has(lower[lower.length - 1] ?? '')) return 'git';
  return null;
}

/**
 * Whether a file tool may use `input` as a path under `root`. `root` is the run's worktree: it must exist. The answer is the path to use
 * (never the raw input), so a link created between the check and the write is the only thing left to race, and the tools open with O_NOFOLLOW.
 */
export function checkPath(root: string, input: unknown, options: CheckOptions = {}): PathCheck {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || input.length > 4096) return { ok: false, code: 'no-path' };
  const raw = input.trim();
  if (options.fence && !realFolderIn(root, options.fence)) return { ok: false, code: 'outside' };
  // A `..` is refused wherever it stands: after a link it would climb out of the link's target, not out of the folder it was written in.
  if (raw.split(/[\\/]+/).includes('..')) return { ok: false, code: 'traversal' };
  const home = options.home ?? homedir();
  const expanded = raw === '~' || raw.startsWith('~/') ? home + raw.slice(1) : raw;
  const base = real(root);
  if (base === null) return { ok: false, code: 'outside' };
  const abs = resolve(base, expanded);
  const place = landing(abs);
  if (place === 'dangling') return { ok: false, code: 'dangling' };
  // The root itself is somewhere to look (a search starts there), never something to write.
  if (place === base && options.read) return { ok: true, path: place, rel: '' };
  if (place === base || !place.startsWith(base + sep)) return { ok: false, code: 'outside' };
  const rel = relative(base, place);
  // The names as written count too: a link called notes that leads to .git is caught by `place`, and one named .git by the lexical path.
  const written = relative(base, abs).split(sep);
  const code = segmentsCode(rel.split(sep), !!options.read) ?? segmentsCode(written, !!options.read);
  if (code) return { ok: false, code };
  if (options.reserved?.length && !options.read) {
    const own = new Set(options.reserved.map((n) => n.toLowerCase()));
    if (own.has((rel.split(sep)[0] ?? '').toLowerCase()) || own.has((written[0] ?? '').toLowerCase())) return { ok: false, code: 'reserved' };
  }
  if (options.isSecret && (options.isSecret(place) || options.isSecret(abs))) return { ok: false, code: 'secret' };
  return { ok: true, path: place, rel };
}

/**
 * A relative path as the file tools resolve it: against the working directory. The guard of a folder below the working directory (`Confinement.writeRoot`) would
 * resolve it against that folder instead, and `src/a.ts` would pass for `<folder>/src/a.ts` while the tool wrote it at the working directory. Absolute, `~` and
 * `..` paths are left to `checkPath` as they are.
 */
export function anchored(cwd: string, input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const raw = input.trim();
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || raw.split(/[\\/]+/).includes('..')) return input;
  return join(cwd, raw);
}

/** The write tools of the Claude SDK and of the open engine, and the field each one carries its path in. */
export const WRITE_TOOLS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

/** The path a write tool call names, or undefined. */
export function writeTarget(tool: string, input: unknown): unknown {
  const field = WRITE_TOOLS[tool];
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return field ? args[field] : undefined;
}

// A name that looks like it holds a secret is dropped from the environment of the commands a writing agent runs: they are the repository's own
// scripts, and nothing they need to run tests is a credential of the person's.
const SECRET_NAME = /token|secret|password|passwd|credential|api[_-]?key|private[_-]?key|auth|^ssh_|^aws_|^gh_|^github_|^gitlab_|^anthropic_|^openai_|^openrouter_|^npm_config_/i;

export function scrubbedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !SECRET_NAME.test(key)) out[key] = value;
  out.GIT_TERMINAL_PROMPT = '0';
  return out;
}

/**
 * The names `scrubbedEnv` would drop from `env`, for an engine that cannot clean the environment of the commands it runs (the Claude SDK's process
 * needs the provider's key) and removes them from each command instead. Only plain variable names: one is later put on a command line.
 */
export function credentialNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((k) => env[k] !== undefined && SECRET_NAME.test(k) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .sort();
}
