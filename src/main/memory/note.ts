import { createHash } from 'node:crypto';
import { MEMORY_LIMITS, NOTE_ID, isNoteKind, type NoteKind } from '../../shared/memory';

// The file of a note: plain text with a short header, so the person edits it comfortably. Pure: no disk, no Electron.
//
//   ---
//   id: m-3fa91c02
//   kind: decision
//   title: Use the queue for retries
//   by: developer
//   at: 2026-10-09T10:00:00.000Z
//   revision: 2
//   reviewed: true
//   activity: app#101        (optional)
//   repo: api                (optional)
//   ---
//   The text.
//
// The header is for whoever reads the file. The app writes it from what it knows and reads it back only to show it, never to decide: who may replace or remove a note,
// whether the person took it over and whether it waits for review live in the state file beside the notes (store.ts), so a header somebody rewrote decides nothing.

const FENCE = '---';
const HEADER_KEYS = ['id', 'kind', 'title', 'by', 'at', 'revision', 'reviewed', 'activity', 'repo'] as const;
type HeaderKey = (typeof HEADER_KEYS)[number];

/** What the header of a file claims. Every value is a string as written, before any check. */
export type HeaderClaims = Partial<Record<HeaderKey, string>>;

export interface NoteHeader {
  id: string;
  kind: NoteKind;
  title: string;
  /** The agent, or `person` once the person edited the text. */
  by: string;
  at: string;
  revision: number;
  reviewed: boolean;
  activity?: string;
  repo?: string;
}

/** The file as the app writes it. */
export function renderNote(h: NoteHeader, text: string): string {
  const lines = [FENCE, `id: ${h.id}`, `kind: ${h.kind}`, `title: ${h.title}`, `by: ${h.by}`, `at: ${h.at}`, `revision: ${h.revision}`, `reviewed: ${h.reviewed}`];
  if (h.activity) lines.push(`activity: ${h.activity}`);
  if (h.repo) lines.push(`repo: ${h.repo}`);
  lines.push(FENCE, text, '');
  return lines.join('\n');
}

/** The hash the state keeps of a file: any change made outside the app moves it. */
export const shaOf = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export type Parsed =
  | { status: 'not-note' }
  | { status: 'ok'; claims: HeaderClaims; body: string };

/**
 * A file as a note, or not. It is not a note when it has no header, no id, or an id that is not the file's name; such a file is left out of every list and never read,
 * repaired or removed. Whether the rest of the header and the text are acceptable is `problemsOf`: a file with a broken kind or title is still a note, the person's to fix.
 */
export function parseNote(raw: string, fileId: string): Parsed {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith(`${FENCE}\n`)) return { status: 'not-note' };
  const end = text.indexOf(`\n${FENCE}`, FENCE.length);
  if (end < 0) return { status: 'not-note' };
  const after = text.slice(end + 1 + FENCE.length);
  // The closing fence is a line of its own: `---` followed by a line break or the end of the file, never `----`.
  if (after !== '' && !after.startsWith('\n')) return { status: 'not-note' };
  const claims: HeaderClaims = {};
  for (const line of text.slice(FENCE.length + 1, end).split('\n')) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    const key = line.slice(0, at).trim() as HeaderKey;
    if ((HEADER_KEYS as readonly string[]).includes(key) && claims[key] === undefined) claims[key] = line.slice(at + 1).trim();
  }
  if (claims.id !== fileId || !NOTE_ID.test(claims.id)) return { status: 'not-note' };
  return { status: 'ok', claims, body: after.replace(/^\n/, '').replace(/\n$/, '') };
}

const ONE_LINE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\u{E0000}-\u{E007F}]{1,80}$/u;

/** A value of the optional `activity` and `repo` fields: one short line. Anything else is dropped from the view, never repaired. */
export const shortLine = (v: string | undefined): string | undefined => (v !== undefined && ONE_LINE.test(v) ? v : undefined);

/**
 * What is wrong with a note the header and the text can be seen to have, as codes (no values): the kind is not one of the kinds, the title is empty or too long, the text
 * is empty or too long. A person's edit outside the app can cause any of them; the note is then left out of what the agents read.
 */
export function problemsOf(claims: HeaderClaims, body: string): string[] {
  const out: string[] = [];
  if (!isNoteKind(claims.kind)) out.push('kind');
  const title = claims.title ?? '';
  if (!title || title.length > MEMORY_LIMITS.title) out.push('title');
  if (!body.trim() || body.length > MEMORY_LIMITS.note) out.push('text');
  return out;
}
