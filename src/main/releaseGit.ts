import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { t } from '../shared/i18n';
import { type ReleaseUnit, releaseBranchOf, releaseTagOf } from '../shared/release';
import { assertPlainPush, git as rawGit } from './conflictGit';
import { dependencyFolders } from './runner/dependencies';
import { credentialNames } from './engine/guard';
import { loginEnvNow } from './loginPath';
import { SAFE, checkRef } from './runner/git';

// What the release actions do to a repository. Every operation is a mode of the repository's own `scripts/release.sh` (open, beta, stable) or a plain git
// command with refs this file builds from a version: nothing here takes a path, a flag or a command from the unit. The script is the only place that decides
// whether a version may be cut (RELEASING.md), so its rules are not copied here; `--emergency` and `--allow-branch` are never passed, and what the script
// prints (the push commands) is never read: a push is its own operation that builds its refs itself, plain, with no force.
//
// Nothing here touches the person's checkout: the steps run in a worktree of their own, made from the clone for the run. A branch is never checked out twice, so
// the worktree stands on `release/X.Y.Z` for the steps of the release, and on a DETACHED HEAD at what the remote has of main (or local main's commit when there is
// no remote) for `open` and for the stable: `open` runs main's own script (never the one of a release branch that merged pull requests may have changed), the release is
// merged into that commit for the stable, the script (`--worktree`) cuts the stable on it, and `<sha>:refs/heads/main` is what is pushed (the sha resolved first).

export interface ReleaseIdentity {
  name: string;
  email: string;
}

/** What the host says about a pull request, as far as a merge needs it. */
export interface ReleasePr {
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  /** The commit the pull request is at on the host. */
  sha: string;
  approved: boolean;
  /** Who opened it, by their name on the host (a login). */
  author: string;
  /** Somebody asked for changes on it (a review that is not over): then it has a reviewer, and nobody's "sim" stands for one. */
  changesRequested: boolean;
  /** The host's checks: `failing` and `running` stop the merge (a CI nobody could read is `running`), `none` (no checks configured) does not. */
  checks: 'success' | 'failing' | 'running' | 'none';
  /** The branch comes from another repository than the one the pull request is aimed at, or the host did not say it does not: not merged by the app. */
  fork: boolean;
}

export interface ReleaseEnv {
  /** The person's clone, found from the run, never from the unit: only read (refs, tags, remote) and the place the worktree is made from. Its checkout is never touched. */
  clone: string;
  /** The worktree of this release run, where every step runs: a path under the run's own folder, derived from the run, made from `clone` when it is not there. */
  worktree: string;
  identity: ReleaseIdentity;
  /** The host read a merge needs; absent when the workspace has no readable host. */
  pr?: (n: number) => Promise<ReleasePr>;
  /** Replaces the environment the script runs in (tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * The account the app uses on the host, set only when the workspace says the person is the repository's only maintainer AND the step runs on the person's own "sim" (never on
   * an agent's autonomy): that "sim" then stands for the approval of a pull request this account opened and nobody asked changes on. Everything else is checked as ever.
   */
  soleMaintainer?: string;
  /** The head of the pull request the plan the person accepted froze (merge-pr only): the host must still have exactly this commit. */
  planned?: string;
  /** How long the script may take: it runs the checks of CI. */
  scriptTimeoutMs?: number;
}

export interface ReleaseResult {
  /** What was done, for the person and the audit log. */
  output: string;
  /** The commit of the branch the operation moved, before and after (null when it moved none or there was none). */
  before: string | null;
  after: string | null;
  /** The tag a beta or a stable cut made, or the one a push sent. */
  tag: string | null;
  /** A push only: false when the remote already had exactly what it would send, so nothing went out. */
  sent?: boolean;
}

const SCRIPT = 'scripts/release.sh';
const EXIT_GRACE_MS = 250;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const TAIL = 4000;

// The git of this file: in a release worktree it also reads the excludes file made for it (the links to the clone's dependencies must not make the tree dirty).
const excludes = new Map<string, string>();
// Every command of this file runs with the repository's hooks, signing and file-system monitor switched off (a hook or an `fsmonitor` program is the repository's code,
// and `status`, `fetch` and `worktree add` would run them too).
const git: typeof rawGit = (cwd, args, options) => rawGit(cwd, [...SAFE, ...(excludes.has(cwd) ? ['-c', `core.excludesFile=${excludes.get(cwd)}`] : []), ...args], options);

