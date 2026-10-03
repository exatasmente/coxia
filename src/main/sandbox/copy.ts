import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { SandboxError } from './errors';

// The tree an agent that only reads works in: a copy of the worktree without `.git`, so whatever it installs, builds or writes is thrown away with it and the branch is
// never touched by it. Symbolic links stay links and are never followed; anything that is not a file, a folder or a link is left out.

function* walk(dir: string, rel = ''): Generator<{ rel: string; kind: 'dir' | 'file' | 'link' }> {
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (rel === '' && entry.name === '.git') continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield { rel: r, kind: 'dir' };
      yield* walk(dir, r);
    } else if (entry.isSymbolicLink()) yield { rel: r, kind: 'link' };
    else if (entry.isFile()) yield { rel: r, kind: 'file' };
  }
}

/** The size of what a copy would hold, in bytes. */
export function treeSize(from: string): number {
  let total = 0;
  for (const e of walk(from)) if (e.kind === 'file') total += lstatSync(join(from, e.rel)).size;
  return total;
}

/** Copies `from` (without `.git`) into the new folder `to`. Refuses, before copying anything, a tree over `maxBytes`. */
export function copyTree(from: string, to: string, maxBytes: number): void {
  if (treeSize(from) > maxBytes) throw new SandboxError('copy-too-big', { mb: String(Math.round(maxBytes / 1024 / 1024)) });
  mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const e of walk(from)) {
    const src = join(from, e.rel);
    const dest = join(to, e.rel);
    if (e.kind === 'dir') mkdirSync(dest, { recursive: true });
    else if (e.kind === 'link') symlinkSync(readlinkSync(src), dest);
    else copyFileSync(src, dest, constants.COPYFILE_FICLONE);
  }
}
