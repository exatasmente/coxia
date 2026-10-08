import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS_FILE } from '../../shared/harness/agentsMd';
import { rewriteLocal } from '../../shared/runs/comment';
import { git } from '../conflictGit';

// Rewrites sensitive local details from AGENTS.md before the runner commits it.

export interface Rewrite {
  /** Path of the file, relative to the worktree. */
  file: string;
  paths: number;
  secrets: number;
}

export interface Finalized {
  rewritten: Rewrite[];
  paths: number;
  secrets: number;
  skipped: string[];
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

/** Rewrites AGENTS.md only when it changed in the current worktree. */
export async function finalizeHarness(wt: string, o: FinalizeOptions): Promise<Finalized> {
  const out: Finalized = { rewritten: [], paths: 0, secrets: 0, skipped: [] };
  const result = await git(wt, ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--', AGENTS_FILE], { fail: false });
  if (result.code !== 0 || !result.stdout.trim()) return out;
  const entry = result.stdout.split('\0').find((item) => item.length >= 4 && !item.slice(0, 2).includes('D'));
  if (!entry) return out;
  const file = entry.slice(3);
  const info = await lstat(join(wt, file)).catch(() => null);
  if (!info) return out;
  if (!info.isFile()) {
    out.skipped.push(file);
    return out;
  }
  const text = await readFile(join(wt, file), 'utf8').catch(() => null);
  if (text === null) return out;
  const done = rewriteBody(text, wt, o);
  if (done.body === text) return out;
  await writeFile(join(wt, file), done.body);
  out.rewritten.push({ file, paths: done.paths, secrets: done.secrets });
  out.paths = done.paths;
  out.secrets = done.secrets;
  return out;
}
