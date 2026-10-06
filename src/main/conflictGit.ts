import { execFile, spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ConflictFile, ConflictHunk } from '../shared/conflict';
import { hunkReady, hunkText } from '../shared/conflict';
import { hasMarkers, parseConflicts, regions, resolveSegments, withTerminator } from './conflictHunks';
import { t } from '../shared/i18n';
import { loginEnvNow } from './loginPath';

const run = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

const ENV = { GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', GIT_EDITOR: 'true' };
// What the app's environment could say about who commits. The app names its identity on the command line of each commit (`identityArgs`), and
// an author or committer inherited from the shell that started it, which git would put above that, never reaches a git command.
const INHERITED_IDENTITY = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...ENV };
  for (const key of INHERITED_IDENTITY) delete env[key];
  return env;
}

const REF = /^[\w][\w./-]*$/;

function checkRef(ref: string, what: string): string {
  if (!REF.test(ref) || ref.includes('..') || ref.endsWith('.lock') || ref.endsWith('/') || ref.includes('//')) throw new Error(t('main.conflictGit.invalidRef', { what, ref }));
  return ref;
}

export async function git(cwd: string, args: string[], options: { fail?: boolean; timeout?: number } = {}): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run('git', ['-C', cwd, ...args], { env: gitEnv(), timeout: options.timeout ?? 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; message: string };
    const result = { stdout: err.stdout ?? '', stderr: err.stderr ?? err.message, code: typeof err.code === 'number' ? err.code : 1 };
    if (options.fail === false) return result;
    throw new Error(`git ${args.slice(0, 3).join(' ')}: ${(result.stderr || result.stdout).trim().slice(0, 600)}`);
  }
}

export const conflictsDir = (dataDir: string): string => join(dataDir, 'conflicts');

// A remote URL names the project when its path ends with "<group>/<project>" (host checked when the URL has one).
export function remoteMatches(url: string, projectPath: string, host: string): boolean {
  let u = url.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(u);
  if (scp) u = `ssh://${scp[1]}/${scp[2]}`;
  let path = u;
  let remote = false;
  if (/^[a-z+]+:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      if (parsed.hostname !== host) return false;
      path = parsed.pathname;
      remote = true;
    } catch {
      return false;
    }
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\//, '');
  // A local path (a clone of a clone, a fixture) only has to end with the project.
  return path === projectPath || (!remote && path.endsWith(`/${projectPath}`));
}

// Local clone for the MR's project: a regular checkout (not a worktree) whose origin is that project.
export async function findClone(projectPath: string, roots: string[], host: string): Promise<string | null> {
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const dir = join(root, name);
      try {
        if (!statSync(join(dir, '.git')).isDirectory()) continue;
      } catch {
        continue;
      }
      const r = await git(dir, ['remote', 'get-url', 'origin'], { fail: false });
      if (r.code === 0 && remoteMatches(r.stdout, projectPath, host)) found.push(dir);
    }
  }
  const leaf = basename(projectPath);
  return found.find((d) => basename(d) === leaf) ?? found[0] ?? null;
}

function insideDir(dir: string, file: string): string {
  const abs = resolve(dir, file);
  if (!abs.startsWith(resolve(dir) + sep)) throw new Error(t('main.conflictGit.outside', { file }));
  return abs;
}

function emptyHunk(file: string, index: number): ConflictHunk {
  return {
    id: `${file}#${index}`,
    file,
    whole: false,
    ours: '',
    oursGone: false,
    base: null,
    theirs: '',
    theirsGone: false,
    sensitive: false,
    proposal: null,
    explanation: null,
    confidence: null,
    test: null,
    choice: null,
    edited: null,
  };
}

const isBinary = (buf: Buffer): boolean => buf.subarray(0, 8000).includes(0);

async function stage(wt: string, n: 1 | 2 | 3, path: string): Promise<string | null> {
  const r = await run('git', ['-C', wt, 'show', `:${n}:${path}`], { env: gitEnv(), maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }).catch(() => null);
  if (!r) return null;
  if (isBinary(r.stdout)) throw new Error(t('main.conflictGit.binary', { path }));
  return r.stdout.toString('utf8');
}

export async function unmergedPaths(wt: string): Promise<string[]> {
  const r = await git(wt, ['diff', '--name-only', '--diff-filter=U', '-z']);
  return r.stdout.split('\0').filter(Boolean);
}