// One step at a time per worktree: a stable moves HEAD to a detached commit, a beta commits on the release branch, a push sends what HEAD is. The approval path and the
// auto path both come through here, so two steps asked at once (two "sim" clicked together) are carried out one after the other, in the order they were asked.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(work, work);
  const tailPromise = next.catch(() => undefined);
  queues.set(key, tailPromise);
  void tailPromise.then(() => {
    if (queues.get(key) === tailPromise) queues.delete(key);
  });
  return next;
}

const tail = (text: string): string => (text.length > TAIL ? `…${text.slice(-TAIL)}` : text);
const ok = async (clone: string, args: string[]): Promise<boolean> => (await git(clone, args, { fail: false })).code === 0;
const out = async (clone: string, args: string[]): Promise<string> => (await git(clone, args)).stdout.trim();
const sha = async (clone: string, ref: string): Promise<string | null> => ((await git(clone, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { fail: false })).stdout.trim() || null);
const exists = (clone: string, ref: string): Promise<boolean> => ok(clone, ['show-ref', '--verify', '--quiet', ref]);
const currentBranch = async (clone: string): Promise<string> => (await git(clone, ['rev-parse', '--abbrev-ref', 'HEAD'], { fail: false })).stdout.trim();

const identityArgs = (id: ReleaseIdentity): string[] => ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`];
const authorOf = (id: ReleaseIdentity): string => `${id.name} <${id.email}>`;

/** Whether two commit names are the same full commit (a 40 or 64 hex digit name each, case does not matter): an abbreviation is never "the same". */
export const sameSha = (a: string, b: string): boolean => FULL_SHA.test(a) && FULL_SHA.test(b) && a.toLowerCase() === b.toLowerCase();

/** Whether `a` is in the history of `b`. */
const isAncestor = (clone: string, a: string, b: string): Promise<boolean> => ok(clone, ['merge-base', '--is-ancestor', a, b]);

/** The highest `vX.Y.Z-beta.N` tag of a version in this clone, or null. */
export async function latestBetaTag(clone: string, version: string): Promise<string | null> {
  const names = (await out(clone, ['tag', '--list', `v${version}-beta.*`])).split('\n').filter((n) => new RegExp(`^v${version.replace(/\./g, '\\.')}-beta\\.[1-9][0-9]*$`).test(n));
  if (!names.length) return null;
  return names.sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop())).at(-1) ?? null;
}

async function assertRepo(clone: string): Promise<void> {
  if (!existsSync(join(clone, '.git')) || (await out(clone, ['rev-parse', '--is-bare-repository'])) !== 'false') throw new Error(t('main.release.notRepo'));
}

const isDir = (p: string): boolean => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The path as git prints it: the folder's parent resolved (a symbolic link in the way), the folder's own name kept (it may be gone). */
function listedPath(p: string): string {
  const abs = resolve(p);
  try {
    return join(realpathSync(dirname(abs)), basename(abs));
  } catch {
    return abs;
  }
}

/** Whether git still lists `path` as a worktree whose folder is gone (prunable). */
async function registeredButGone(clone: string, path: string): Promise<boolean> {
  const target = listedPath(path);
  for (const block of (await out(clone, ['worktree', 'list', '--porcelain'])).split('\n\n')) {
    const lines = block.split('\n');
    const listed = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    if (listed && lines.some((l) => l === 'prunable' || l.startsWith('prunable ')) && listedPath(listed) === target) return true;
  }
  return false;
}

/**
 * The worktree of a release run, made from the clone when it is not there: detached, so it holds no branch. The dependency folders the clone has are linked into it
 * (the checks of a cut need them) and kept out of `git status` by an excludes file in the worktree's own git directory.
 */
async function prepareWorktree(env: ReleaseEnv): Promise<string> {
  const wt = env.worktree;
  if (!existsSync(join(wt, '.git'))) {
    if (existsSync(wt) && readdirSync(wt).length) throw new Error(t('main.release.worktreeBusy', { path: wt }));
    mkdirSync(dirname(wt), { recursive: true });
    await fetchBranch(env.clone, 'main');
    const base = (await mainBase(env.clone)) ?? 'HEAD';
    // A worktree whose folder was deleted is still registered, and git then refuses the path. Only THIS path is taken over (`--force`, and only when git lists it as
    // prunable): a repository-wide `git worktree prune` would also forget the registrations of other worktrees whose folders are gone (a drive that is not mounted).
    const made = await git(env.clone, ['worktree', 'add', '--detach', '--quiet', ...((await registeredButGone(env.clone, wt)) ? ['--force'] : []), wt, base], { fail: false });
    if (made.code !== 0) throw new Error(t('main.release.worktreeFailed', { path: wt, detail: (made.stderr || made.stdout).trim().slice(0, 400) }));
  } else {
    // a folder that is somebody else's checkout is not ours to run in
    const common = async (dir: string): Promise<string> => resolve(dir, (await out(dir, ['rev-parse', '--git-common-dir'])));
    if ((await common(wt)) !== (await common(env.clone))) throw new Error(t('main.release.worktreeBusy', { path: wt }));
  }
  const gitDir = resolve(wt, await out(wt, ['rev-parse', '--git-dir']));
  const folders = dependencyFolders(env.clone);
  for (const rel of folders) {
    const here = join(wt, rel);
    if (existsSync(here) || !isDir(dirname(here))) continue;
    try {
      symlinkSync(join(env.clone, rel), here, 'dir');
    } catch {
      // a folder that cannot be linked is left as the worktree has it
    }
  }
  const file = join(gitDir, 'coxia-exclude');
  writeFileSync(file, `${[...new Set(['/node_modules', '/.venv', ...folders.map((f) => `/${f}`)])].join('\n')}\n`);
  excludes.set(wt, file);
  return wt;
}

/** A branch that another worktree (the person's checkout, say) has checked out cannot be checked out here too: git says so late and badly, this says it first. */
async function checkedOutElsewhere(clone: string, branch: string): Promise<string | null> {
  const listing = (await out(clone, ['worktree', 'list', '--porcelain'])).split('\n\n');
  for (const block of listing) {
    const lines = block.split('\n');
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    if (path && resolve(path) !== resolve(clone) && lines.includes(`branch refs/heads/${branch}`)) return path;
  }
  return null;
}

/** The script refuses a dirty tree and `git switch` could carry a change along: refuse first, with nothing done. */
async function assertClean(clone: string): Promise<void> {
  if ((await git(clone, ['status', '--porcelain'])).stdout.trim()) throw new Error(t('main.release.dirty'));
}

/**
 * Makes sure a local branch exists: a branch that only the remote has (somebody opened the release and pushed it) is made local, tracking it, as `git switch` would.
 * False when neither has it.
 */
async function ensureLocal(clone: string, branch: string): Promise<boolean> {
  checkRef(branch);
  if (await exists(clone, `refs/heads/${branch}`)) return true;
  if (!(await exists(clone, `refs/remotes/origin/${branch}`))) return false;
  await git(clone, ['branch', '--quiet', '--track', branch, `refs/remotes/origin/${branch}`]);
  return true;
}

async function switchTo(clone: string, branch: string): Promise<void> {
  if (!(await ensureLocal(clone, branch))) throw new Error(t('main.release.noBranch', { branch }));
  if ((await currentBranch(clone)) === branch) return;
  const elsewhere = await checkedOutElsewhere(clone, branch);
  if (elsewhere) throw new Error(t('main.release.branchElsewhere', { branch, path: elsewhere }));
  await git(clone, ['switch', '--quiet', branch]);
}

/** Leaves the worktree on a detached HEAD at `ref`: what stands for main, which the person's checkout keeps. */
const detachAt = (clone: string, ref: string): Promise<unknown> => git(clone, ['switch', '--quiet', '--detach', ref]);

/** Reads what the remote has of a branch, when it has it: the script compares with the tracking refs and never fetches. */
async function fetchBranch(clone: string, branch: string): Promise<void> {
  checkRef(branch);
  await git(clone, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { fail: false });
}

// The environment of the script: the person's login PATH (npm, node), no credential-looking variable, and no repository hook for the commit it makes.
function scriptEnv(env: ReleaseEnv): NodeJS.ProcessEnv {
  const base = env.env ?? loginEnvNow();
  const drop = new Set(credentialNames(base));
  const clean = Object.fromEntries(Object.entries(base).filter(([k]) => !drop.has(k)));
  const exclude = excludes.get(env.clone);
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: exclude ? '4' : '3', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false', GIT_CONFIG_KEY_2: 'core.fsmonitor', GIT_CONFIG_VALUE_2: 'false', ...(exclude ? { GIT_CONFIG_KEY_3: 'core.excludesFile', GIT_CONFIG_VALUE_3: exclude } : {}) };
}

/**
 * Runs one mode of the release script of the worktree. The arguments are built here from the operation; the script's own output is returned and never read. It runs as a
 * process group of its own: when it outlives its time, the whole group is killed (the checks it started included), and the worktree is brought back to its commit.
 * The step ends when the script EXITS (plus a short grace for its last words): a grandchild that left the group and still holds the pipes cannot hold the step, or the
 * queue of the worktree, after that.
 */
async function script(env: ReleaseEnv, mode: 'open' | 'beta' | 'stable', extra: string[], version: string): Promise<string> {
  const file = join(env.clone, SCRIPT);
  if (!existsSync(file)) throw new Error(t('main.release.noScript'));
  const limit = env.scriptTimeoutMs ?? 40 * 60_000;
  const startedAt = Date.now();
  const before = await sha(env.clone, 'HEAD');
  const child = spawn(file, [mode, ...extra], { cwd: env.clone, env: scriptEnv(env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  const keep = (b: Buffer): void => {
    text = (text + b.toString('utf8')).slice(-32 * 1024);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, limit);
  const code = await new Promise<number | null>((done) => {
    let settled = false;
    const finish = (c: number | null): void => {
      if (settled) return;
      settled = true;
      // whatever of the script's group is still alive (a background check it started) goes with it; the group may be gone already
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
      child.stdout.destroy();
      child.stderr.destroy();
      done(c);
    };
    child.on('error', () => finish(null));
    child.on('close', (c) => finish(c));
    child.on('exit', (c) => setTimeout(() => finish(c), EXIT_GRACE_MS));
  });
  clearTimeout(timer);
  if (timedOut) {
    await recoverWorktree(env.clone, startedAt, version, before);
    throw new Error(t('main.release.scriptTimedOut', { mode, minutes: Math.max(1, Math.round(limit / 60_000)) }));
  }
  if (code !== 0) throw new Error(t('main.release.scriptFailed', { mode, detail: tail(text.trim() || `exit ${code}`) }));
  return tail(text.trim());
}

/**
 * What a script that was killed may leave in the worktree (it is ours alone): stale locks, a half-made version bump. Locks are removed only when they were made after
 * the step began (an older one is somebody else's, the person's own git perhaps) and only the ones this step's refs could have: the worktree's index and HEAD, the
 * release branch and the tags of the version. Then the tree goes back to the commit the step began at.
 */
async function recoverWorktree(wt: string, since: number, version: string, before: string | null): Promise<void> {
  try {
    const dirOf = async (flag: string): Promise<string> => resolve(wt, (await git(wt, ['rev-parse', flag], { fail: false })).stdout.trim());
    const gitDir = await dirOf('--git-dir');
    const common = await dirOf('--git-common-dir');
    const stale = (file: string): void => {
      try {
        if (statSync(file).mtimeMs >= since - 1000) rmSync(file, { force: true });
      } catch {
        // not there
      }
    };
    stale(join(gitDir, 'index.lock'));
    stale(join(gitDir, 'HEAD.lock'));
    stale(join(common, 'refs', 'heads', `${releaseBranchOf(version)}.lock`));
    const tags = join(common, 'refs', 'tags');
    // exactly this version's tags: `v1.2.3.lock` and `v1.2.3-beta.N.lock` (a lock of `v1.2.34` is not ours)
    const mine = new RegExp(`^${releaseTagOf(version).replace(/\./g, '\\.')}(?:-beta\\.[1-9][0-9]*)?\\.lock$`);
    if (existsSync(tags)) for (const name of readdirSync(tags)) if (mine.test(name)) stale(join(tags, name));
    // back to the commit the step began at (a commit the killed script made on the way is dropped), not just to wherever HEAD is now; a tag it made is left for the next step to see
    await git(wt, ['reset', '--hard', '--quiet', before ?? 'HEAD'], { fail: false });
    await git(wt, ['clean', '-fdq'], { fail: false });
  } catch {
    // the next step will say what is wrong with the tree
  }
}

// What the person's git config could add to a push: the tags `push.followTags` takes along, the submodules `push.recurseSubmodules` pushes, a signed push, and a
// mirror of the remote. The refspec of a push is explicit, so `remote.origin.push` and `push.default` do not apply, but these do unless they are switched off.
const PUSH_SAFE = ['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', '-c', 'push.gpgSign=false', '-c', 'remote.origin.mirror=false'];

/** The object the remote names at `ref`, null when it has no such ref, undefined when it could not be read (the push then speaks for itself). */
async function remoteObject(clone: string, ref: string): Promise<string | null | undefined> {
  const r = await git(clone, ['ls-remote', 'origin', ref], { fail: false });
  if (r.code !== 0) return undefined;
  const line = r.stdout.split('\n').map((l) => l.split('\t')).find(([, name]) => name?.trim() === ref);
  return line ? line[0].trim().toLowerCase() : null;
}

/**
 * A plain push of one ref: nothing is forced, and no other ref goes with it. `src` is a commit name or a tag ref, never a symbolic name such as HEAD (what it names could move).
 * When the remote already has exactly that object at `dst`, nothing is pushed and `sent` is false: git would call it a success ("Everything up-to-date"), and a release that
 * moved nothing on the host must not read as one that did.
 */
async function pushRef(clone: string, src: string, dst: string): Promise<{ output: string; sent: boolean }> {
  const local = (await out(clone, ['rev-parse', '--verify', '--quiet', src])).toLowerCase();
  if (local && (await remoteObject(clone, dst)) === local) return { output: '', sent: false };
  const spec = `${src}:${dst}`;
  const args = ['push', '--no-verify', 'origin', spec];
  assertPlainPush(args);
  const r = await git(clone, [...PUSH_SAFE, ...args]);
  return { output: `${r.stdout}${r.stderr}`.trim(), sent: true };
}

async function merge(clone: string, id: ReleaseIdentity, args: string[]): Promise<void> {
  const r = await git(clone, [...identityArgs(id), 'merge', ...args], { fail: false });
  if (r.code !== 0) {
    await git(clone, ['merge', '--abort'], { fail: false });
    throw new Error((r.stderr || r.stdout).trim().slice(0, 600));
  }
}

/**
 * What stands for main in the worktree: the remote's main, or local main's commit ONLY when the repository has no `origin` at all. A repository that has an origin whose main
 * could not be read has no known main: the person's local main may be anything (ahead, or not what was reviewed), so it is refused instead of used.
 */
async function mainBase(clone: string): Promise<string | null> {
  if (await exists(clone, 'refs/remotes/origin/main')) return 'refs/remotes/origin/main';
  if (await ok(clone, ['remote', 'get-url', 'origin'])) return null;
  return (await exists(clone, 'refs/heads/main')) ? 'refs/heads/main' : null;
}

async function open(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const branch = releaseBranchOf(unit.version);
  checkRef(branch);
  await assertClean(env.clone);
  await fetchBranch(env.clone, 'main');
  await fetchBranch(env.clone, branch);
  // Refused BEFORE anything runs: `open` runs the script of the commit the worktree stands on, and once a pull request was merged into the release branch that script may be
  // the pull request's. A branch that exists is not opened again (the script would refuse it, but only after having run).
  if ((await exists(env.clone, `refs/heads/${branch}`)) || (await exists(env.clone, `refs/remotes/origin/${branch}`))) throw new Error(t('main.release.branchExists', { branch }));
  // And `open` runs main's own script: the worktree is put on what stands for main first, as the stable does, so that no script of a release branch ever runs without a "sim".
  const base = await mainBase(env.clone);
  if (!base) throw new Error(t('main.release.noBranch', { branch: 'main' }));
  await detachAt(env.clone, base);
  const before = await sha(env.clone, 'HEAD');
  const output = await script(env, 'open', [unit.version, ...(unit.from ? ['--from', unit.from] : []), '--author', authorOf(env.identity), '--worktree'], unit.version);
  return { output, before, after: await sha(env.clone, 'HEAD'), tag: null };
}

/** Host names compare without case (GitHub, GitLab and Bitbucket treat them so); an empty one is nobody's. */
const sameLogin = (a: string, b: string): boolean => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The only maintainer's "sim" stands for the review: the pull request is theirs and nobody asked for changes on it. */
const selfReviewed = (mr: ReleasePr, me: string | undefined): boolean => !!me && !mr.changesRequested && sameLogin(mr.author, me);

async function mergePr(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const pr = unit.pr as number;
  const branch = releaseBranchOf(unit.version);
  if (!env.pr) throw new Error(t('main.release.noHost'));
  await assertClean(env.clone);
  await fetchBranch(env.clone, branch);
  if (!(await ensureLocal(env.clone, branch))) throw new Error(t('main.release.noBranch', { branch }));
  // What the host says now: the pull request must be open, approved (or the only maintainer's own, on their "sim"), green, aimed at this release branch and still where the
  // plan read it.
  const mr = await env.pr(pr);
  if (mr.state !== 'open') throw new Error(t('main.release.prNotOpen', { pr, state: mr.state }));
  if (mr.targetBranch !== branch) throw new Error(t('main.release.prBase', { pr, base: mr.targetBranch, branch }));
  if (mr.fork) throw new Error(t('main.release.prFork', { pr }));
  if (mr.draft) throw new Error(t('main.release.prDraft', { pr }));
  if (!mr.approved && !selfReviewed(mr, env.soleMaintainer)) {
    throw new Error(env.soleMaintainer && !mr.changesRequested ? t('main.release.prNotApprovedSole', { pr, author: mr.author }) : t('main.release.prNotApproved', { pr }));
  }
  if (mr.checks === 'failing' || mr.checks === 'running') throw new Error(t('main.release.prChecks', { pr, status: mr.checks }));
  // The head the plan the person accepted froze, when the caller knows it (the app always does), and the head the unit names: both are the host's head now, as full names.
  for (const wanted of [env.planned, unit.head]) {
    if (wanted !== undefined && !sameSha(mr.sha, wanted)) throw new Error(t('main.release.prMoved', { pr, now: mr.sha.slice(0, 9), was: wanted.slice(0, 9) }));
  }
  const source = checkRef(mr.sourceBranch);

  await switchTo(env.clone, branch);
  const before = await sha(env.clone, 'HEAD');
  // A read of the pull request's branch: what comes in is the commit the host said, not whatever the branch is by the time it is fetched.
  await git(env.clone, ['fetch', '--quiet', 'origin', `refs/heads/${source}`]);
  const fetched = await out(env.clone, ['rev-parse', 'FETCH_HEAD']);
  if (!sameSha(fetched, mr.sha)) throw new Error(t('main.release.prMoved', { pr, now: fetched.slice(0, 9), was: mr.sha.slice(0, 9) }));
  if (await isAncestor(env.clone, fetched, 'HEAD')) return { output: t('main.release.alreadyIn', { pr, branch }), before, after: before, tag: null };
  try {
    // i18n-ignore-next-line: the subject of a merge commit, as the repository's history has it (RELEASING.md)
    await merge(env.clone, env.identity, ['--no-ff', '--no-edit', '-m', `Merge pull request #${pr} from ${source}`, fetched]);
  } catch (e) {
    throw new Error(t('main.release.mergeConflict', { pr, branch, detail: (e as Error).message }));
  }
  const after = await sha(env.clone, 'HEAD');
  return { output: t('main.release.merged', { pr, branch, sha: (after ?? '').slice(0, 9) }), before, after, tag: null };
}

