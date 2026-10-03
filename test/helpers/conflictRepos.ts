import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const IDENTITY = {
  GIT_AUTHOR_NAME: 'Fixture Dev',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture Dev',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** The identity the machine would hand git by itself: a global config and the author and committer variables. No commit of the app may carry it. */
export const MACHINE = { name: 'Machine Person', email: 'machine@example.com' };

/** Runs `fn` with `MACHINE` in a global git config and in the environment, as a person's computer would have it, and puts the environment back. */
export async function withMachineIdentity<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-gitconfig-'));
  const file = join(dir, 'gitconfig');
  writeFileSync(file, `[user]\n\tname = ${MACHINE.name}\n\temail = ${MACHINE.email}\n`);
  const saved = { ...process.env };
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: file,
    GIT_AUTHOR_NAME: MACHINE.name,
    GIT_AUTHOR_EMAIL: MACHINE.email,
    GIT_COMMITTER_NAME: MACHINE.name,
    GIT_COMMITTER_EMAIL: MACHINE.email,
    EMAIL: MACHINE.email,
  });
  try {
    return await fn();
  } finally {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...IDENTITY }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const BASE_APP = ['// handlers', 'const a = 1;', '// -- register --', 'register("base");', '// -- end --', 'module.exports = {};', ''].join('\n');

export interface Fixture {
  root: string;
  origin: string;
  seed: string;
  clone: string;
  project: string;
  branch: string;
  cloneRoots: string[];
}

// A bare "origin" and a clone. The branch and main both add a line in the same spot of app.js (complementary conflict),
// and main deletes old.txt, which the branch edited (a conflict without markers).
export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'cerimonias-conflict-'));
  const project = 'grp/proj';
  const origin = join(root, 'remote', `${project}.git`);
  const seed = join(root, 'seed');
  const clone = join(root, 'clones', 'proj');
  const branch = 'release/bugfix/1234';
  mkdirSync(origin, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore', env: { ...process.env, ...IDENTITY } });
  execFileSync('git', ['clone', origin, seed], { stdio: 'ignore', env: { ...process.env, ...IDENTITY } });
  git(seed, 'checkout', '-b', 'main');
  writeFileSync(join(seed, 'app.js'), BASE_APP);
  writeFileSync(join(seed, 'old.txt'), 'old content\n');
  writeFileSync(join(seed, 'README.md'), 'Title\n=======\nbody\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'push', '-q', 'origin', 'main');

  git(seed, 'checkout', '-q', '-b', branch);
  writeFileSync(join(seed, 'app.js'), BASE_APP.replace('register("base");', 'register("base");\nregister("from-branch");'));
  writeFileSync(join(seed, 'old.txt'), 'old content\nbranch edit\n');
  git(seed, 'commit', '-q', '-am', 'branch work');
  git(seed, 'push', '-q', 'origin', branch);

  git(seed, 'checkout', '-q', 'main');
  writeFileSync(join(seed, 'app.js'), BASE_APP.replace('register("base");', 'register("base");\nregister("from-main");'));
  git(seed, 'rm', '-q', 'old.txt');
  git(seed, 'commit', '-q', '-am', 'release work');
  git(seed, 'push', '-q', 'origin', 'main');

  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore', env: { ...process.env, ...IDENTITY } });
  // The user's clone has uncommitted work that the app must never touch.
  writeFileSync(join(clone, 'my-notes.txt'), 'untracked work\n');
  return { root, origin, seed, clone, project, branch, cloneRoots: [join(root, 'clones')] };
}

export const originSha = (f: Fixture, ref: string): string => git(f.origin, 'rev-parse', `refs/heads/${ref}`);

// What must stay identical in the user's clone through the whole flow.
export function cloneSnapshot(f: Fixture): { head: string; branch: string; status: string; index: string; config: string; notes: string } {
  return {
    head: git(f.clone, 'rev-parse', 'HEAD'),
    branch: git(f.clone, 'rev-parse', '--abbrev-ref', 'HEAD'),
    status: git(f.clone, 'status', '--porcelain'),
    index: git(f.clone, 'ls-files', '--stage'),
    config: readFileSync(join(f.clone, '.git', 'config'), 'utf8'),
    notes: readFileSync(join(f.clone, 'my-notes.txt'), 'utf8'),
  };
}
