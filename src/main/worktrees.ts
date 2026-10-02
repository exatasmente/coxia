import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BranchHealth, WorktreeHealth } from '../shared/radar';
import { WORKSPACE } from './env';

const exec = promisify(execFile);

export const REPOS = ['sz4', 'sz4-frontend', 'sz4-backend', 'new-agent', 'hub-whatsapp', 'agent-socket-manager', 'sz-playbook'];

// Read-only on purpose: --no-optional-locks keeps `git status` from refreshing (writing) the index.
async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['--no-optional-locks', '-C', repo, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  prunable: boolean;
}

function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const get = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? null;
      return {
        path: get('worktree') ?? '',
        head: get('HEAD') ?? '',
        branch: get('branch')?.replace(/^refs\/heads\//, '') ?? null,
        prunable: lines.some((l) => l.startsWith('prunable')),
      };
    })
    .filter((w) => w.path);
}

const TYPE_BY_PREFIX: Record<string, string> = { bugfix: 'bugfix', bug: 'bugfix', fix: 'bugfix', feat: 'feature', feature: 'feature', hotfix: 'hotfix' };
// Throwaway branches (coverage runs, experiments, local-only work, backups) are local by design:
// no naming convention, and "not pushed" is expected.
const SCRATCH = /^(cov|exp|local|backup|test)[/-]/;
const LONG_LIVED = /^(main|master|develop)$/;
const RELEASE_VERSION = /^release\/v?\d+(\.\d+)*(-[\w.]+)?$/;
const WORK = /^release\/(bugfix|feature|hotfix)\/\d+(-[\w.]+)?$/;
const DOCS = /^docs\/[a-z0-9][a-z0-9-]*$/;

export function issueOf(branch: string | null, path: string): string | null {
  const fromBranch = branch?.match(/(?<!\d)(\d{5,6})(?!\d)/)?.[1];
  if (fromBranch) return fromBranch;
  return path.match(/\/wt-(?:cov)?(\d{5,6})(?!\d)/)?.[1] ?? null;
}

// Convention from CLAUDE.md and the branch-rename skill: release/(bugfix|feature|hotfix)/<n>, docs/<slug>.
export function checkConvention(branch: string): { suggestedName: string | null; note: string | null } | null {
  if (LONG_LIVED.test(branch) || RELEASE_VERSION.test(branch) || WORK.test(branch) || DOCS.test(branch) || SCRATCH.test(branch)) return null;
  const m = branch.match(/^([a-z]+)\/(\d{5,6}(?:-[\w.]+)?)$/i) ?? branch.match(/^release\/(feat)\/(\d{5,6}(?:-[\w.]+)?)$/);
  const type = m ? TYPE_BY_PREFIX[m[1].toLowerCase()] : undefined;
  if (m && type) return { suggestedName: `release/${type}/${m[2]}`, note: `renomear para release/${type}/${m[2]} (skill branch-rename)` };
  const number = branch.match(/(?<!\d)(\d{5,6})(?!\d)/)?.[1];
  return {
    suggestedName: null,
    note: number ? `usar release/<bugfix|feature|hotfix>/${number}` : 'fora de release/<tipo>/<n> e docs/<slug>',
  };
}

interface Ref {
  name: string;
  upstream: string;
  track: string;
}

async function inspectRepo(name: string): Promise<BranchHealth[]> {
  const repo = join(WORKSPACE, name);
  if (!existsSync(join(repo, '.git'))) return [];
  const [wtOut, refOut] = await Promise.all([
    git(repo, ['worktree', 'list', '--porcelain']),
    git(repo, ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)', 'refs/heads']),
  ]);
  const worktrees = parseWorktrees(wtOut).filter((w) => !w.prunable && existsSync(w.path));
  const refs = new Map<string, Ref>(
    refOut
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [n, upstream, track] = l.split('\t');
        return [n, { name: n, upstream, track }];
      }),
  );

  const unpushed = async (branch: string): Promise<{ n: number; own: boolean }> => {
    const ref = refs.get(branch);
    // An upstream that is another branch (a branch cut from origin/main tracks it) says nothing about publishing.
    // The remote branch was deleted (merged): what is left locally is not waiting for a push.
    if (ref?.track.includes('gone')) return { n: 0, own: true };
    const own = !!ref?.upstream && ref.upstream.replace(/^[^/]+\//, '') === branch;
    // Not "ahead of upstream": after merging main into the branch that counts every main commit already on the
    // remote (a branch showed 210 ahead with a single unpushed merge commit). Only commits on no remote ref count.
    const out = await git(repo, ['rev-list', '--count', branch, '--not', '--remotes']);
    return { n: Number(out.trim()), own };
  };

  const items: BranchHealth[] = [];
  const checkedOut = new Set<string>();
  await pool(worktrees, 6, async (w) => {
    if (w.branch) checkedOut.add(w.branch);
    const [status, push] = await Promise.all([
      git(w.path, ['status', '--porcelain']).catch(() => ''),
      w.branch ? unpushed(w.branch) : git(repo, ['rev-list', '--count', w.head, '--not', '--remotes']).then((n) => ({ n: Number(n.trim()), own: false })),
    ]);
    const files = status.split('\n').filter(Boolean);
    const conv = w.branch ? checkConvention(w.branch) : null;
    items.push({
      repo: name,
      branch: w.branch ?? `(detached ${w.head.slice(0, 7)})`,
      worktree: w.path,
      issue: issueOf(w.branch, w.path),
      base: name === 'new-agent' ? 'develop' : 'main',
      dirty: files.length,
      dirtyFiles: files.slice(0, 8),
      unpushed: push.n,
      hasUpstream: push.own,
      suggestedName: conv?.suggestedName ?? null,
      conventionNote: conv?.note ?? null,
    });
  });
  // Local branches with no worktree can hold unpushed commits too.
  await pool([...refs.keys()].filter((b) => !checkedOut.has(b)), 6, async (b) => {
    const push = await unpushed(b);
    if (!push.n) return;
    const conv = checkConvention(b);
    items.push({
      repo: name,
      branch: b,
      worktree: null,
      issue: issueOf(b, ''),
      base: name === 'new-agent' ? 'develop' : 'main',
      dirty: 0,
      dirtyFiles: [],
      unpushed: push.n,
      hasUpstream: push.own,
      suggestedName: conv?.suggestedName ?? null,
      conventionNote: conv?.note ?? null,
    });
  });
  return items.filter((i) => !SCRATCH.test(i.branch) && (i.dirty > 0 || i.unpushed > 0 || i.conventionNote));
}

// Updates only the remote-tracking refs (authorized by the user on 2026-10-02), so "sem push" compares against
// the real remote instead of the last fetch someone happened to run.
export async function fetchRepos(): Promise<void> {
  await Promise.all(
    REPOS.map((r) => join(WORKSPACE, r))
      .filter((repo) => existsSync(join(repo, '.git')))
      .map((repo) => exec('git', ['-C', repo, 'fetch', '--quiet', 'origin'], { timeout: 120_000 }).catch((e) => console.error('[fetch]', repo, String(e).slice(0, 200)))),
  );
}

export async function worktreeHealth(): Promise<WorktreeHealth> {
  const all = (await Promise.all(REPOS.map((r) => inspectRepo(r).catch(() => [] as BranchHealth[])))).flat();
  const byIssue: Record<string, BranchHealth[]> = {};
  const unassigned: BranchHealth[] = [];
  for (const item of all) {
    if (item.issue) (byIssue[item.issue] ??= []).push(item);
    else unassigned.push(item);
  }
  return { checkedAt: new Date().toISOString(), byIssue, unassigned };
}