async function beta(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const branch = releaseBranchOf(unit.version);
  await assertClean(env.clone);
  await switchTo(env.clone, branch);
  await fetchBranch(env.clone, branch);
  const before = await sha(env.clone, 'HEAD');
  const output = await script(env, 'beta', ['--author', authorOf(env.identity)], unit.version);
  return { output, before, after: await sha(env.clone, 'HEAD'), tag: await latestBetaTag(env.clone, unit.version) };
}

async function stable(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const branch = releaseBranchOf(unit.version);
  await assertClean(env.clone);
  await fetchBranch(env.clone, 'main');
  await fetchBranch(env.clone, branch);
  await ensureLocal(env.clone, branch);
  // What stands for main is a commit, not the branch (the person's checkout has it): the remote's main, or local main's commit when there is no remote.
  const base = await mainBase(env.clone);
  if (!base) throw new Error(t('main.release.noBranch', { branch: 'main' }));
  await detachAt(env.clone, base);
  const before = await sha(env.clone, 'HEAD');
  // The release branch goes into it (a fast-forward when main has not moved, a merge commit with the configured identity otherwise); a branch deleted earlier is not an error.
  if ((await exists(env.clone, `refs/heads/${branch}`)) && !(await isAncestor(env.clone, branch, 'HEAD'))) {
    const ff = await git(env.clone, ['merge', '--ff-only', '--quiet', branch], { fail: false });
    if (ff.code !== 0) {
      try {
        // i18n-ignore-next-line: the subject of a merge commit, as the repository's history has it (RELEASING.md)
        await merge(env.clone, env.identity, ['--no-ff', '--no-edit', '-m', `Merge ${branch}`, branch]);
      } catch (e) {
        throw new Error(t('main.release.mergeReleaseConflict', { branch, detail: (e as Error).message }));
      }
    }
  }
  const output = await script(env, 'stable', ['--author', authorOf(env.identity), '--worktree'], unit.version);
  return { output, before, after: await sha(env.clone, 'HEAD'), tag: releaseTagOf(unit.version) };
}

