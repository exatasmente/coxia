import { t } from '../shared/i18n';
// Pure text handling for merge conflicts: parse the markers git leaves in a file (merge or diff3 style) and put
// the chosen text back in their place.

export interface Region {
  ours: string;
  base: string | null;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
}

export type Segment = { text: string } | { conflict: Region };

const OPEN = /^<{7}(?: (.*?))?\r?$/;
const BASE = /^\|{7}(?: .*?)?\r?$/;
const MID = /^={7}\r?$/;
const CLOSE = /^>{7}(?: (.*?))?\r?$/;

// Keeps each line's own terminator, so CRLF files and a missing final newline survive the round trip.
function lines(text: string): string[] {
  return text.split(/(?<=\n)/).filter((l) => l !== '');
}

const bare = (line: string): string => line.replace(/\r?\n$/, '');

export function parseConflicts(text: string): Segment[] {
  const out: Segment[] = [];
  let plain: string[] = [];
  let region: { ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; where: 'ours' | 'base' | 'theirs' } | null = null;
  let n = 0;

  for (const line of lines(text)) {
    const b = bare(line);
    if (!region) {
      const m = OPEN.exec(b);
      if (!m) {
        plain.push(line);
        continue;
      }
      if (plain.length) out.push({ text: plain.join('') });
      plain = [];
      region = { ours: [], base: null, theirs: [], oursLabel: m[1] ?? '', where: 'ours' };
      n++;
      continue;
    }
    if (region.where === 'ours' && BASE.test(b)) {
      region.where = 'base';
      region.base = [];
    } else if (region.where !== 'theirs' && MID.test(b)) {
      region.where = 'theirs';
    } else if (region.where === 'theirs' && CLOSE.test(b)) {
      out.push({
        conflict: {
          ours: region.ours.join(''),
          base: region.base ? region.base.join('') : null,
          theirs: region.theirs.join(''),
          oursLabel: region.oursLabel,
          theirsLabel: CLOSE.exec(b)?.[1] ?? '',
        },
      });
      region = null;
    } else if (OPEN.test(b) && region.where !== 'theirs') {
      throw new Error(t('main.conflict.nestedMarker', { n }));
    } else if (region.where === 'ours') region.ours.push(line);
    else if (region.where === 'base') region.base?.push(line);
    else region.theirs.push(line);
  }
  if (region) throw new Error(t('main.conflict.unclosedHunk', { n }));
  if (plain.length) out.push({ text: plain.join('') });
  return out;
}

export function regions(segments: Segment[]): Region[] {
  return segments.flatMap((s) => ('conflict' in s ? [s.conflict] : []));
}

// `pick` returns the text for the n-th region (0-based), already with its line terminators.
export function resolveSegments(segments: Segment[], pick: (index: number) => string): string {
  let i = 0;
  return segments.map((s) => ('conflict' in s ? pick(i++) : s.text)).join('');
}

const OPEN_LINE = /^<{7}(?: .*)?\r?$/m;
const CLOSE_LINE = /^>{7}(?: .*)?\r?$/m;

// An opening or closing marker is enough: a lone "=======" is also a valid markdown heading underline.
export function hasMarkers(text: string): boolean {
  return OPEN_LINE.test(text) || CLOSE_LINE.test(text);
}

// A resolved text ends where a line ends, in the file's own line ending (empty stays empty).
export function withTerminator(text: string, like: string): string {
  if (text === '' || text.endsWith('\n')) return text;
  return text + (like.includes('\r\n') ? '\r\n' : '\n');
}
