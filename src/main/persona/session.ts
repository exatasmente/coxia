import { createMaskSet, type MaskSet } from '../browser/mask';

// What one answer of the persona keeps while it is being written (#248): the message it began from and the door that message came by, the values it must never write back (a
// secret it read, or was given to set), the last things it read, and how many act lines it has put in the thread. In memory, for the length of the answer.

/** The persona's own read results of an answer that a later write may be recorded with, as short masked excerpts. */
export interface ReadRecord {
  tool: string;
  op: string;
  target: string;
  excerpt: string;
}

/** The reads kept per answer; a write is recorded with the eight most relevant of them. */
export const READS_KEPT = 40;
/** The act lines one answer puts in the thread; the rest are counted. */
export const ACT_LINES_MAX = 30;

export interface AnswerSession {
  /** The persona's id and its conversation. */
  persona: string;
  thread: string;
  /** The `seq` of the person's message the answer began from. */
  seq: number;
  /** How that message came in: `window`, `paired`, `terminal`, or `schedule` for a turn a schedule started (#275). */
  door: string;
  mask: MaskSet;
  /** A value the answer must never write back, by its exact text: everything stored or shown from it holds the masked form from now on. */
  maskValue(value: string): void;
  /** The text with the answer's values masked. Never throws; a mask that fails withholds the whole text. */
  maskText(text: string): string;
  reads: ReadRecord[];
  remember(read: ReadRecord): void;
  acts: { lines: number; more: number };
}

export function createSession(o: { persona: string; thread: string; seq: number; door: string }): AnswerSession {
  const mask = createMaskSet();
  const values = new Set<string>();
  mask.add((text) => [...values].reduce((out, v) => out.split(v).join('[secret]'), text));
  const reads: ReadRecord[] = [];
  return {
    ...o,
    mask,
    maskValue(value) {
      if (value) values.add(value);
    },
    maskText: (text) => mask.apply(text) ?? '[withheld]',
    reads,
    remember(read) {
      reads.push(read);
      if (reads.length > READS_KEPT) reads.splice(0, reads.length - READS_KEPT);
    },
    acts: { lines: 0, more: 0 },
  };
}