async function pushBranchOp(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  await assertClean(env.clone);
  if (unit.branch === 'main') {
    // main goes out only after the stable of this version was cut: the tag is the proof, and the commit it names is what is sent (HEAD is detached there, never a branch).
    const tag = releaseTagOf(unit.version);
    if (!(await exists(env.clone, `refs/tags/${tag}`))) throw new Error(t('main.release.mainNotCut', { tag }));
    // The tag must be the script's: an annotated one, whose commit is on top of what the remote has of main (a lightweight tag of any commit would send that commit as main).
    if ((await out(env.clone, ['cat-file', '-t', `refs/tags/${tag}`])) !== 'tag') throw new Error(t('main.release.tagNotAnnotated', { tag }));
    await fetchBranch(env.clone, 'main');
    if ((await exists(env.clone, 'refs/remotes/origin/main')) && !(await isAncestor(env.clone, 'refs/remotes/origin/main', `refs/tags/${tag}^{commit}`))) throw new Error(t('main.release.tagNotOnMain', { tag }));
    await detachAt(env.clone, `refs/tags/${tag}`);
    const head = (await sha(env.clone, 'HEAD')) as string;
    return { ...pushed(await pushRef(env.clone, head, 'refs/heads/main'), 'main', head), before: head, after: head, tag: null };
  }
  const branch = releaseBranchOf(unit.version);
  await switchTo(env.clone, branch);
  const head = (await sha(env.clone, 'HEAD')) as string;
  return { ...pushed(await pushRef(env.clone, head, `refs/heads/${branch}`), branch, head), before: head, after: head, tag: null };
}

