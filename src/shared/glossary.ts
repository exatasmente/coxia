// i18n-lint: allow-file the default glossary is data: phonetic spellings of terms for the pt-BR voice, edited by the user on the Glossary screen
// Glossary of terms for both directions of the voice: how the synthesized voice says a term,
// and how the transcription usually mishears it (fixed back to the term).

import { getTerms } from './i18n';
import type { VoiceEngine } from './types';

export interface Term {
  term: string;
  // empty: the voice reads the term as written
  say: string;
  // Kokoro reads English words worse than Edge: when set it replaces `say` for that engine
  sayKokoro?: string;
  // variants the transcription produces, replaced by the term
  heard: string[];
}

export const DEFAULT_GLOSSARY: Term[] = [
  { term: 'QA', say: 'quiu ei', heard: ['Q&A', 'Q.A.', 'kiu ei', 'quiu ei'] },
  { term: 'MR', say: '', heard: ['M.R.', 'emerre', 'eme erre'] },
  { term: 'merge', say: '', heard: ['merdi', 'mérgi', 'mergi', 'merdj'] },
  { term: 'deploy', say: '', heard: ['deploi', 'diploy', 'diplói'] },
  { term: 'pipeline', say: '', sayKokoro: 'páipilaine', heard: ['pipe line', 'paipline', 'paipelaine', 'Pipelini'] },
  { term: 'hotfix', say: '', heard: ['hot fix', 'rótfix', 'Otifix', 'WatchFix'] },
  { term: 'rebase', say: '', heard: ['ribeis', 'rebeis'] },
  { term: 'Gate', say: '', sayKokoro: 'gueite', heard: ['gueite', 'guêit', 'GAT'] },
  { term: 'pré-daily', say: '', heard: ['pre daily', 'pré deili', 'pré-deili', 'predale'] },
  { term: 'daily', say: '', heard: ['deili', 'Daili'] },
  { term: 'GitLab', say: '', heard: ['git lab', 'guitlab', 'JitLab', 'githlab'] },
  { term: 'Claude Code', say: '', heard: ['cloud code', 'clod code', 'clode code', 'cloud codi'] },
];

const MAX_TERMS = 300;
const MAX_LEN = 80;
const MAX_HEARD = 12;
const HINT_CHARS = 600;
const WORD = '[\\p{L}\\p{N}_-]';

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-term match: "api" does not match inside "apix", "MR" not inside "MRs" nor "SMR".
function termRegex(s: string): RegExp {
  return new RegExp(`(?<!${WORD})${escape(s)}(?!${WORD})`, 'giu');
}

function byLength<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => key(b).length - key(a).length);
}

// Placeholders keep a replacement from being matched again by a shorter term ("pré-daily" then "daily").
function replaceAll(text: string, pairs: { from: string; to: string }[]): string {
  const done: string[] = [];
  let out = text;
  for (const { from, to } of byLength(pairs, (p) => p.from)) {
    out = out.replace(termRegex(from), () => {
      done.push(to);
      return `\u0000${done.length - 1}\u0000`;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => done[Number(i)]);
}

export function pronunciation(t: Term, engine: VoiceEngine): string {
  return ((engine === 'kokoro' ? t.sayKokoro?.trim() : '') || t.say).trim();
}

/** How a ref of a change request is written and said on the workspace's host: "web!202" and "MR 202" on GitLab. */
export interface RefWords {
  noun: string;
  mark: string;
  /**
   * On a host that marks a change request with "#" an issue is written the same way ("app#12"), so a ref reads as a change request only when it
   * is known to be one ("app#7" in this list); any other "repo#N" is read neutrally, "app, 12".
   */
  known?: readonly string[];
}

const currentRefWords = (): RefWords => ({ noun: getTerms().words.cr, mark: getTerms().words.crMark });

export function spoken(text: string, terms: Term[], engine: VoiceEngine, ref: RefWords = currentRefWords()): string {
  let refs: string;
  if (ref.mark === '#') {
    // "app#7" is "app, PR 7" when it is known to be a PR and "app, 7" otherwise; a bare "#101" is the issue, which reads as "101".
    const known = new Set(ref.known ?? []);
    refs = text.replace(/(\S*)#(\d+)/g, (_, prefix: string, n: string) => {
      if (!prefix) return n;
      return `${prefix}, ${known.has(`${prefix.replace(/^\W+/, '')}#${n}`) ? `${ref.noun} ` : ''}${n}`;
    });
  } else {
    // A ref of a repository ("web!202") reads as "web, MR 202" and a bare one as "MR 202"; "#101" as "101".
    refs = text
      .replace(/(\S)!(\d+)/g, `$1, ${ref.noun} $2`)
      .replace(/(^|\s)!(\d+)/g, `$1${ref.noun} $2`)
      .replace(/#(\d+)/g, '$1');
  }
  return replaceAll(
    refs,
    terms.filter((t) => pronunciation(t, engine)).map((t) => ({ from: t.term, to: pronunciation(t, engine) })),
  );
}

export function corrected(text: string, terms: Term[]): string {
  return replaceAll(
    text,
    terms.flatMap((t) => t.heard.filter((h) => h.trim()).map((h) => ({ from: h.trim(), to: t.term }))),
  );
}

// Whisper's initial prompt biases the spelling of what it hears; it only reads its last ~224 tokens.
export function whisperHint(terms: Term[]): string {
  let hint = 'Pré-daily.';
  for (const t of terms) {
    const next = `${hint} ${t.term},`;
    if (next.length > HINT_CHARS) break;
    hint = next;
  }
  return hint.replace(/,$/, '.');
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_LEN) : '';
}

export function sanitizeGlossary(input: unknown): Term[] {
  if (!Array.isArray(input)) return DEFAULT_GLOSSARY;
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const raw of input.slice(0, MAX_TERMS)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const term = clean(r.term);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const heard = (Array.isArray(r.heard) ? r.heard : [])
      .map(clean)
      .filter((h) => h && h.toLowerCase() !== term.toLowerCase())
      .slice(0, MAX_HEARD);
    const sayKokoro = clean(r.sayKokoro);
    out.push(sayKokoro ? { term, say: clean(r.say), sayKokoro, heard } : { term, say: clean(r.say), heard });
  }
  return out;
}
