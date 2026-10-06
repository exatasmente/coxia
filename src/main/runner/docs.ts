import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../../shared/i18n';
import { HARNESS_DIR } from '../../shared/harness/format';
import { git } from '../conflictGit';
import { scanHarness } from '../harness/scan';
import { checkHarness } from '../harness/stale';
import { redact } from '../errorlog-core';

// What a documentation run (a run that drafts or updates the `.coxia/` of a repository) says about itself: its reference, its title, its branch, the folder where its
// own documents live, and the record of the task the first stage reads. Nothing here talks to a code host.

/** The reference of a documentation run: what "one run at a time" keys on, per repository. */
export const docsRef = (repo: string): string => `docs:${repo}`;

/** The title of the run and of its pull request: the host's own text, English whatever the workspace's language. */
// i18n-ignore-next-line: the title of the pull request on the host
export const docsTitle = (repo: string): string => `Documentation of ${repo}`;

/** The day as the branch and the folder of the worktree carry it: `YYYYMMDD`, UTC, so a second run on another day does not meet the first one's branch. */
export const dayStamp = (now: Date): string => now.toISOString().slice(0, 10).replace(/-/g, '');

/** The branch of a documentation run: the convention of the other runs (`cycle/…`), with the day for a second try after a merge. */
export const docsBranch = (repo: string, now: Date): string => `cycle/docs-${repo}-${dayStamp(now)}`;

/**
 * The cycle folder of a documentation run, inside `.coxia/` and ignored by git (`.coxia/.gitignore`): the run's record, memory and documents are written and read on disk
 * as always, and `git add -A` never sees them, so the pull request carries the documentation and nothing of the run.
 */
export const DOCS_RUN_FOLDER = `${HARNESS_DIR}/.run`;

const IGNORE_LINE = '.run/';

/** Makes `.coxia/.gitignore` say `.run/`, keeping whatever else the repository already had there. */
export async function ensureRunIgnore(wt: string): Promise<void> {
  const file = join(wt, HARNESS_DIR, '.gitignore');
  await mkdir(join(wt, HARNESS_DIR), { recursive: true });
  const had = existsSync(file) ? await readFile(file, 'utf8') : '';
  if (had.split('\n').some((line) => line.trim() === IGNORE_LINE)) return;
  await writeFile(file, `${had && !had.endsWith('\n') ? `${had}\n` : had}${IGNORE_LINE}\n`);
}

const CANDIDATES_MAX = 200;
const CLAUDE_FILE = /^(?:.*\/)?CLAUDE\.md$|^\.claude\//;

/** The files of Claude Code the repository tracks (`CLAUDE.md` anywhere, and the `.claude` folder): what a draft may import from, and never changes. */
export async function importCandidates(wt: string): Promise<string[]> {
  const r = await git(wt, ['ls-files', '-z'], { fail: false, timeout: 15_000 });
  return r.code === 0 ? r.stdout.split('\0').filter((p) => CLAUDE_FILE.test(p)).sort() : [];
}

/**
 * The record of the task the first stage reads (the run's `0_ISSUE.md`): the mode, what `.coxia/` has now with the state of each file, and the files of Claude Code the
 * draft may import from. In the workspace's language, with anything that looks like a credential masked.
 */
export async function docsRecord(wt: string, o: { ref: string; title: string; mode: 'create' | 'update' }): Promise<string> {
  const state = await scanHarness(wt);
  const check = state.exists ? await checkHarness(state).catch(() => null) : null;
  const lines = [`# ${o.ref} ${o.title}`, '', t(`main.runner.docs.record.${o.mode}`), '', `## ${t('main.runner.docs.record.existing')}`, ''];
  if (!state.exists) lines.push(t('main.runner.docs.record.existing.none'));
  else if (!state.entries.length) lines.push(t('main.runner.docs.record.existing.empty'));
  for (const e of state.entries) {
    const base = `- ${HARNESS_DIR}/${e.path}: `;
    if (!e.parse.ok) {
      lines.push(base + t('main.runner.docs.record.state.invalid', { reason: e.parse.reason }));
      continue;
    }
    const at = check?.files[e.path];
    if (at?.state === 'stale') lines.push(base + t('main.runner.docs.record.state.stale', { count: at.total, commit: at.ref.slice(0, 7), names: at.changed.slice(0, 3).join(', ') }));
    else if (!at || at.state === 'unverified') lines.push(base + t('main.runner.docs.record.state.unverified'));
    else lines.push(base + t('main.runner.docs.record.state.checked'));
  }
  if (state.ignored.length) lines.push('', t('main.runner.docs.record.ignored', { names: state.ignored.slice(0, 20).join(', ') }));
  const found = await importCandidates(wt);
  lines.push('', `## ${t('main.runner.docs.record.candidates')}`, '');
  if (!found.length) lines.push(t('main.runner.docs.record.candidates.none'));
  else {
    lines.push(...found.slice(0, CANDIDATES_MAX).map((p) => `- ${p}`));
    if (found.length > CANDIDATES_MAX) lines.push(`- ${t('main.runner.docs.record.candidates.more', { count: found.length - CANDIDATES_MAX })}`);
  }
  return redact(lines.join('\n'));
}
