import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The suite makes thousands of temporary folders per run (data dirs, bare remotes, clones, worktrees) and the tests do not remove them: a busy machine filled
// its disk with them. Every run gets one root, set as the temporary directory before the workers start so their tmpdir() and the git they spawn land in it,
// and the root goes away when the run ends.
const PREFIX = 'coxia-vitest-';
// A root nothing was created in for this long belongs to a run killed before its teardown; a live run keeps touching its root.
const STALE_MS = 6 * 60 * 60 * 1000;

function sweep(base: string): void {
  const now = Date.now();
  for (const name of readdirSync(base)) {
    if (!name.startsWith(PREFIX)) continue;
    const at = join(base, name);
    try {
      if (now - statSync(at).mtimeMs > STALE_MS) rmSync(at, { recursive: true, force: true });
    } catch {
      // Another run removed it first, or it is not ours to remove.
    }
  }
}

export default function setup(): () => void {
  const base = tmpdir();
  sweep(base);
  const root = mkdtempSync(join(base, PREFIX));
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = root;
  return () => rmSync(root, { recursive: true, force: true });
}
