import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../../shared/i18n';
import { AGENTS_FILE, DOCS_STATE_DIR } from '../../shared/harness/agentsMd';
import { git } from '../conflictGit';
import { realFolderIn } from '../engine/guard';
import { scanHarness } from '../harness/scan';
import { redact } from '../errorlog-core';

// The run writes the repository's root AGENTS.md; `.coxia/.run` remains private workflow state.

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
 * The run's record and memory live under `.coxia/.run`, ignored by git so the pull request only carries AGENTS.md.
 */
export const DOCS_RUN_FOLDER = `${DOCS_STATE_DIR}/.run`;

const IGNORE_LINE = '.run/';

/**
 * Prepares private run state and refuses an AGENTS.md path that is not a regular file.
 */
export async function prepareDocsFolder(wt: string): Promise<boolean> {
  const dir = join(wt, DOCS_STATE_DIR);
  if (!(await lstat(dir).catch(() => null))) await mkdir(dir, { recursive: true });
  if (!realFolderIn(dir, wt)) return false;
  const agents = await lstat(join(wt, AGENTS_FILE)).catch(() => null);
  return !agents || agents.isFile();
}

/**
 * Keeps Coxia's private run state out of the repository changes.
 */
export async function ensureRunIgnore(wt: string): Promise<boolean> {
  if (!(await prepareDocsFolder(wt))) return false;
  const file = join(wt, DOCS_STATE_DIR, '.gitignore');
  const info = await lstat(file).catch(() => null);
  if (info && !info.isFile()) return false;
  const had = info ? await readFile(file, 'utf8') : '';
  if (had.split('\n').some((line) => line.trim() === IGNORE_LINE)) return true;
  await writeFile(file, `${had && !had.endsWith('\n') ? `${had}\n` : had}${IGNORE_LINE}\n`);
  return true;
}

const CANDIDATES_MAX = 200;
const CLAUDE_FILE = /^(?:.*\/)?CLAUDE\.md$|^\.claude\//;

/** The files of Claude Code the repository tracks (`CLAUDE.md` anywhere, and the `.claude` folder): what a draft may import from, and never changes. */
export async function importCandidates(wt: string): Promise<string[]> {
  const r = await git(wt, ['ls-files', '-z'], { fail: false, timeout: 15_000 });
  return r.code === 0 ? r.stdout.split('\0').filter((p) => CLAUDE_FILE.test(p)).sort() : [];
}

/**
 * The record of the task the first stage reads: the mode, current AGENTS.md state, and Claude Code files that may be consulted but never changed.
 */
export async function docsRecord(wt: string, o: { ref: string; title: string; mode: 'create' | 'update' }): Promise<string> {
  const state = await scanHarness(wt);
  const lines = [`# ${o.ref} ${o.title}`, '', t(`main.runner.docs.record.${o.mode}`), '', `## ${t('main.runner.docs.record.existing')}`, ''];
  if (!state.exists) lines.push(t('main.runner.docs.record.existing.none'));
  else if (!state.document) lines.push(t('main.runner.docs.record.existing.empty'));
  else lines.push(`- ${AGENTS_FILE}: ${t('main.runner.docs.record.state.checked')}`);
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
