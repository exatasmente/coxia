// i18n-lint: allow-file what an agent reads from the memory: English by design, like the other tool texts of the engines
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_NAME, type Run } from '../../shared/runs';
import { MEMORY_LIMITS } from '../../shared/memory';
import { redact } from '../errorlog-core';
import { ISSUE_FILE, readArtifact } from '../runner/cycleFolder';

// The documents of the cycle folders as the memory sees them: a title and the headings of every Markdown document a stage produced, read from the worktrees of the newest
// runs, and the slicing of a text into sections and bounded excerpts (the roadmap file is read the same way). Nothing here keeps a copy of a document: a heading list is
// cached by path, modification time and size, the text is read again when an excerpt is asked for.

export interface Heading {
  /** 1 for `#`, up to the deepest level asked for. */
  level: number;
  title: string;
  /** Zero-based line of the heading in the text. */
  line: number;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;

/** The ATX headings of a Markdown text down to `maxLevel`, outside fenced code. Each title is one short line. */
export function headingsOf(text: string, maxLevel = 3): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  text.split('\n').forEach((raw, line) => {
    const row = raw.replace(/\r$/, '');
    const mark = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(row)?.[1];
    if (mark) {
      if (fence === null) fence = mark[0];
      else if (mark[0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const m = HEADING.exec(row);
    if (!m || m[1].length > maxLevel) return;
    out.push({ level: m[1].length, title: m[2].trim().slice(0, 120), line });
  });
  return out;
}

/** The section a heading opens: from its line to the next heading of the same or a higher level, or the end of the text. */
export function sectionText(text: string, headings: readonly Heading[], at: number): string {
  const lines = text.split('\n');
  const h = headings[at];
  let end = lines.length;
  for (let i = at + 1; i < headings.length; i++) {
    if (headings[i].level <= h.level) {
      end = headings[i].line;
      break;
    }
  }
  return lines.slice(h.line, end).join('\n').replace(/\s+$/, '');
}

/** The heading a section name points at: the exact title (case-insensitive), else a title that starts with it, else one that contains it. */
export function findSection(headings: readonly Heading[], name: string): number {
  const want = name.trim().toLowerCase();
  if (!want) return -1;
  const titles = headings.map((h) => h.title.toLowerCase());
  const exact = titles.indexOf(want);
  if (exact >= 0) return exact;
  const starts = titles.findIndex((t) => t.startsWith(want));
  return starts >= 0 ? starts : titles.findIndex((t) => t.includes(want));
}

export interface Excerpt {
  text: string;
  /** Where the excerpt starts in the section, and where the next one would (null: it reaches the end). */
  from: number;
  next: number | null;
  /** The length of the whole section. */
  total: number;
}

/** A bounded slice of a text from `from`, cut at a line break when it can be, so a long section is read in pieces and never whole by default. */
export function excerptOf(text: string, from = 0, cap: number = MEMORY_LIMITS.excerpt): Excerpt {
  const start = Number.isInteger(from) && from > 0 ? Math.min(from, text.length) : 0;
  if (text.length - start <= cap) return { text: text.slice(start), from: start, next: null, total: text.length };
  let end = start + cap;
  const nl = text.lastIndexOf('\n', end);
  if (nl > start) end = nl + 1;
  return { text: text.slice(start, end), from: start, next: end, total: text.length };
}

/** A document of a cycle folder as the index knows it. */
export interface DocumentInfo {
  runId: string;
  name: string;
  /** The first heading, else the name. */
  title: string;
  /** Every heading down to the third level, for the search. */
  headings: string[];
  at: string;
  size: number;
}

export interface DocumentIndex {
  /** The documents of the newest `MEMORY_LIMITS.docRuns` runs whose worktree is still there, `skip` (the call's own run) left out. */
  list(runs: readonly Run[], skip?: string | null): DocumentInfo[];
  /** One document, masked, or null when it is not there. */
  read(run: Run, name: string): { text: string; clipped: boolean } | null;
}

export function createDocumentIndex(): DocumentIndex {
  const cache = new Map<string, { mtimeMs: number; size: number; title: string; headings: string[] }>();

  function infoOf(run: Run, dir: string, name: string): DocumentInfo | null {
    const path = join(dir, name);
    let st;
    try {
      st = lstatSync(path);
    } catch {
      return null;
    }
    // A link is not a document the run wrote; it is left out, as everywhere in the memory.
    if (!st.isFile() || st.isSymbolicLink()) return null;
    let hit = cache.get(path);
    if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
      const doc = readArtifact(run.worktree, run.cycleFolder, name);
      const hs = doc ? headingsOf(doc.text) : [];
      hit = { mtimeMs: st.mtimeMs, size: st.size, title: redact(hs[0]?.title ?? name), headings: hs.map((h) => redact(h.title)) };
      cache.set(path, hit);
    }
    return { runId: run.id, name, title: hit.title, headings: hit.headings, at: new Date(st.mtimeMs).toISOString(), size: st.size };
  }

  return {
    list(runs, skip) {
      const out: DocumentInfo[] = [];
      const newest = [...runs].filter((r) => r.id !== skip).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      let looked = 0;
      for (const run of newest) {
        if (looked >= MEMORY_LIMITS.docRuns) break;
        const dir = join(run.worktree, run.cycleFolder);
        if (!existsSync(dir)) continue;
        looked++;
        let names: string[];
        try {
          names = readdirSync(dir).sort();
        } catch {
          continue;
        }
        for (const name of names) {
          // The issue record is the tracker's text as the agents already receive it, not something a stage produced.
          if (!ARTIFACT_NAME.test(name) || !/\.md$/i.test(name) || name === ISSUE_FILE) continue;
          const info = infoOf(run, dir, name);
          if (info) out.push(info);
        }
      }
      return out;
    },
    read: (run, name) => readArtifact(run.worktree, run.cycleFolder, name),
  };
}
