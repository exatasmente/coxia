// Teaching the glossary from a corrected transcription: word diff between what the recognizer heard and what the user meant.

import { type Term, sanitizeGlossary } from './glossary';

export interface Correction {
  heard: string;
  term: string;
}

const MAX_RUN = 4;
const MIN_HEARD = 3;
const MAX_HEARD = 12;

function words(text: string): { shown: string; key: string }[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[,;:!?)"'»”]+$/u, ''))
    // "M.R." keeps its last dot; an ordinary word loses the sentence punctuation
    .map((w) => (/^(?:\p{L}\.)+$/u.test(w) ? w : w.replace(/[^\p{L}\p{N}]+$/u, '')))
    .filter(Boolean)
    .map((shown) => ({ shown, key: shown.toLowerCase() }));
}

// Longest common subsequence table, filled from the end so the walk below goes forward.
function lcs(a: string[], b: string[]): number[][] {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  return t;
}

/**
 * What the user changed, as heard -> term pairs. Adjacent changed words form one pair ("pipe line" -> "pipeline").
 * Case and punctuation do not count; pure insertions or deletions and rewrites of more than a few words are not
 * mishearings, so they are left out.
 */
export function diffCorrections(heard: string, fixed: string): Correction[] {
  const a = words(heard);
  const b = words(fixed);
  const t = lcs(
    a.map((w) => w.key),
    b.map((w) => w.key),
  );
  const out: Correction[] = [];
  let i = 0;
  let j = 0;
  let from = i;
  let to = j;
  const flush = () => {
    const was = a.slice(from, i).map((w) => w.shown);
    const now = b.slice(to, j).map((w) => w.shown);
    if (was.length && was.length <= MAX_RUN && now.length && now.length <= MAX_RUN) {
      out.push({ heard: was.join(' '), term: now.join(' ') });
    }
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].key === b[j].key) {
      flush();
      i++;
      j++;
      from = i;
      to = j;
    } else if (j >= b.length || (i < a.length && t[i + 1][j] >= t[i][j + 1])) {
      i++;
    } else {
      j++;
    }
  }
  flush();
  return out.filter((c) => c.heard.length >= MIN_HEARD && c.heard.toLowerCase() !== c.term.toLowerCase());
}

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

export function isKnown(terms: Term[], c: Correction): boolean {
  return terms.some((t) => same(t.term, c.term) && t.heard.some((h) => same(h, c.heard)));
}

// Only what the glossary does not already know.
export function newCorrections(terms: Term[], heard: string, fixed: string): Correction[] {
  return diffCorrections(heard, fixed).filter((c) => !isKnown(terms, c));
}

/**
 * Adds the variant to its term, creating the term when it is new. A variant belongs to one term: it leaves any other
 * that had it. When a term is full the oldest variant makes room.
 */
export function learn(terms: Term[], c: Correction): Term[] {
  const heard = c.heard.trim();
  const term = c.term.trim();
  const without = terms.map((t) => (same(t.term, term) ? t : { ...t, heard: t.heard.filter((h) => !same(h, heard)) }));
  const at = without.findIndex((t) => same(t.term, term));
  if (at < 0) return sanitizeGlossary([...without, { term, say: '', heard: [heard] }]);
  const current = without[at];
  if (current.heard.some((h) => same(h, heard))) return without;
  const next = [...current.heard, heard].slice(-MAX_HEARD);
  return sanitizeGlossary(without.map((t, k) => (k === at ? { ...t, heard: next } : t)));
}
