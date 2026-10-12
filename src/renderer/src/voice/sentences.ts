// Splits an answer into the sentences that can already be spoken while it is still being written. Pure on purpose: the chat feeds it the live text as it grows.
// A sentence is complete at a terminator followed by a space (so "3.5" and a sentence cut mid-word wait), or at a line break. A fenced code block is one unit, given
// out when it closes; the main process turns it into its spoken sentence (speakable), so nothing of the code is read.

const TERMINATORS = new Set(['.', '!', '?', '…']);
// What may follow a terminator and still belong to the sentence: more terminators, closing quotes and brackets, emphasis marks.
const TRAILERS = new Set(['.', '!', '?', '…', '"', "'", '”', '’', ')', ']', '*', '_']);
// Words whose dot is not the end of a sentence (lowercase, without the dot). "etc" is left out: it ends sentences as often as not.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'mr', 'mrs', 'ms', 'dr', 'sr', 'sra', 'srta', 'dra', 'prof', 'vs', 'p.ex', 'nº', 'st', 'av', 'approx', 'aprox', 'fig', 'cf']);
const FENCE = '```';

export interface Sentences {
  sentences: string[];
  /** Where the next call starts: everything before it was given out. */
  next: number;
}

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/** The word right before `at` (where a dot is), lowercased: "e.g" for "e.g.", "3" for "3.". */
function wordBefore(text: string, at: number): string {
  let i = at;
  while (i > 0 && !isSpace(text[i - 1]) && text[i - 1] !== '(') i--;
  return text.slice(i, at).toLowerCase().replace(/^[*_"'“‘]+/, '');
}

function abbreviation(text: string, at: number): boolean {
  const word = wordBefore(text, at);
  if (!word) return false;
  if (ABBREVIATIONS.has(word)) return true;
  // an initial ("J. Smith") or a list number ("1. First"): a single letter, or digits alone
  if (/^\p{Lu}$/u.test(text.slice(at - 1, at)) && word.length === 1) return true;
  return /^\d{1,3}$/.test(word);
}

/**
 * The complete sentences of `text` from `from` on. `final`: the answer is whole, so what is left is given out too, terminator or not.
 * Feeding the text a character at a time gives the same sentences as feeding it at once.
 */
export function nextSentences(text: string, from: number, opts: { final?: boolean } = {}): Sentences {
  const out: string[] = [];
  let start = from;
  let i = from;
  const emit = (end: number) => {
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  };
  while (i < text.length) {
    if (text.startsWith(FENCE, i)) {
      const close = text.indexOf(FENCE, i + FENCE.length);
      if (close < 0) break;
      // what came before the block is a sentence of its own
      emit(i);
      let end = close + FENCE.length;
      while (end < text.length && text[end] !== '\n') end++;
      if (end >= text.length && !opts.final) break;
      emit(end);
      i = end;
      continue;
    }
    const c = text[i];
    if (c === '\n') {
      emit(i + 1);
      i++;
      continue;
    }
    if (TERMINATORS.has(c)) {
      let end = i + 1;
      while (end < text.length && TRAILERS.has(text[end])) end++;
      if (end >= text.length) break;
      if (isSpace(text[end]) && !(c === '.' && abbreviation(text, i))) {
        emit(end);
        i = end;
        continue;
      }
      i = end;
      continue;
    }
    i++;
  }
  if (opts.final) {
    emit(text.length);
    return { sentences: out, next: text.length };
  }
  return { sentences: out, next: start };
}
