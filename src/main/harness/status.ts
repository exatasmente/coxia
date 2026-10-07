import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from '../../shared/runs';
import { isTerminal } from '../../shared/runs/types';
import { type DocsRepoStatus, type DocsStatus, type UncheckedFile } from '../../shared/harness/status';
import { BUDGET_MAX } from '../../shared/harness/select';
import { git } from '../conflictGit';
import { docsRef } from '../runner/docs';
import { scanHarness } from './scan';
import { checkHarness } from './stale';

// What Settings › Documentation reads: per repository, what `.coxia/` holds and where each file stands. Read only: no model, no write, no network.

export interface DocsStatusDeps {
  repos: { id: string; path: string }[];
  runs: Run[];
  /** The workspace has the documentation flow. */
  flow: boolean;
}

async function headOf(path: string): Promise<DocsRepoStatus['head']> {
  const r = await git(path, ['log', '-1', '--format=%h%x00%cs', 'HEAD'], { fail: false, timeout: 5000 });
  const [commit, date] = r.code === 0 ? r.stdout.trim().split('\0') : [];
  return commit && date ? { commit, date } : null;
}

async function repoStatus(repo: { id: string; path: string }, runs: Run[]): Promise<DocsRepoStatus> {
  const state = await scanHarness(repo.path);
  const out: DocsRepoStatus = {
    repo: repo.id,
    exists: state.exists,
    overview: false,
    rules: 0,
    skills: 0,
    roles: 0,
    unchecked: [],
    ignored: state.ignored,
    head: await headOf(repo.path),
    claude: existsSync(join(repo.path, 'CLAUDE.md')) || existsSync(join(repo.path, '.claude')),
    run: null,
  };
  const going = runs.find((r) => r.docs && r.issue.ref === docsRef(repo.id) && !isTerminal(r));
  if (going) out.run = { id: going.id };
  if (!state.exists) return out;
  // an invalid file still counts by what it is (its kind comes from where it sits), and is listed as not checked
  const check = await checkHarness(state);
  for (const e of state.entries) {
    if (e.kind === 'overview') out.overview = true;
    else out[e.kind === 'rule' ? 'rules' : e.kind === 'skill' ? 'skills' : 'roles'] += 1;
    if (!e.parse.ok) {
      out.unchecked.push({ path: e.path, kind: e.kind, state: 'invalid', reason: e.parse.reason, changed: [], total: 0, commit: null, date: null });
      continue;
    }
    const at = check.files[e.path];
    if (!at || at.state === 'checked') continue;
    const header = e.parse.file.header;
    const file: UncheckedFile = { path: e.path, kind: e.kind, state: at.state, reason: '', changed: [], total: 0, commit: header.checkedCommit.slice(0, 7), date: header.checkedDate };
    if (at.state === 'stale') Object.assign(file, { reason: 'changed', changed: at.changed, total: at.total });
    else file.reason = at.reason;
    out.unchecked.push(file);
  }
  return out;
}

/** The status of every repository, read in parallel (each one a few reads of git; the comparison is cached by `HEAD`). */
export async function docsStatus(d: DocsStatusDeps): Promise<DocsStatus> {
  const repos = await Promise.all(d.repos.map((r) => repoStatus(r, d.runs)));
  return { repos, flow: d.flow, budget: BUDGET_MAX };
}
