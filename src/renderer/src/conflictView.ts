import type { ConflictHunk } from '../../shared/conflict';

export type LineKind = 'ours' | 'theirs' | 'new' | 'plain';
export interface ViewLine {
  text: string;
  kind: LineKind;
}

const split = (text: string): string[] => (text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/));

// Branch or main: a line is highlighted when the common ancestor does not have it (what that side added). Without an
// ancestor nothing is guessed: every line is plain.
export function sideLines(text: string, base: string | null, side: 'ours' | 'theirs'): ViewLine[] {
  const known = base === null ? null : new Set(split(base));
  return split(text).map((t) => ({ text: t, kind: known && !known.has(t) ? side : 'plain' }));
}

// The proposal: where each line came from, so a line that neither side wrote stands out.
export function proposalLines(proposal: string, h: Pick<ConflictHunk, 'ours' | 'theirs'>): ViewLine[] {
  const ours = new Set(split(h.ours));
  const theirs = new Set(split(h.theirs));
  return split(proposal).map((t) => ({ text: t, kind: ours.has(t) && theirs.has(t) ? 'plain' : ours.has(t) ? 'ours' : theirs.has(t) ? 'theirs' : 'new' }));
}

export const KIND_MARK: Record<LineKind, string> = { ours: '+', theirs: '+', new: '~', plain: ' ' };
