import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { t } from '../shared/i18n';
import { type ReleaseUnit, releaseBranchOf, releaseTagOf } from '../shared/release';
import { assertPlainPush, git } from './conflictGit';
import { credentialNames } from './engine/guard';
import { loginEnvNow } from './loginPath';
import { SAFE, checkRef } from './runner/git';

// What the release actions do to a repository. Every operation is a mode of the repository's own `scripts/release.sh` (open, beta, stable) or a plain git
// command with refs this file builds from a version: nothing here takes a path, a flag or a command from the unit. The script is the only place that decides
// whether a version may be cut (RELEASING.md), so its rules are not copied here; `--emergency` and `--allow-branch` are never passed, and what the script
// prints (the push commands) is never read: a push is its own operation that builds its refs itself, plain, with no force.

const run = promisify(execFile);

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
  /** The host's checks: `failing` and `running` stop the merge, `none` (no checks configured) does not. */
  checks: 'success' | 'failing' | 'running' | 'none';
}

export interface ReleaseEnv {
  /** The clone the release is cut in: the repository's own checkout, found from the run, never from the unit. */
  clone: string;
  identity: ReleaseIdentity;
  /** The host read a merge needs; absent when the workspace has no readable host. */
  pr?: (n: number) => Promise<ReleasePr>;
  /** Replaces the environment the script runs in (tests). */
  env?: NodeJS.ProcessEnv;
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
}

const SCRIPT = 'scripts/release.sh';
const TAIL = 4000;

const tail = (text: string): string => (text.length > TAIL ? `…${text.slice(-TAIL)}` : text);
const ok = async (clone: string, args: string[]): Promise<boolean> => (await git(clone, args, { fail: false })).code === 0;
const out = async (clone: string, args: string[]): Promise<string> => (await git(clone, args)).stdout.trim();
const sha = async (clone: string, ref: string): Promise<string | null> => ((await git(clone, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { fail: false })).stdout.trim() || null);
const exists = (clone: string, ref: string): Promise<boolean> => ok(clone, ['show-ref', '--verify', '--quiet', ref]);
const currentBranch = async (clone: string): Promise<string> => (await git(clone, ['rev-parse', '--abbrev-ref', 'HEAD'], { fail: false })).stdout.trim();