/** What a push says: git's own words when it sent something, "nothing sent" with the commit the remote already has when it did not. */
const pushed = (r: { output: string; sent: boolean }, ref: string, commit: string): { output: string; sent: boolean } =>
  r.sent ? { output: r.output || t('main.release.pushed', { ref }), sent: true } : { output: t('main.release.nothingSent', { ref, sha: commit.slice(0, 9) }), sent: false };

async function pushTagOp(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const stableTag = releaseTagOf(unit.version);
  const tag = unit.channel === 'stable' ? stableTag : await latestBetaTag(env.clone, unit.version);
  if (!tag || !(await exists(env.clone, `refs/tags/${tag}`))) throw new Error(t('main.release.noTag', { tag: tag ?? `${stableTag}-beta.N` }));
  checkRef(tag);
  // An annotated tag, made by the script: a lightweight one is somebody's bookmark, not a release.
  if ((await out(env.clone, ['cat-file', '-t', `refs/tags/${tag}`])) !== 'tag') throw new Error(t('main.release.tagNotAnnotated', { tag }));
  // The branch goes first: the workflow refuses a tag whose commit is not on the branch it belongs to on the remote.
  const branch = unit.channel === 'stable' ? 'main' : releaseBranchOf(unit.version);
  const tracking = `refs/remotes/origin/${branch}`;
  if (!(await exists(env.clone, tracking)) || !(await isAncestor(env.clone, `refs/tags/${tag}`, tracking))) throw new Error(t('main.release.tagBranchFirst', { tag, branch }));
  const commit = (await sha(env.clone, `refs/tags/${tag}`)) as string;
  return { ...pushed(await pushRef(env.clone, `refs/tags/${tag}`, `refs/tags/${tag}`), tag, commit), before: commit, after: commit, tag };
}

