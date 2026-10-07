import { lstat, readFile, writeFile } from 'node:fs/promises';
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
  /** Files of the layout that are not regular files (a symbolic link, say): the app neither reads nor writes through them, and the person is told. */
  skipped: string[];
  /** Files of the layout the pass changed whose header is valid: what the stamp is written into once the commit exists. */
  stamp: string[];
}

const MASK = /\[(?:redacted|key|jwt|email)\]/g;
const masks = (text: string): number => (text.match(MASK) ?? []).length;

interface Piece {
  code: boolean;
  text: string;
}

// A span of code in a line of prose: a run of backticks, what is inside, the same run again.
// It does not cross a blank line: a lone backtick does not turn the paragraphs after it into code.
const SPAN = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g;

/** The text cut into what is code (fenced blocks and code spans) and what is prose, in order, so that putting the pieces back together gives the text. */
function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let prose = '';
  const flush = (): void => {
    let at = 0;
    for (const m of prose.matchAll(SPAN)) {
      const i = m.index ?? 0;
      if (i > at) out.push({ code: false, text: prose.slice(at, i) });
      out.push({ code: true, text: m[0] });
      at = i + m[0].length;
    }
    if (at < prose.length) out.push({ code: false, text: prose.slice(at) });
    prose = '';
  };
  let fence: { char: string; size: number } | null = null;
  let block = '';
  for (const line of text.match(/[^\n]*\n|[^\n]+/g) ?? []) {
    const edge = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r?\n$/, ''));
    if (!fence) {
      if (edge && !(edge[1][0] === '`' && edge[2].includes('`'))) {
        flush();
        fence = { char: edge[1][0], size: edge[1].length };
        block = line;
      } else prose += line;
    } else {
      block += line;
      if (edge && edge[1][0] === fence.char && edge[1].length >= fence.size && !edge[2].trim()) {
        out.push({ code: true, text: block });
        fence = null;
        block = '';
      }
    }
  }
  // A fence that is never closed runs to the end of the text.
  if (fence) out.push({ code: true, text: block });
  flush();
  return out;
}

export interface FinalizeOptions {
  /** Masks what looks like a credential in prose. */
  redact: (text: string) => string;
  /** The same for quoted code: it must leave an assignment such as `apiKey: string;` alone. */
  redactCode: (text: string) => string;
}

/**
 * The body with its prose rewritten (a local path becomes a path of the repository, what looks like a credential is masked) and its code left as the author wrote it,
 * except for what is a credential by its shape and for the paths of this very worktree, which are local wherever they stand.
 */
function rewriteBody(body: string, wt: string, o: FinalizeOptions): { body: string; paths: number; secrets: number } {
  let paths = 0;
  let secrets = 0;
  const root = wt.replace(/\/+$/, '');
  const text = pieces(body)
    .map((p) => {
      if (!p.text) return p.text;
      if (!p.code) {
        const done = rewriteLocal(p.text, { worktree: wt, redact: o.redact });
        paths += done.paths;
        secrets += Math.max(0, masks(done.body) - masks(p.text));
        return done.body;
      }
      const inside = root ? p.text.split(`${root}/`) : [p.text];
      paths += inside.length - 1;
      const masked = o.redactCode(inside.join(''));
      secrets += Math.max(0, masks(masked) - masks(p.text));
      return masked;
    })
    .join('');
  return { body: text, paths, secrets };
}

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
 * Checks the documentation the pass changed: the prose of the body of each file is rewritten (a local path becomes a path of the repository, what looks like a credential is
 * masked; code blocks and code spans are left alone, see `rewriteBody`) and never the header, whose commit would be taken for an opaque string; a header that does not parse is reported. Writes only the files it rewrites.
 */
export async function finalizeHarness(wt: string, o: FinalizeOptions): Promise<Finalized> {
  const out: Finalized = { rewritten: [], paths: 0, secrets: 0, invalid: [], skipped: [], stamp: [] };
  for (const rel of await changedLayoutFiles(wt)) {
    const file = `${HARNESS_DIR}/${rel}`;
    // lstat, so a link is not a file: reading or rewriting it would act on whatever it points to, from the host's side.
    const info = await lstat(join(wt, file)).catch(() => null);
    if (!info) continue;
    if (!info.isFile()) {
      out.skipped.push(file);
      continue;
    }
    const text = await readFile(join(wt, file), 'utf8').catch(() => null);
    if (text === null) continue;
    const { head, body } = splitFile(text);
    const done = rewriteBody(body, wt, o);
    let next = text;
    if (done.body !== body) {
      next = head + done.body;
      await writeFile(join(wt, file), next);
      out.rewritten.push({ file, paths: done.paths, secrets: done.secrets });
      out.paths += done.paths;
      out.secrets += done.secrets;
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
    if (!(await lstat(join(wt, file)).catch(() => null))?.isFile()) continue;
    const text = await readFile(join(wt, file), 'utf8').catch(() => null);
    const next = text === null ? null : stampText(text, commit, date);
    if (next === null || next === text) continue;
    await writeFile(join(wt, file), next);
    changed.push(file);
  }
  return changed;
}