const identityArgs = (id: ReleaseIdentity): string[] => ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`];
const authorOf = (id: ReleaseIdentity): string => `${id.name} <${id.email}>`;

/** Whether `a` is in the history of `b`. */
const sameSha = (a: string, b: string): boolean => a.length >= 7 && b.length >= 7 && (a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase()));

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
  await git(clone, [...SAFE, 'branch', '--quiet', '--track', branch, `refs/remotes/origin/${branch}`]);
  return true;
}

async function switchTo(clone: string, branch: string): Promise<void> {
  if (!(await ensureLocal(clone, branch))) throw new Error(t('main.release.noBranch', { branch }));
  if ((await currentBranch(clone)) === branch) return;
  await git(clone, [...SAFE, 'switch', '--quiet', branch]);
}

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
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false' };
}

/** Runs one mode of the release script of the clone. The arguments are built here from the operation; the script's own output is returned and never read. */
async function script(env: ReleaseEnv, mode: 'open' | 'beta' | 'stable', extra: string[]): Promise<string> {
  const file = join(env.clone, SCRIPT);
  if (!existsSync(file)) throw new Error(t('main.release.noScript'));
  try {
    const { stdout, stderr } = await run(file, [mode, ...extra], { cwd: env.clone, env: scriptEnv(env), timeout: env.scriptTimeoutMs ?? 40 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    return tail(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim());
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(t('main.release.scriptFailed', { mode, detail: tail(`${err.stderr ?? ''}\n${err.stdout ?? ''}`.trim() || err.message) }));
  }
}

/** A plain push of one ref: nothing is forced, and no other ref goes with it. */
async function pushRef(clone: string, src: string, dst: string): Promise<string> {
  const spec = `${src}:${dst}`;
  const args = ['push', '--no-verify', 'origin', spec];
  assertPlainPush(args);
  const r = await git(clone, args);
  return `${r.stdout}${r.stderr}`.trim();
}

async function merge(clone: string, id: ReleaseIdentity, args: string[]): Promise<void> {
  const r = await git(clone, [...SAFE, ...identityArgs(id), 'merge', ...args], { fail: false });
  if (r.code !== 0) {
    await git(clone, ['merge', '--abort'], { fail: false });
    throw new Error((r.stderr || r.stdout).trim().slice(0, 600));
  }
}

async function open(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  await assertClean(env.clone);
  await fetchBranch(env.clone, 'main');
  const before = await sha(env.clone, 'HEAD');
  const output = await script(env, 'open', [unit.version, ...(unit.from ? ['--from', unit.from] : []), '--author', authorOf(env.identity)]);
  return { output, before, after: await sha(env.clone, 'HEAD'), tag: null };
}

async function mergePr(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const pr = unit.pr as number;
  const branch = releaseBranchOf(unit.version);
  if (!env.pr) throw new Error(t('main.release.noHost'));
  await assertClean(env.clone);
  await fetchBranch(env.clone, branch);
  if (!(await ensureLocal(env.clone, branch))) throw new Error(t('main.release.noBranch', { branch }));
  // What the host says now: the pull request must be open, approved, green, aimed at this release branch and still where the plan read it.
  const mr = await env.pr(pr);
  if (mr.state !== 'open') throw new Error(t('main.release.prNotOpen', { pr, state: mr.state }));
  if (mr.targetBranch !== branch) throw new Error(t('main.release.prBase', { pr, base: mr.targetBranch, branch }));
  if (mr.draft) throw new Error(t('main.release.prDraft', { pr }));
  if (!mr.approved) throw new Error(t('main.release.prNotApproved', { pr }));
  if (mr.checks === 'failing' || mr.checks === 'running') throw new Error(t('main.release.prChecks', { pr, status: mr.checks }));
  if (unit.head && !sameSha(mr.sha, unit.head)) throw new Error(t('main.release.prMoved', { pr, now: mr.sha.slice(0, 9), was: unit.head.slice(0, 9) }));
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
  const output = await script(env, 'beta', ['--author', authorOf(env.identity)]);
  return { output, before, after: await sha(env.clone, 'HEAD'), tag: await latestBetaTag(env.clone, unit.version) };
}

async function stable(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const branch = releaseBranchOf(unit.version);
  await assertClean(env.clone);
  if (!(await exists(env.clone, 'refs/heads/main'))) throw new Error(t('main.release.noBranch', { branch: 'main' }));
  await switchTo(env.clone, 'main');
  await fetchBranch(env.clone, 'main');
  await fetchBranch(env.clone, branch);
  await ensureLocal(env.clone, branch);
  const before = await sha(env.clone, 'HEAD');
  // main must not be behind the remote (the script says so as well): a fast-forward, or nothing.
  if (await exists(env.clone, 'refs/remotes/origin/main')) {
    const r = await git(env.clone, [...SAFE, 'merge', '--ff-only', '--quiet', 'refs/remotes/origin/main'], { fail: false });
    if (r.code !== 0) throw new Error(t('main.release.mainDiverged'));
  }
  // The release branch goes into main (a fast-forward when main has not moved, a merge commit with the configured identity otherwise); a branch deleted earlier is not an error.
  if (await exists(env.clone, `refs/heads/${branch}`) && !(await isAncestor(env.clone, branch, 'HEAD'))) {
    const ff = await git(env.clone, [...SAFE, 'merge', '--ff-only', '--quiet', branch], { fail: false });
    if (ff.code !== 0) {
      try {
        // i18n-ignore-next-line: the subject of a merge commit, as the repository's history has it (RELEASING.md)
        await merge(env.clone, env.identity, ['--no-ff', '--no-edit', '-m', `Merge ${branch}`, branch]);
      } catch (e) {
        throw new Error(t('main.release.mergeReleaseConflict', { branch, detail: (e as Error).message }));
      }
    }
  }
  const output = await script(env, 'stable', ['--author', authorOf(env.identity)]);
  return { output, before, after: await sha(env.clone, 'HEAD'), tag: releaseTagOf(unit.version) };
}

async function pushBranchOp(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  const branch = unit.branch === 'main' ? 'main' : releaseBranchOf(unit.version);
  await assertClean(env.clone);
  // main goes out only after the stable of this version was cut on it: the tag is the proof.
  if (branch === 'main') {
    const tag = releaseTagOf(unit.version);
    if (!(await exists(env.clone, `refs/tags/${tag}`)) || !(await isAncestor(env.clone, `refs/tags/${tag}`, 'main'))) throw new Error(t('main.release.mainNotCut', { tag }));
  }
  await switchTo(env.clone, branch);
  const head = await sha(env.clone, 'HEAD');
  const output = await pushRef(env.clone, 'HEAD', `refs/heads/${branch}`);
  return { output: output || t('main.release.pushed', { ref: branch }), before: head, after: head, tag: null };
}

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
  const commit = await sha(env.clone, `refs/tags/${tag}`);
  const output = await pushRef(env.clone, `refs/tags/${tag}`, `refs/tags/${tag}`);
  return { output: output || t('main.release.pushed', { ref: tag }), before: commit, after: commit, tag };
}

/** Runs one release operation in the clone. Throws the reason (translated) when it is refused or fails; what ran is in the returned output. */
export async function runReleaseOp(unit: ReleaseUnit, env: ReleaseEnv): Promise<ReleaseResult> {
  await assertRepo(env.clone);
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
      return `scripts/release.sh open ${unit.version}${unit.from ? ` --from ${unit.from}` : ''}`;
    case 'merge-pr':
      return `git merge --no-ff <head of pull request #${unit.pr}> (into ${releaseBranchOf(unit.version)})`;
    case 'beta':
      return `scripts/release.sh beta (on ${releaseBranchOf(unit.version)})`;
    case 'stable':
      return `git merge ${releaseBranchOf(unit.version)} (into main), scripts/release.sh stable`;
    case 'push-branch':
      return `git push origin HEAD:refs/heads/${unit.branch === 'main' ? 'main' : releaseBranchOf(unit.version)}`;
    case 'push-tag':
      return unit.channel === 'stable' ? `git push origin refs/tags/${releaseTagOf(unit.version)}` : `git push origin refs/tags/v${unit.version}-beta.<latest>`;
  }
  // i18n-ignore-end
}

// What a person is shown before saying "yes" to a push: the commits that would go. Read only.
export async function previewRelease(unit: ReleaseUnit, clone: string): Promise<string> {
  const lines = [releaseCommandLine(unit)];
  try {
    if (unit.op === 'push-branch') {
      const branch = unit.branch === 'main' ? 'main' : releaseBranchOf(unit.version);
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