export async function readConflicts(wt: string): Promise<ConflictFile[]> {
  const files: ConflictFile[] = [];
  for (const path of await unmergedPaths(wt)) {
    const abs = insideDir(wt, path);
    const buf = existsSync(abs) ? readFileSync(abs) : null;
    if (buf && isBinary(buf)) throw new Error(t('main.conflictGit.binary', { path }));
    const found = buf ? regions(parseConflicts(buf.toString('utf8'))) : [];
    if (found.length) {
      files.push({
        path,
        hunks: found.map((r, i) => ({ ...emptyHunk(path, i), ours: r.ours, base: r.base, theirs: r.theirs })),
      });
      continue;
    }
    const ours = await stage(wt, 2, path);
    const theirs = await stage(wt, 3, path);
    if (ours === null && theirs === null) throw new Error(t('main.conflictGit.oneSided', { path }));
    files.push({
      path,
      hunks: [{ ...emptyHunk(path, 0), whole: true, ours: ours ?? '', oursGone: ours === null, base: await stage(wt, 1, path), theirs: theirs ?? '', theirsGone: theirs === null }],
    });
  }
  return files;
}

/** Who a commit of the app is made as. */
export interface Identity {
  name: string;
  email: string;
}

/**
 * The options that make one git command commit as `identity`, both author and committer. They are the only identity a commit of the app has: nothing is
 * written to a git config, and what the global configuration or the environment says is never used (an empty half is refused, never filled in by git).
 */
export function identityArgs(identity: Identity): string[] {
  const name = identity.name.trim();
  const email = identity.email.trim();
  // i18n-ignore-next-line: developer error: the callers resolve the identity and refuse a run without one first
  if (!name || !email) throw new Error('a commit needs both a name and an email');
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'user.useConfigOnly=true'];
}

export interface Prepared {
  worktree: string;
  syncBranch: string;
  originSha: string;
  mainSha: string;
  files: ConflictFile[];
}

