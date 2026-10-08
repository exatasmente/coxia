import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from '../../shared/runs';
import { isTerminal } from '../../shared/runs/types';
import type { DocsRepoStatus, DocsStatus } from '../../shared/harness/status';
import { BUDGET_MAX } from '../../shared/harness/select';
import { git } from '../conflictGit';
import { docsRef } from '../runner/docs';
import { scanHarness } from './scan';

export interface DocsStatusDeps {
  repos: { id: string; path: string }[];
  runs: Run[];
  flow: boolean;
}

async function headOf(path: string): Promise<DocsRepoStatus['head']> {
  const result = await git(path, ['log', '-1', '--format=%h%x00%cs', 'HEAD'], { fail: false, timeout: 5000 });
  const [commit, date] = result.code === 0 ? result.stdout.trim().split('\0') : [];
  return commit && date ? { commit, date } : null;
}

async function repoStatus(repo: { id: string; path: string }, runs: Run[]): Promise<DocsRepoStatus> {
  const state = await scanHarness(repo.path);
  const active = runs.find((run) => run.docs && run.issue.ref === docsRef(repo.id) && !isTerminal(run));
  return {
    repo: repo.id,
    exists: state.exists,
    ready: state.document !== null,
    ignored: state.ignored,
    head: await headOf(repo.path),
    claude: existsSync(join(repo.path, 'CLAUDE.md')) || existsSync(join(repo.path, '.claude')),
    run: active ? { id: active.id } : null,
  };
}

export async function docsStatus(deps: DocsStatusDeps): Promise<DocsStatus> {
  const repos = await Promise.all(deps.repos.map((repo) => repoStatus(repo, deps.runs)));
  return { repos, flow: deps.flow, budget: BUDGET_MAX };
}
