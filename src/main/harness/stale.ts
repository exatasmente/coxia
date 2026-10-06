import { coversPath, evidencePaths } from '../../shared/harness/evidence';
import { HARNESS_DIR, type HarnessFile, type HarnessState } from '../../shared/harness/format';
import { git } from '../conflictGit';
import { scanHarness } from './scan';

// Whether a rule of `.coxia/` is still true cannot be known; what can be known is whether a file it cites changed since the commit it was checked against.
// Read-only git, one repository at a time, within a limit of time: what cannot be compared is `unverified`, never "checked".

export const CHECK_LIMIT_MS = 5000;
/** How many changed files a result keeps, for the screen and the mark; `total` has the count. */
export const CHANGED_KEPT = 5;

export type Unverified = 'git' | 'timeout' | 'outside-history';

export type Staleness =
  | { state: 'checked' }
  | { state: 'stale'; ref: string; changed: string[]; total: number }
  | { state: 'unverified'; reason: Unverified };

export interface HarnessCheck {
  /** The commit read (`HEAD` of the checkout); null when no file had evidence to compare, or git failed. */
  head: string | null;
  /** By path inside `.coxia/`, for every file that parsed. Files that did not parse have no entry: they are `invalid`, not stale. */
  files: Record<string, Staleness>;
  /** The comparison with the commits was reused (same `HEAD`, same files in `.coxia/`). Changes not yet committed are always read again. */
  cached: boolean;
}

type Base = { state: 'checked'; ref: string } | { state: 'stale'; ref: string; changed: string[] } | { state: 'unverified'; reason: Unverified };

const CACHE = new Map<string, { head: string; signature: string; base: Map<string, Base> }>();
export const clearHarnessCache = (): void => CACHE.clear();

class OutOfTime extends Error {}

const unique = (list: string[]): string[] => [...new Set(list)].sort();
// `top`: the evidence is relative to the root of the repository, wherever the command runs; `literal`: no glob in a path means anything
const spec = (paths: string[]): string[] => [...paths.map((p) => `:(top,literal)${p}`), `:(top,exclude,literal)${HARNESS_DIR}`];