/** Runs one release operation in the worktree of the run. Throws the reason (translated) when it is refused or fails; what ran is in the returned output. */
export function runReleaseOp(unit: ReleaseUnit, given: ReleaseEnv): Promise<ReleaseResult> {
  // One step at a time per worktree, in the order they were asked.
  return serialized(resolve(given.worktree), async () => {
    await assertRepo(given.clone);
    // Every step runs in the worktree of the run; the person's checkout is only the place it is made from.
    return dispatch(unit, { ...given, clone: await prepareWorktree(given) });
  });
}

function dispatch(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  switch (unit.op) {
    case 'open':
      return open(unit, env);
    case 'merge-pr':
      return mergePr(unit, env);
    case 'beta':
      return beta(unit, env);
    case 'stable':
      return stable(unit, env);
    case 'push-branch':
      return pushBranchOp(unit, env);
    case 'push-tag':
      return pushTagOp(unit, env);
  }
}

/** The line a person reads for what an operation will run, with the refs it will use: the same text the audit log keeps as its target. Not a command that is executed. */
export function releaseCommandLine(unit: ReleaseUnit): string {
  // i18n-ignore-start: commands as they run
  switch (unit.op) {
    case 'open':
      return `scripts/release.sh open ${unit.version}${unit.from ? ` --from ${unit.from}` : ''} --worktree`;
    case 'merge-pr':
      return `git merge --no-ff <head of pull request #${unit.pr}> (into ${releaseBranchOf(unit.version)})`;
    case 'beta':
      return `scripts/release.sh beta (on ${releaseBranchOf(unit.version)})`;
    case 'stable':
      return `git merge ${releaseBranchOf(unit.version)} (into a detached origin/main), scripts/release.sh stable --worktree`;
    case 'push-branch':
      return `git push origin <sha>:refs/heads/${unit.branch === 'main' ? 'main' : releaseBranchOf(unit.version)}`;
    case 'push-tag':
      return unit.channel === 'stable' ? `git push origin refs/tags/${releaseTagOf(unit.version)}` : `git push origin refs/tags/v${unit.version}-beta.<latest>`;
  }
  // i18n-ignore-end
}

