import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HARNESS_DIR, type InvalidReason, classifyHarnessPath, parseHarnessFile } from '../../shared/harness/format';
import { rewriteLocal } from '../../shared/runs/comment';
import { git } from '../conflictGit';

// What the app does to the documentation a pass wrote, before it is committed and long before it is pushed: the text is checked for what must not leave the
// machine (local paths, credentials), and what the pass changed is stamped with the commit and the day it was checked. Nothing is refused: the review of the
// pull request is the gate; the person is told what was rewritten.

/** The subject of the commit that records the stamp: the runner's template puts its own prefix and number around it. */
// i18n-ignore-next-line: the subject of a commit in the repository's history
export const STAMP_SUMMARY = 'update the documentation check';

export interface Rewrite {
  /** Path of the file, relative to the worktree. */
  file: string;
  paths: number;
  secrets: number;
}

export interface Finalized {
  /** The files whose body was rewritten, with what was found in each. */
  rewritten: Rewrite[];
  /** Local paths rewritten and credentials masked, in all of them. */
  paths: number;
  secrets: number;
  /** Files of the layout the pass changed whose header is not valid: they are not stamped, and the person is told. */
  invalid: { file: string; reason: InvalidReason }[];
  /** Files of the layout the pass changed whose header is valid: what the stamp is written into once the commit exists. */
  stamp: string[];
}

const MASK = /\[(?:redacted|key|jwt|email)\]/g;
const masks = (text: string): number => (text.match(MASK) ?? []).length;

/** The header block of a file (both fences, with the line break after) and the text that follows; no header: the whole text is the body. */
function splitFile(text: string): { head: string; body: string } {
  const lines = text.split('\n');
  if (lines[0]?.replace(/^﻿/, '').trim() !== '---') return { head: '', body: text };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return { head: '', body: text };
  const rest = lines.slice(end + 1);
  return { head: lines.slice(0, end + 1).join('\n') + (rest.length ? '\n' : ''), body: rest.join('\n') };
}

/** The `.md` files of the layout the working tree changed under `.coxia/` (modified, added or not tracked yet), relative to the folder; deleted ones are not there. */
async function changedLayoutFiles(wt: string): Promise<string[]> {
  const r = await git(wt, ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--', HARNESS_DIR], { fail: false });
  if (r.code !== 0) return [];
  const out: string[] = [];
  for (const entry of r.stdout.split('\0')) {
    // "XY path": a deletion on either side leaves no file to read
    if (entry.length < 4 || entry.slice(0, 2).includes('D')) continue;
    const rel = entry.slice(3);
    if (rel.startsWith(`${HARNESS_DIR}/`) && classifyHarnessPath(rel.slice(HARNESS_DIR.length + 1))) out.push(rel.slice(HARNESS_DIR.length + 1));
  }
  return out.sort();
}

/**
 * Checks the documentation the pass changed: the body of each file is rewritten (a local path becomes a path of the repository, what looks like a credential is
 * masked) and never the header, whose commit would be taken for an opaque string; a header that does not parse is reported. Writes only the files it rewrites.
 */
export async function finalizeHarness(wt: string, o: { redact: (text: string) => string }): Promise<Finalized> {
  const out: Finalized = { rewritten: [], paths: 0, secrets: 0, invalid: [], stamp: [] };
  for (const rel of await changedLayoutFiles(wt)) {
    const file = `${HARNESS_DIR}/${rel}`;
    const text = await readFile(join(wt, file), 'utf8').catch(() => null);
    if (text === null) continue;
    const { head, body } = splitFile(text);
    const done = rewriteLocal(body, { worktree: wt, redact: o.redact });
    let next = text;
    if (done.body !== body) {
      next = head + done.body;
      await writeFile(join(wt, file), next);
      const secrets = Math.max(0, masks(done.body) - masks(body));
      out.rewritten.push({ file, paths: done.paths, secrets });
      out.paths += done.paths;
      out.secrets += secrets;
    }
    const parsed = parseHarnessFile(rel, next);
    if (!parsed) continue;
    if (parsed.ok) out.stamp.push(file);
    else out.invalid.push({ file, reason: parsed.reason });
  }
  return out;
}

/** The text with `checked-commit` and `checked-date` of its header set; null when it has no header to set them in. */
export function stampText(text: string, commit: string, date: string): string | null {
  const { head, body } = splitFile(text);
  if (!head) return null;
  const lines = head.split('\n');
  const set = (key: string, value: string): boolean => {
    const at = lines.findIndex((line, i) => i > 0 && line.startsWith(`${key}:`));
    if (at < 0) return false;
    lines[at] = `${key}: ${value}`;
    return true;
  };
  return set('checked-commit', commit) && set('checked-date', date) ? lines.join('\n') + body : null;
}

/**
 * Writes the stamp into the files the pass changed: the commit that holds them and today (UTC). The app writes it, not the agent: the agent cannot know the commit
 * that does not exist yet. Returns the files it changed, for the second commit.
 */
export async function stampHarness(wt: string, files: string[], commit: string, now: () => Date = () => new Date()): Promise<string[]> {
  const date = now().toISOString().slice(0, 10);
  const changed: string[] = [];
  for (const file of files) {
    const text = await readFile(join(wt, file), 'utf8').catch(() => null);
    const next = text === null ? null : stampText(text, commit, date);
    if (next === null || next === text) continue;
    await writeFile(join(wt, file), next);
    changed.push(file);
  }
  return changed;
}
