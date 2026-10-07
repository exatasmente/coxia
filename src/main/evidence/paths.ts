import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkPath } from '../engine/guard';
import { OUT } from '../sandbox/policy';

// The output folder of a stage as a path on this computer. Inside the sandbox it is `/coxia/out` (the constant of the sandbox policy); on the host it is the `out`
// folder of the stage folder the app made, and the two must never be confused. A path a model writes is the one it sees inside (`/coxia/out/...`), and this module
// turns it into a path under the real folder, refusing anything that leaves it: an absolute path elsewhere, a `..` and any component that is a link.

export const OUTPUT_PROBLEMS = ['path', 'traversal', 'outside', 'link', 'missing', 'not-file'] as const;
export type OutputProblem = (typeof OUTPUT_PROBLEMS)[number];

export interface ResolvedOutput {
  ok: boolean;
  problem?: OutputProblem;
  /** The real path under the stage's output folder, only when `ok`. */
  path?: string;
  /** The path relative to the output folder, with forward slashes, for a message. */
  rel?: string;
}

/** The output folder of a stage on this computer. */
export const outputDirOf = (stageDir: string): string => join(stageDir, 'out');

/** Whether any component of `rel` under `root` is a symbolic link (the file itself included). */
function hasLink(root: string, rel: string): boolean {
  let current = root;
  for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      // A component that does not exist yet cannot be a link; the guard reports the rest.
      return false;
    }
  }
  return false;
}

/**
 * Turns the path a model wrote into a file of the stage's output folder. The path may be given as the sandbox sees it (`/coxia/out/...`) or relative to the folder;
 * anything that is not inside it, walks with `..` or passes through a symbolic link is refused with the problem, and never followed.
 */
export function resolveOutputPath(stageDir: string, input: unknown): ResolvedOutput {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) return { ok: false, problem: 'path' };
  const raw = input.trim();
  const root = outputDirOf(stageDir);
  // The path of the sandbox maps to the real folder; a path of the host, absolute, is refused unless it is already under the real folder.
  let candidate = raw;
  if (raw === OUT) candidate = '';
  else if (raw.startsWith(`${OUT}/`)) candidate = raw.slice(OUT.length + 1);
  if (candidate.startsWith('/') || candidate.startsWith('~')) {
    // An absolute path is only accepted when it is the real folder itself (never a path outside it).
    if (!candidate.startsWith(`${root}/`) && candidate !== root) return { ok: false, problem: 'outside' };
    candidate = candidate.slice(root.length + 1);
  }
  if (candidate.split(/[\\/]+/).includes('..')) return { ok: false, problem: 'traversal' };
  // A link on the way (a component of the path, or the file itself) is the thing this refuses most often, so it is looked for first and said as such: a link the
  // sandbox left behind is a way to hang anything of the person's on the evidence.
  // A link on the way (a component of the path, or the file itself) is the thing this refuses most often, so it is looked for first and said as such: a link the
  // sandbox left behind is a way to hang anything of the person's on the evidence.
  if (hasLink(root, candidate)) return { ok: false, problem: 'link' };
  const check = checkPath(root, candidate, { read: true });
  if (!check.ok) return { ok: false, problem: check.code === 'traversal' ? 'traversal' : check.code === 'dangling' ? 'link' : 'outside' };
  if (!existsSync(check.path)) return { ok: false, problem: 'missing' };
  // The check resolves the closest existing ancestor's links, but the file itself may be a link the sandbox put there: it is refused, never followed.
  try {
    if (lstatSync(check.path).isSymbolicLink()) return { ok: false, problem: 'link' };
    if (!statSync(check.path).isFile()) return { ok: false, problem: 'not-file' };
  } catch {
    return { ok: false, problem: 'missing' };
  }
  // The written path may walk through no link and still end up outside the folder: the clone's dependency links (`node_modules`, `.venv`) sit inside the
  // output folder on the host, and the sandbox mounts that folder as it is, so a common file behind such a link would otherwise pass. The real path of the
  // file and of the folder are compared, and a file that lands anywhere but under the folder is refused as one that passes through a link.
  if (!stillInside(root, check.path)) return { ok: false, problem: 'link' };
  return { ok: true, path: check.path, rel: check.rel.split('\\').join('/') };
}

/** Whether the real path of a file is still under the real path of the output folder (a link of a dependency would take it out). */
function stillInside(root: string, path: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(path);
    if (real === realRoot) return false;
    const rel = relative(realRoot, real);
    return !!rel && !rel.startsWith('..') && !rel.includes(`..${sep}`);
  } catch {
    return false;
  }
}