// What a person is shown before saying "yes" to a push: the commits that would go. Read only.
export async function previewRelease(unit: ReleaseUnit, clone: string): Promise<string> {
  const lines = [releaseCommandLine(unit)];
  try {
    if (unit.op === 'push-branch' && unit.branch === 'main') {
      // What goes is the commit the stable tag names (the person's own main is not it), over what the remote has.
      const tag = releaseTagOf(unit.version);
      if (!(await exists(clone, `refs/tags/${tag}`))) {
        lines.push(t('main.release.mainNotCut', { tag }));
      } else {
        const base = (await exists(clone, 'refs/remotes/origin/main')) ? 'refs/remotes/origin/main..' : '';
        lines.push((await out(clone, ['log', '--oneline', '-n', '30', `${base}refs/tags/${tag}^{commit}`])) || t('main.release.nothingNew'));
      }
    } else if (unit.op === 'push-branch') {
      const branch = releaseBranchOf(unit.version);
      const base = (await exists(clone, `refs/remotes/origin/${branch}`)) ? `refs/remotes/origin/${branch}..` : '';
      lines.push((await out(clone, ['log', '--oneline', '-n', '30', `${base}refs/heads/${branch}`])) || t('main.release.nothingNew'));
    } else if (unit.op === 'push-tag') {
      const tag = unit.channel === 'stable' ? releaseTagOf(unit.version) : await latestBetaTag(clone, unit.version);
      lines.push(tag ? t('main.release.previewTag', { tag, sha: ((await sha(clone, `refs/tags/${tag}`)) ?? '').slice(0, 9) }) : t('main.release.noTag', { tag: `v${unit.version}-beta.N` }));
    }
  } catch (e) {
    lines.push((e as Error).message.split('\n')[0]);
  }
  return lines.join('\n\n');
}
