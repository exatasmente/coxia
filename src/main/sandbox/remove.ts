import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Taking away what a sandbox made. A command may have left folders it made read-only (a Go module cache, anything installed with `chmod -R a-w`), and a plain recursive
// removal stops at the first one. The walk makes each folder writable again, never following a link, and the removal is best effort: it never throws, because it runs
// when a stage has already finished and must not turn that into a failure.

function walk(dir: string, depth = 0): void {
  if (depth > 64) return;
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Not ours to change; the removal below says so.
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) walk(join(dir, name), depth + 1);
}

/** Removes `path` and everything under it, links as links, folders made read-only included. Returns whether it is gone. */
export function removeTree(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    // Something in it is not writable: make the folders writable and try once more.
  }
  walk(path);
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.error('[sandbox] could not remove a stage folder', e instanceof Error ? e.message.split('\n')[0] : e);
    return false;
  }
}
