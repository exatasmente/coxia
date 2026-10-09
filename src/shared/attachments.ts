// A file a person attached to a forum message. The bytes live in the workspace's own data folder, one folder per conversation
// (main/attachments.ts); this module is the wire shape and the pure content recognizer, shared by the main process, the renderer and the tests.
// The kind is decided by the content, never by the name the person gave the file: a name is data, shown to the person and never a path.

// `video` is the app's own: the recording of an agent's screen in a conversation. It is never recognised from a person's file (`detectAttachmentKind` knows no video, so a WebM a
// person attaches is refused as before) and it is stored only through the app's own door (`putVideo` of main/attachments.ts).
export const ATTACHMENT_KINDS = ['image', 'text', 'pdf', 'json', 'csv', 'video'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** One file of a message: an id inside its conversation, the name the person gave it, the kind the content revealed and its size. */
export interface AttachmentRef {
  id: string;
  name: string;
  kind: AttachmentKind;
  bytes: number;
  /** The retention sweep took the file away: the message keeps the ref, to say so, and nothing opens it. */
  removed?: true;
}

/** The limits of a workspace; a fresh install gets these, and the workspace may change them (config `attachments`). */
export const ATTACHMENT_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  otherBytes: 1 * 1024 * 1024,
  messageBytes: 10 * 1024 * 1024,
  perMessage: 10,
} as const;

export interface AttachmentLimits {
  imageBytes: number;
  otherBytes: number;
  messageBytes: number;
  perMessage: number;
}

/** The name of the read-only tool a called agent opens an attachment with, on both engines. */
export const ATTACHMENT_TOOL = 'ConversationAttachment';

/** The tool a called agent uses: it names one file by its ref (the id the message's warning carries), never a path on the computer. */
export const ATTACHMENT_TOOL_DEF = {
  name: ATTACHMENT_TOOL,
  // i18n-ignore: prompt and tool text the engines send the model: English by design
  description:
    'Opens one file the person attached to a message of this conversation. ref is the id that the message lists, never a path. An image comes back as an image, a text as text (offset and limit are line numbers); a PDF, JSON or CSV comes back with the reason it does not go to the model. Read only.',
  parameters: {
    type: 'object',
    properties: {
      // i18n-ignore-start: prompt and tool texts the engines send the model: English by design
      ref: { type: 'string', description: 'Id of the attachment, as the message lists it' },
      offset: { type: 'integer', description: 'First line to read (1-based), text only' },
      limit: { type: 'integer', description: 'Number of lines to read, text only' },
      // i18n-ignore-end
    },
    required: ['ref'],
  },
} as const;

/** Most of a text attachment that goes to the model: the rest is cut, and the tool says so. */
export const TEXT_MODEL_MAX = 100_000;

const IMAGE_EXT: Record<string, string> = { image: '.img' };

/** The extension of the file on disk, from the kind the content revealed: the name the person gave it never reaches the path. */
export const attachmentExt = (kind: AttachmentKind): string =>
  kind === 'image' ? '.img' : kind === 'pdf' ? '.pdf' : kind === 'json' ? '.json' : kind === 'csv' ? '.csv' : kind === 'video' ? '.webm' : '.txt';

/** The catalog key of the kind's label. */
export const kindLabelKey = (kind: AttachmentKind): string => `main.attachment.kind.${kind}`;

// ---- the kind by content ---------------------------------------------------------------------------------------------------------------

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0): boolean => sig.every((b, i) => bytes[at + i] === b);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38]; // GIF8
// A ZIP container (PK\x03\x04), and its empty variant (PK\x05\x06): Office documents arrive as a ZIP and are refused.
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];

/** Whether the head looks like a binary the app refuses (a NUL in the first bytes, which no accepted text has). */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/** The head as text (UTF-8 is tried by the caller); a byte outside the range text keeps makes the candidate fail. */
function headText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
}

/** JSON when the text begins with `{`/`[` and parses; the caller passes the whole text when it has it, the head otherwise. */
function looksJson(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** CSV when there are at least two lines, every one with the same number of comma-separated fields and a comma somewhere. */
function looksCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return false;
  const fields = lines.slice(0, 50).map((l) => l.split(',').length);
  return fields[0] >= 2 && fields.every((n) => n === fields[0]);
}

/**
 * The kind of an attachment, decided by its content: an image by its signature, a PDF by `%PDF-`, anything else only when it reads as text
 * (JSON and CSV by their own shape, plain text otherwise). A ZIP/Office container and any binary are refused with `null`, whatever the name says.
 * `head` need not be the whole file: the caller passes the first bytes, and the text shape is judged from them.
 */
export function detectAttachmentKind(head: Uint8Array): AttachmentKind | null {
  if (startsWith(head, PNG) || startsWith(head, JPEG) || startsWith(head, GIF)) return 'image';
  // WebP is RIFF....WEBP
  if (head.length >= 12 && startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image';
  if (startsWith(head, PDF)) return 'pdf';
  if (startsWith(head, ZIP) || startsWith(head, ZIP_EMPTY)) return null;
  if (looksBinary(head)) return null;
  const text = headText(head);
  if (looksJson(text)) return 'json';
  if (looksCsv(text)) return 'csv';
  return 'text';
}

/** The name as data: no control character, trimmed, at most 200 characters; empty names fall back to a neutral one. */
export function cleanAttachmentName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}

/** The size a person reads: "4.2 MB", "12 kB", "830 B". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export { IMAGE_EXT };
