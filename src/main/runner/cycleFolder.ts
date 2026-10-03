import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../../shared/i18n';
import { ARTIFACT_NAME } from '../../shared/runs';
import { checkPath } from '../engine/guard';
import type { VcsComment, VcsIssue } from '../vcs/types';
import { redact } from '../errorlog-core';

// The cycle folder of a run (`docs/cycles/<n>-<slug>` inside its worktree): the issue as the agents received it, and the documents each stage produces.
// A flat folder: one flow for every kind of issue.

export const CYCLES_DIR = 'docs/cycles';
export const ISSUE_FILE = '0_ISSUE.md';

/** A title as a branch and folder name: lowercase ASCII words joined by hyphens, at most 40 characters. */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'issue';
}

export const cycleFolderOf = (iid: number, title: string): string => `${CYCLES_DIR}/${iid}-${slugOf(title)}`;

/** The issue as a document: its facts, its description and its comments, in the workspace's language, with anything that looks like a credential masked. */
export function issueRecord(issue: Pick<VcsIssue, 'iid' | 'title' | 'state' | 'labels' | 'author' | 'webUrl'> & { body?: string | null }, comments: VcsComment[], ref: string): string {
  const human = comments.filter((c) => !c.system);
  const lines = [
    `# ${ref} ${issue.title}`,
    '',
    `- ${t('main.runner.issue.url')}: ${issue.webUrl || '—'}`,
    `- ${t('main.runner.issue.state')}: ${issue.state}`,
    `- ${t('main.runner.issue.labels')}: ${issue.labels.length ? issue.labels.join(', ') : '—'}`,
    `- ${t('main.runner.issue.author')}: ${issue.author ?? '—'}`,
    '',
    `## ${t('main.runner.issue.description')}`,
    '',
    issue.body?.trim() || t('main.runner.issue.noDescription'),
    '',
    `## ${t('main.runner.issue.comments')}`,
    '',
    ...(human.length ? human.flatMap((c) => [`### ${c.author}, ${c.createdAt}`, '', c.body.trim(), '']) : [t('main.runner.issue.noComments'), '']),
  ];
  return redact(lines.join('\n'));
}

export function writeIssueRecord(wt: string, folder: string, text: string): void {
  mkdirSync(join(wt, folder), { recursive: true });
  writeFileSync(join(wt, folder, ISSUE_FILE), text);
}

export interface FolderFile {
  name: string;
  text: string;
  clipped: boolean;
}

const FILE_MAX = 30_000;
const FOLDER_MAX = 120_000;

/** The files of the cycle folder, the issue first, then the documents in name order: what a stage's agent is given to read. */
export function readFolder(wt: string, folder: string): FolderFile[] {
  const dir = join(wt, folder);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((n) => ARTIFACT_NAME.test(n) && statSync(join(dir, n)).isFile())
    .sort((a, b) => (a === ISSUE_FILE ? -1 : b === ISSUE_FILE ? 1 : a.localeCompare(b)));
  let left = FOLDER_MAX;
  const files: FolderFile[] = [];
  for (const name of names) {
    if (left <= 0) break;
    const raw = readFileSync(join(dir, name), 'utf8');
    const cap = Math.min(FILE_MAX, left);
    files.push({ name, text: raw.slice(0, cap), clipped: raw.length > cap });
    left -= Math.min(raw.length, cap);
  }
  return files;
}

/** Writes a document of the stage into the cycle folder. The path goes through the same guard the agents' own writes do, so a name cannot lead anywhere else. */
export function writeArtifact(wt: string, folder: string, name: string, content: string): void {
  // i18n-ignore-next-line: developer error: the names come from the stage's own list
  if (!ARTIFACT_NAME.test(name)) throw new Error(`not a document name: ${name}`);
  mkdirSync(join(wt, folder), { recursive: true });
  const check = checkPath(wt, join(folder, name));
  // i18n-ignore-next-line: developer error
  if (!check.ok) throw new Error(`document refused (${check.code}): ${name}`);
  writeFileSync(check.path, content.endsWith('\n') ? content : `${content}\n`);
}

const VIEW_MAX = 200_000;
const PIECE = 2_000;

// The masking of secrets slows down on one very long unbroken line (a minified file, a blob): it goes line by line, and a line that long in pieces, cut at a space when there is one.
function redactLong(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= PIECE) return redact(line);
      const out: string[] = [];
      for (let rest = line; rest; ) {
        const cut = rest.length <= PIECE ? rest.length : Math.max(rest.lastIndexOf(' ', PIECE), 0) || PIECE;
        out.push(redact(rest.slice(0, cut)));
        rest = rest.slice(cut);
      }
      return out.join('');
    })
    .join('\n');
}

/** One document of the cycle folder as text for the run screen, secrets masked; null when the name is not a document, the file is not there, or the path leaves the folder. */
export function readArtifact(wt: string, folder: string, name: string): { text: string; clipped: boolean } | null {
  if (!ARTIFACT_NAME.test(name)) return null;
  const check = checkPath(wt, join(folder, name), { read: true });
  if (!check.ok || !existsSync(check.path) || !statSync(check.path).isFile()) return null;
  const raw = readFileSync(check.path, 'utf8');
  return { text: redactLong(raw.slice(0, VIEW_MAX)), clipped: raw.length > VIEW_MAX };
}