// The merge is started as `identity` too: git wants to know who would commit it even when it stops before the commit.
export async function prepareWorktree(p: { clone: string; branch: string; target: string; iid: number; dest: string; identity: Identity }): Promise<Prepared> {
  const as = identityArgs(p.identity);
  const branch = checkRef(p.branch, t('main.conflictGit.branch'));
  const target = checkRef(p.target, t('main.conflictGit.targetBranch'));
  const syncBranch = `sync/${Number(p.iid)}`;
  if (!Number.isInteger(p.iid) || p.iid <= 0) throw new Error(t('main.conflictGit.badIid', { iid: p.iid }));
  const top = await git(p.clone, ['rev-parse', '--is-bare-repository']);
  if (top.stdout.trim() !== 'false') throw new Error(t('main.conflictGit.noWorkTree', { clone: p.clone }));
  if (existsSync(p.dest)) throw new Error(t('main.conflictGit.destExists', { dest: p.dest }));
  if ((await git(p.clone, ['show-ref', '--verify', '--quiet', `refs/heads/${syncBranch}`], { fail: false })).code === 0) {
    throw new Error(t('main.conflictGit.foreignBranch', { branch: syncBranch }));
  }

  await git(p.clone, ['fetch', 'origin', `+refs/heads/${target}:refs/remotes/origin/${target}`, `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  const originSha = (await git(p.clone, ['rev-parse', `refs/remotes/origin/${branch}`])).stdout.trim();
  const mainSha = (await git(p.clone, ['rev-parse', `refs/remotes/origin/${target}`])).stdout.trim();

  mkdirSync(dirname(p.dest), { recursive: true });
  await git(p.clone, ['worktree', 'add', '--no-track', '-B', syncBranch, p.dest, `refs/remotes/origin/${branch}`]);
  try {
    await git(p.dest, [...as, '-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', `refs/remotes/origin/${target}`], { fail: false });
    const merging = (await git(p.dest, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { fail: false })).code === 0;
    if (!merging) throw new Error(t('main.conflictGit.mergeNotStarted', { target, branch }));
    const files = await readConflicts(p.dest);
    snapshotMarkers(p.dest, files);
    return { worktree: p.dest, syncBranch, originSha, mainSha, files };
  } catch (e) {
    await removeWorktree(p.clone, p.dest, syncBranch, conflictsDirOf(p.dest)).catch(() => undefined);
    throw e;
  }
}

const conflictsDirOf = (wt: string): string => dirname(wt);

// The marked files exactly as the merge left them: reopening restores these, so the hunks match the ones the user decided.
const markersDirOf = (wt: string): string => `${resolve(wt)}.markers`;

function snapshotMarkers(wt: string, files: ConflictFile[]): void {
  const dir = markersDirOf(wt);
  for (const f of files.filter((x) => !x.hunks[0]?.whole)) {
    const to = insideDir(dir, f.path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(insideDir(wt, f.path), to);
  }
}

export interface Resolution {
  path: string;
  // null removes the file (a whole-file conflict resolved by taking the side that deleted it).
  content: string | null;
}

// Everything is decided in memory first: nothing is written while any hunk is unchosen, changed or carries markers.
export function buildResolutions(wt: string, files: ConflictFile[]): Resolution[] {
  const out: Resolution[] = [];
  for (const f of files) {
    const open = f.hunks.filter((h) => !hunkReady(h));
    if (open.length) throw new Error(t('main.conflictGit.undecided', { path: f.path, count: open.length }));
    if (f.hunks[0]?.whole) {
      const text = hunkText(f.hunks[0]);
      if (text !== null && hasMarkers(text)) throw new Error(t('main.conflictGit.chosenMarkers', { path: f.path }));
      out.push({ path: f.path, content: text });
      continue;
    }
    const segments = parseConflicts(readFileSync(insideDir(wt, f.path), 'utf8'));
    if (regions(segments).length !== f.hunks.length) throw new Error(t('main.conflictGit.changedSince', { path: f.path }));
    const like = f.hunks[0].ours + f.hunks[0].theirs;
    const content = resolveSegments(segments, (i) => withTerminator(hunkText(f.hunks[i]) ?? '', like));
    if (hasMarkers(content)) throw new Error(t('main.conflictGit.leftMarkers', { path: f.path }));
    out.push({ path: f.path, content });
  }
  return out;
}

export async function applyResolutions(wt: string, files: ConflictFile[]): Promise<string[]> {
  const resolutions = buildResolutions(wt, files);
  for (const r of resolutions) {
    if (r.content === null) {
      await git(wt, ['rm', '-q', '-f', '--', r.path]);
    } else {
      writeFileSync(insideDir(wt, r.path), r.content);
      await git(wt, ['add', '--', r.path]);
    }
  }
  const left = await unmergedPaths(wt);
  if (left.length) throw new Error(t('main.conflictGit.unresolvedList', { files: left.join(', ') }));
  for (const r of resolutions) {
    if (r.content !== null && hasMarkers(readFileSync(insideDir(wt, r.path), 'utf8'))) throw new Error(t('main.conflictGit.leftMarker', { path: r.path }));
  }
  return resolutions.map((r) => r.path);
}

// Puts the conflicts back from the index (resolve-undo), so the hunks can be reviewed again. Files with markers get
// them back in the working tree; a whole-file conflict only needs its index stages (checkout -m cannot rebuild a deleted side).
export async function reopenResolutions(wt: string, files: ConflictFile[]): Promise<void> {
  const marked = files.filter((f) => !f.hunks[0]?.whole).map((f) => f.path);
  const whole = files.filter((f) => f.hunks[0]?.whole).map((f) => f.path);
  if (marked.length) {
    // checkout -m puts the conflict back in the index; its file merge may split hunks differently from the original merge,
    // so the content comes from the snapshot taken when preparing (older preparations have none and keep checkout's text).
    await git(wt, ['-c', 'merge.conflictStyle=diff3', 'checkout', '-m', '--', ...marked]);
    const dir = markersDirOf(wt);
    for (const path of marked) {
      const saved = insideDir(dir, path);
      if (existsSync(saved)) copyFileSync(saved, insideDir(wt, path));
    }
  }
  if (whole.length) await git(wt, ['update-index', '--unresolve', '--', ...whole]);
  const left = await unmergedPaths(wt);
  if (left.length !== files.length) throw new Error(t('main.conflictGit.cannotReopen'));
}

export interface Verification {
  exitCode: number;
  tail: string;
}

const TAIL = 6000;
const VERIFY_TIMEOUT_MS = 30 * 60_000;

// The configured command runs in a login shell inside the worktree; the full output goes to `logFile`.
export function runVerify(p: { wt: string; clone: string; command: string; logFile: string; timeoutMs?: number }): Promise<Verification> {
  mkdirSync(dirname(p.logFile), { recursive: true });
  const log = createWriteStream(p.logFile);
  return new Promise((done, fail) => {
    let tail = '';
    const child = spawn('bash', ['-lc', p.command], { cwd: p.wt, env: { ...loginEnvNow(), CLONE_DIR: p.clone, WORKTREE_DIR: p.wt, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), p.timeoutMs ?? VERIFY_TIMEOUT_MS);
    const take = (chunk: Buffer): void => {
      log.write(chunk);
      tail = (tail + chunk.toString('utf8')).slice(-TAIL);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => {
      clearTimeout(timer);
      log.end();
      fail(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      log.end(() => done({ exitCode: code ?? (signal ? 137 : 1), tail: signal ? `${tail}\n${t('main.conflictGit.interrupted', { signal })}` : tail }));
    });
  });
}

export function mergeMessage(branch: string): string {
  // i18n-ignore: the message of the git merge commit, as git writes it
  return `Merge branch 'main' into '${branch}'`;
}

// Commits the merge as `identity`. Nothing is written to any git config.
export async function commitMerge(wt: string, branch: string, mainSha: string, identity: Identity): Promise<string> {
  const as = identityArgs(identity);
  if ((await unmergedPaths(wt)).length) throw new Error(t('main.conflictGit.unresolved'));
  await git(wt, [...as, 'commit', '--no-verify', '-m', mergeMessage(branch)]);
  const sha = (await git(wt, ['rev-parse', 'HEAD'])).stdout.trim();
  const parents = (await git(wt, ['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.trim().split(' ').slice(1);
  if (parents.length !== 2 || parents[1] !== mainSha) throw new Error(t('main.conflictGit.notMerge'));
  return sha;
}

// A push here may only add commits on top of the branch: no force flag, no "+" or ":" refspec, nothing but the one ref.
export function assertPlainPush(args: string[]): void {
  for (const a of args) {
    if (/^-/.test(a) && a !== '--no-verify') throw new Error(t('main.conflictGit.pushOption', { arg: a }));
    if (/^[+:]/.test(a)) throw new Error(t('main.conflictGit.refspec', { arg: a }));
  }
}

export async function remoteSha(wt: string, branch: string): Promise<string> {
  checkRef(branch, 'branch');
  await git(wt, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  return (await git(wt, ['rev-parse', `refs/remotes/origin/${branch}`])).stdout.trim();
}

export async function assertPublishable(p: { wt: string; branch: string; originSha: string; commit: string }): Promise<void> {
  if (!existsSync(p.wt)) throw new Error(t('main.conflictGit.worktreeGone'));
  const now = await remoteSha(p.wt, p.branch);
  if (now !== p.originSha) {
    throw new Error(t('main.conflictGit.branchMoved', { branch: p.branch, from: p.originSha.slice(0, 9), to: now.slice(0, 9) }));
  }
  const head = (await git(p.wt, ['rev-parse', 'HEAD'])).stdout.trim();
  if (head !== p.commit) throw new Error(t('main.conflictGit.headMoved'));
  if ((await git(p.wt, ['merge-base', '--is-ancestor', p.originSha, head], { fail: false })).code !== 0) {
    throw new Error(t('main.conflictGit.notFastForward'));
  }
  if ((await git(p.wt, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()) throw new Error(t('main.conflictGit.dirty'));
}

export async function pushBranch(wt: string, branch: string): Promise<string> {
  checkRef(branch, 'branch');
  const args = ['push', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`];
  assertPlainPush(args.slice(1));
  const r = await git(wt, args);
  return `${r.stdout}${r.stderr}`.trim();
}

export async function removeWorktree(clone: string, wt: string, syncBranch: string, dir: string): Promise<void> {
  const abs = resolve(wt);
  if (!abs.startsWith(resolve(dir) + sep)) throw new Error(t('main.conflictGit.removeOutside', { dir, wt }));
  if (existsSync(abs)) {
    await git(abs, ['merge', '--abort'], { fail: false });
    await git(clone, ['worktree', 'remove', '--force', abs]);
  }
  await git(clone, ['worktree', 'prune'], { fail: false });
  await git(clone, ['branch', '-D', syncBranch], { fail: false });
  rmSync(markersDirOf(abs), { recursive: true, force: true });
}