/** Where each file stands against the code it cites. Never throws: a repository that cannot be read yields `unverified` for the files that have evidence. */
export async function checkHarness(state: HarnessState, opts: { timeoutMs?: number } = {}): Promise<HarnessCheck> {
  const files: Record<string, Staleness> = {};
  const ruled: HarnessFile[] = [];
  for (const entry of state.entries) {
    if (!entry.parse.ok) continue;
    const f = entry.parse.file;
    // a file with no evidence (overview, skill, role) has nothing to compare
    if (evidencePaths(f.header.evidence).length === 0) files[f.path] = { state: 'checked' };
    else ruled.push(f);
  }
  const result = (head: string | null, cached: boolean): HarnessCheck => ({ head, files, cached });
  const all = (reason: Unverified): HarnessCheck => {
    for (const f of ruled) files[f.path] = { state: 'unverified', reason };
    return result(null, false);
  };
  if (ruled.length === 0) return result(null, false);

  const deadline = Date.now() + (opts.timeoutMs ?? CHECK_LIMIT_MS);
  const run = async (args: string[]) => {
    if (Date.now() >= deadline) throw new OutOfTime();
    const r = await git(state.repo, args, { fail: false, timeout: deadline - Date.now() });
    if (r.code !== 0 && Date.now() >= deadline) throw new OutOfTime();
    return r;
  };
  const changedSince = async (ref: string, paths: string[]): Promise<string[] | null> => {
    // --no-renames: a file that moved shows under both names, so nothing leaves the comparison by being renamed; a deleted file counts as changed
    const r = await run(['diff', '--name-only', '--no-renames', '-z', ref, ...(ref === 'HEAD' ? [] : ['HEAD']), '--', ...spec(paths)]);
    return r.code === 0 ? r.stdout.split('\0').filter(Boolean) : null;
  };

  try {
    const head = await run(['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (head.code !== 0) return all('git');
    const sha = head.stdout.trim();
    const hit = CACHE.get(state.repo);
    const cached = hit?.head === sha && hit.signature === state.signature;
    const base = cached && hit ? hit.base : await compare(ruled, run, changedSince);
    if (!cached && ![...base.values()].some((b) => b.state === 'unverified' && b.reason === 'git')) CACHE.set(state.repo, { head: sha, signature: state.signature, base });

    // what changed in the working tree since HEAD (staged or not) is read every time: it is not in the commits the cache is keyed by
    const dirty = await changedSince('HEAD', unique(ruled.flatMap((f) => evidencePaths(f.header.evidence))));
    for (const f of ruled) {
      const b = base.get(f.path);
      if (!b) files[f.path] = { state: 'unverified', reason: 'git' };
      else if (b.state === 'unverified') files[f.path] = b;
      else if (dirty === null) files[f.path] = { state: 'unverified', reason: 'git' };
      else {
        const changed = unique([...(b.state === 'stale' ? b.changed : []), ...dirty.filter((n) => f.header.evidence.some((e) => coversPath(e, n)))]);
        files[f.path] = changed.length ? { state: 'stale', ref: b.ref, changed: changed.slice(0, CHANGED_KEPT), total: changed.length } : { state: 'checked' };
      }
    }
    return result(sha, cached);
  } catch (e) {
    if (e instanceof OutOfTime) return all('timeout');
    throw e;
  }
}

type Run = (args: string[]) => Promise<{ stdout: string; code: number }>;

/** Each file against the commits since the commit it was checked against: the commit itself when the history still has it, else the one that put that value in the file. */
async function compare(ruled: HarnessFile[], run: Run, changedSince: (ref: string, paths: string[]) => Promise<string[] | null>): Promise<Map<string, Base>> {
  const base = new Map<string, Base>();
  const groups = new Map<string, HarnessFile[]>();
  for (const f of ruled) {
    const ref = await referenceOf(f, run);
    if (ref === null) {
      base.set(f.path, { state: 'unverified', reason: 'outside-history' });
      continue;
    }
    groups.set(ref, [...(groups.get(ref) ?? []), f]);
  }
  // one comparison per distinct reference, not per file: files checked at the same commit share it
  for (const [ref, group] of groups) {
    const names = await changedSince(ref, unique(group.flatMap((f) => evidencePaths(f.header.evidence))));
    for (const f of group) {
      if (names === null) base.set(f.path, { state: 'unverified', reason: 'git' });
      else {
        const changed = names.filter((n) => f.header.evidence.some((e) => coversPath(e, n)));
        base.set(f.path, changed.length ? { state: 'stale', ref, changed: unique(changed) } : { state: 'checked', ref });
      }
    }
  }
  return base;
}

/** The commit to compare from, or null when the history has nothing to offer. */
async function referenceOf(f: HarnessFile, run: Run): Promise<string | null> {
  const commit = f.header.checkedCommit;
  const known = await run(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]);
  if (known.code === 0) {
    const sha = known.stdout.trim();
    if ((await run(['merge-base', '--is-ancestor', sha, 'HEAD'])).code === 0) return sha;
  }
  // The commit is gone from this history (a squash or a rebase of the pull request): the first commit that wrote the value into the file is the one
  // that holds the rule and the change it describes together, so what came after it is what counts.
  const first = await run(['log', `-S${commit}`, '--reverse', '--format=%H', '--', `${HARNESS_DIR}/${f.path}`]);
  return first.code === 0 ? first.stdout.split('\n').find(Boolean) ?? null : null;
}

/** A rule the branch left behind: its file (relative to the repository) and the code the branch changed that it cites. */
export interface BehindRule {
  file: string;
  /** Up to three files of the code the branch changed that the rule cites and that moved after the rule was checked. */
  changed: string[];
}

const BEHIND_FILES_KEPT = 3;

/**
 * The rules of `.coxia/` that a run's branch left behind, for its review to point at: those that are `stale` and cite a file of the code the branch changed (what it
 * committed since `base` and what is not committed yet, outside the cycle folder), and that the branch did not bring up to date. A rule the branch did bring up to date
 * was stamped with a commit that holds its change, so it is not stale, unless the code changed again after that. A rule that was already out of date before the branch,
 * and cites nothing the branch touched, is not this run's to answer for. Empty when the repository has no `.coxia/`.
 */
export async function behindOf(wt: string, base: string | null, cycleFolder: string | null = null): Promise<BehindRule[]> {
  if (!base) return [];
  const state = await scanHarness(wt);
  if (!state.exists || !state.entries.length) return [];
  const diff = await git(wt, ['diff', '--name-only', '--no-renames', '-z', base], { fail: false, timeout: CHECK_LIMIT_MS });
  if (diff.code !== 0) return [];
  const code = diff.stdout.split('\0').filter((p) => p && p !== HARNESS_DIR && !p.startsWith(`${HARNESS_DIR}/`) && !(cycleFolder && (p === cycleFolder || p.startsWith(`${cycleFolder}/`))));
  if (!code.length) return [];
  const check = await checkHarness(state);
  const out: BehindRule[] = [];
  for (const entry of state.entries) {
    if (!entry.parse.ok) continue;
    const file = entry.parse.file;
    const at = check.files[file.path];
    if (at?.state !== 'stale') continue;
    const cited = code.filter((p) => file.header.evidence.some((e) => coversPath(e, p)));
    if (!cited.length) continue;
    // Of the files the branch changed that the rule cites, the ones that moved since the rule was checked: the rule is behind for those.
    const moved = await git(wt, ['diff', '--name-only', '--no-renames', '-z', at.ref, '--', ...cited.map((p) => `:(top,literal)${p}`)], { fail: false, timeout: CHECK_LIMIT_MS });
    const names = moved.code === 0 ? moved.stdout.split('\0').filter(Boolean) : cited;
    if (!names.length) continue;
    out.push({ file: `${HARNESS_DIR}/${file.path}`, changed: unique(names).slice(0, BEHIND_FILES_KEPT) });
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : 1));
}
