// The questions an agent asked: the list items of SEARCH_REQUESTS.md, without repeats, and without the ones WEB_SEARCH.md already answered.

/** The most characters one question keeps. */
export const QUESTION_MAX = 300;

/** The list items of a request file ("- question" or "* question"), trimmed, deduplicated, in order. */
export function questionsOf(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const q = m[1].slice(0, QUESTION_MAX);
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}

/** The questions the document already answers: its section headings ("## question"). */
export function answeredIn(document) {
  const out = [];
  for (const line of String(document ?? '').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The new questions to search this time: the asked ones the document does not answer yet, at most `max`. */
export function newQuestions(requests, document, max) {
  const done = new Set(answeredIn(document));
  return questionsOf(requests).filter((q) => !done.has(q)).slice(0, max);
}
