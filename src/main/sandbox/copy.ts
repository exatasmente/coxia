import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SandboxError } from './errors';

// The tree an agent that only reads works in: a copy of the worktree without `.git`, so whatever it installs, builds or writes is thrown away with it and the branch is
// never touched by it. It is made off the main thread (a walk that yields, and the system's `cp` in a child), because a worktree can be large and the app must stay
// responsive. Symbolic links stay links and are never followed (`cp -a` keeps them as they are).

/** The size of what a copy would hold, in bytes (files only, without `.git`, never following a link). The walk gives way to the event loop between folders. */
export async function treeSize(from: string, signal?: AbortSignal): Promise<number> {
  let total = 0;
  const stack = [''];
  while (stack.length) {
    if (signal?.aborted) throw new SandboxError('copy-failed');
    const rel = stack.pop() as string;
    for (const entry of await readdir(join(from, rel), { withFileTypes: true })) {
      if (rel === '' && entry.name === '.git') continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(r);
      else if (entry.isFile()) total += (await lstat(join(from, r))).size;
    }
  }
  return total;
}

const run = (args: string[], signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile('cp', args, { env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, signal }, (err) => (err ? reject(err) : resolve()));
  });

/**
 * Copies `from` (without `.git`) into the new folder `to`. Refuses, before copying anything, a tree over `maxBytes`. Any failure comes out as one error that names no
 * path of this computer (the detail goes to the log), and an abort stops the walk and the copy.
 */
export async function copyTree(from: string, to: string, maxBytes: number, signal?: AbortSignal): Promise<void> {
  try {
    if ((await treeSize(from, signal)) > maxBytes) throw new SandboxError('copy-too-big', { mb: String(Math.round(maxBytes / 1024 / 1024)) });
    await mkdir(to, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(from)) {
      if (entry === '.git') continue;
      if (signal?.aborted) throw new SandboxError('copy-failed');
      // `--` ends the options: a file called -rf is a file. A copy that cannot share blocks (reflink) is made again as a plain one.
      await run(['-a', '--reflink=auto', '--', join(from, entry), `${to}/`], signal).catch((e) => {
        if (signal?.aborted) throw e;
        return run(['-a', '--', join(from, entry), `${to}/`], signal);
      });
    }
  } catch (e) {
    if (e instanceof SandboxError) throw e;
    console.error('[sandbox] copy', e instanceof Error ? e.message.split('\n')[0] : e);
    throw new SandboxError('copy-failed');
  }
}
