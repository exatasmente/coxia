import { MEMORY_LIMITS, type NoteKind, type NoteSummary } from './memory';

// What the Memory view reads from the app: every folder, a line per note for the list, one note in full. The same shapes serve the desktop window and a paired browser, which
// has the same capabilities over the memory (the writes answer with `NoteWrite`). Pure: the main side builds them from the store, the renderer filters and groups what it got.

/** The module event the app sends when the memory changes (a note written, edited or removed, a folder made), so an open screen reads again. Nothing travels in it. */
export const MEMORY_EVENT = 'memory-changed';

/** A note as the list shows it: what the store knows, and whether it is old and its agent left the team. Never its text. */
export interface NoteItem extends NoteSummary {
  /** Not changed for 90 days: shown as old, never removed. */
  old: boolean;
  /** The agent of its folder is no longer in the team: the notes are the team's history, and the person removes them when they want. */
  left: boolean;
}

/** One folder: an agent called in a conversation. Empty ones are listed too. */
export interface MemoryFolder {
  conversation: string;
  agent: string;
  /** The conversation's title when the app knows the thread; the id otherwise. */
  title: string;
  left: boolean;
}

export interface MemoryListView {
  /** The workspace's switch: off, agents neither read nor write, and the view still works. */
  enabled: boolean;
  folders: MemoryFolder[];
  items: NoteItem[];
  /** Files and folders in the memory that are not notes: never read, repaired or removed. */
  skipped: number;
}

export type NoteGet = { status: 'ok'; note: NoteItem; text: string } | { status: 'missing' };

/** What a write by the person answers: the note as stored, or why not. */
export type NoteWrite = { ok: true; note: NoteItem } | { ok: false; code: string; text: string; refusals?: { field: string; code: string; text: string }[] };

export type NoteRemove = { ok: true } | { ok: false; code: string; text: string };

/** What the person changes in a note: the fields they edited. */
export interface NotePatch {
  title?: string;
  text?: string;
  kind?: NoteKind;
}

export const OLD_AFTER_MS = MEMORY_LIMITS.old * 24 * 60 * 60 * 1000;

export const isOldNote = (at: string, now: number): boolean => {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t > OLD_AFTER_MS;
};
