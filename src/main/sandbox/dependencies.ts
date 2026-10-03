import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { dependencyFolders } from '../runner/dependencies';

// The runner links the dependency folders of the clone (node_modules, .venv) into each worktree, so the commands find their tools. A sandbox does not see the clone, so
// a link would dangle there. The folders such a link points to are shared **read-only at the same absolute path**, and only when their real path is inside the run's clone
// (and not inside the worktree): a link someone made to point anywhere else is left dangling and said, and the agent installs its own dependencies. A reader's copy keeps
// the links as links, so the same share serves it.

export interface DependencyBinds {
  binds: [string, string][];
  /** The dependency folders (relative to the worktree) whose link does not lead into the clone. */
  outside: string[];
}

export function dependencyBinds(tree: string, worktree: string, clone: string): DependencyBinds {
  const binds: [string, string][] = [];
  const outside: string[] = [];
  let realClone: string;
  let realWorktree: string;
  try {
    realClone = realpathSync(clone);
    realWorktree = realpathSync(worktree);
  } catch {
    return { binds, outside };
  }
  for (const rel of dependencyFolders(clone)) {
    const entry = join(tree, rel);
    let link: string;
    try {
      if (!lstatSync(entry).isSymbolicLink()) continue;
      link = readlinkSync(entry);
    } catch {
      continue;
    }
    let real: string;
    try {
      real = realpathSync(entry);
      if (!statSync(real).isDirectory()) throw new Error('not a folder');
    } catch {
      outside.push(rel);
      continue;
    }
    const inClone = real.startsWith(`${realClone}/`) && real !== realClone;
    const inWorktree = real === realWorktree || real.startsWith(`${realWorktree}/`);
    if (!inClone || inWorktree) {
      outside.push(rel);
      continue;
    }
    // The link's own text is what the sandbox will follow, so that is where the folder is shown.
    binds.push([real, resolve(dirname(entry), link)]);
  }
  return { binds, outside };
}
