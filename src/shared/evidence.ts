// Evidence: a file a stage kept as proof of what it saw, with its marks. Pure and Electron-free, because both the renderer and the main process read the same
// shapes; the store (main/evidence/store.ts) and the drawing (main/evidence/draw.ts) live in the main process.

/** Where a stage's evidence is kept, as the runner's choice: the safe default when the field is absent (a config stored before it existed). */
export const evidencePlacementOf = (runner: { evidence?: string } | null | undefined): 'app' | 'cycle' => (runner?.evidence === 'cycle' ? 'cycle' : 'app');

/** Kinds of a file the app accepts as evidence, recognised by its content (never by the name or the extension). */
export const EVIDENCE_KINDS = ['png', 'jpeg', 'gif', 'webp', 'pdf', 'text'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The formats a piece of evidence may be, as a person reads them. */
export const EVIDENCE_KIND_MEDIA: Record<EvidenceKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  text: 'text/plain',
};

/** The extension each kind is stored under: the content decides it, never the name the model gave. */
export const EVIDENCE_EXT: Record<EvidenceKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', pdf: 'pdf', text: 'txt' };

/** Whether the kind is an image, the only ones the marking tool draws on and the code host may embed. */
export const isEvidenceImage = (kind: EvidenceKind): boolean => kind === 'png' || kind === 'jpeg' || kind === 'gif' || kind === 'webp';

/** The bytes as a `data:` address. The desktop's content policy lets an image come from `data:` but not from `blob:` (the paired browser allows both), so an image of
 *  evidence is shown this way. */
export function evidenceDataUrl(bytes: ArrayBuffer | Uint8Array, media: string): string {
  const all = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // The native encoder takes a few milliseconds for 8 MiB where the string path takes a third of a second; an older paired browser has only the string path.
  const native = (all as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return `data:${media};base64,${native.call(all)}`;
  let binary = '';
  // In slices: spreading millions of bytes as arguments overflows the call stack.
  for (let i = 0; i < all.length; i += 0x8000) binary += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return `data:${media};base64,${btoa(binary)}`;
}

/** The largest file the app keeps as evidence. A constant of the code, not a setting: above it the tool refuses and says the ceiling. */
export const EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;

/** The id of a piece of evidence: `ev-<digits>`, stable inside a run and never reused. */
export const EVIDENCE_ID = /^ev-\d{1,6}$/;

export const isEvidenceId = (value: unknown): value is string => typeof value === 'string' && EVIDENCE_ID.test(value);

/** One file a stage kept. `from` names the evidence this one was made from (a marked image), so a chain of versions is walkable. */
export interface EvidenceRecord {
  id: string;
  /** The stage that kept it. */
  stage: string;
  /** The agent that kept it. */
  by: string;
  title: string;
  /** Optional short text under the title. */
  description: string;
  /** The name the agent gave the file, for display only: the file on disk is named after the id. */
  name: string;
  kind: EvidenceKind;
  bytes: number;
  at: string;
  /** The evidence this one came from, for the image a marking produced; null for one taken from the output folder. */
  from: string | null;
  /** The forum message it was published as an attachment of. */
  message: number | null;
  /** The file was also copied into the cycle folder and committed with the stage. */
  inCycle?: boolean;
}

/** What the run screen lists for one piece of evidence: the record plus where its bytes may be read. */
export interface EvidenceView extends EvidenceRecord {
  /** Platform-independent media type of the file. */
  media: string;
}

export const evidenceViewOf = (r: EvidenceRecord): EvidenceView => ({ ...r, media: EVIDENCE_KIND_MEDIA[r.kind] });

/** What the code host is told about one piece of the evidence an agent cited: the bytes go up, the title reads underneath. */
export interface EvidenceUpload {
  id: string;
  name: string;
  media: string;
  bytes: Uint8Array;
  title: string;
}

/** The largest piece of evidence an upload to the code host carries; above it the piece stays in the app and the comment says how many there are. */
export const EVIDENCE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

const EVIDENCE_KIND_OF_MEDIA: Record<string, EvidenceKind> = Object.fromEntries(Object.entries(EVIDENCE_KIND_MEDIA).map(([k, v]) => [v, k as EvidenceKind]));

/** The name an upload carries: the evidence id and the extension the kind was stored under, so the host is never told a name the agent made up. */
export const uploadNameOf = (e: Pick<EvidenceUpload, 'id' | 'media'>): string => {
  const kind = EVIDENCE_KIND_OF_MEDIA[e.media];
  return kind ? `${e.id}.${EVIDENCE_EXT[kind]}` : e.id;
};

/** Whether an upload is small enough and honest enough to be sent: only images the app accepted, under the ceiling. */
export const isUploadable = (e: Pick<EvidenceUpload, 'media' | 'bytes'>): boolean => e.media.startsWith('image/') && e.bytes.length > 0 && e.bytes.length <= EVIDENCE_UPLOAD_MAX_BYTES;

/**
 * The body a comment is sent with when it cites pieces of evidence: every uploaded image is embedded under the text, in the order it was cited, and the
 * pieces the host could not take are counted in a line instead of being dropped without a word.
 */
export function withEvidenceImages(body: string, uploaded: readonly { title: string; url: string }[], missing: number): string {
  const embed = uploaded.map((u) => `![${u.title}](${u.url})`);
  const tail = missing > 0 ? `_${missing} piece(s) of evidence stay in the app._` : '';
  return [body, ...embed, tail].filter(Boolean).join('\n\n');
}

/** The marks the marking tool draws, in pixels of the image. */
export const MARK_KINDS = ['rectangle', 'arrow', 'ellipse', 'label', 'marker', 'blur'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** The short, fixed list of colours a mark may use. */
export const MARK_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white'] as const;
export type MarkColor = (typeof MARK_COLORS)[number];

export const MARK_RGB: Record<MarkColor, [number, number, number]> = {
  red: [220, 38, 38],
  orange: [234, 88, 12],
  yellow: [250, 204, 21],
  green: [22, 163, 74],
  blue: [37, 99, 235],
  purple: [147, 51, 234],
  black: [17, 24, 39],
  white: [255, 255, 255],
};

/** The thickest line a mark may draw. */
export const MARK_MAX_WIDTH = 16;
export const MARK_MIN_WIDTH = 1;

/** A number a numbered marker may carry. */
export const MARK_MAX_NUMBER = 99;

export interface Mark {
  kind: MarkKind;
  color: MarkColor;
  /** Line width in pixels; the number of the marker ignores it. */
  width: number;
  x: number;
  y: number;
  /** Rectangle and blur: width and height from (x, y). */
  w: number;
  h: number;
  /** Arrow: the end point from (x, y). */
  x2: number;
  y2: number;
  /** Ellipse: the radii around (x, y). */
  rx: number;
  ry: number;
  /** Label: the text; marker: the number, 1..99. */
  text: string;
  n: number;
}

export type MarkInput = Partial<Omit<Mark, 'kind'>> & { kind: MarkKind };

export const DEFAULT_MARK: Omit<Mark, 'kind'> = { color: 'red', width: 3, x: 0, y: 0, w: 0, h: 0, x2: 0, y2: 0, rx: 0, ry: 0, text: '', n: 1 };

/** Why a mark is not one the app draws: a code the tool turns into a sentence, never a value drawn in the wrong place. */
export const MARK_PROBLEMS = ['kind', 'color', 'width', 'point', 'size', 'radius', 'text', 'number'] as const;
export type MarkProblem = (typeof MARK_PROBLEMS)[number];

export interface MarkCheck {
  ok: boolean;
  problem?: MarkProblem;
  mark?: Mark;
}

const isFiniteInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) === v;
const isMarkKind = (v: unknown): v is MarkKind => typeof v === 'string' && (MARK_KINDS as readonly string[]).includes(v);
const isMarkColor = (v: unknown): v is MarkColor => typeof v === 'string' && (MARK_COLORS as readonly string[]).includes(v);

/**
 * Reads one mark against the size of the image: a point outside it, a colour outside the list, a width over the ceiling or a missing text is refused with the
 * problem, so nothing is ever drawn in the wrong place. The blur is the only mark that may cover the whole image.
 */
export function checkMark(raw: unknown, width: number, height: number): MarkCheck {
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!isMarkKind(m.kind)) return { ok: false, problem: 'kind' };
  const kind = m.kind;
  if (!isMarkColor(m.color)) return { ok: false, problem: 'color' };
  const w = m.width === undefined ? DEFAULT_MARK.width : m.width;
  if (!isFiniteInt(w) || w < MARK_MIN_WIDTH || w > MARK_MAX_WIDTH) return { ok: false, problem: 'width' };
  const x = m.x;
  const y = m.y;
  if (!isFiniteInt(x) || !isFiniteInt(y) || x < 0 || y < 0 || x > width || y > height) return { ok: false, problem: 'point' };
  const base: Mark = { ...DEFAULT_MARK, kind, color: m.color, width: w, x, y, w: 0, h: 0, x2: x, y2: y, rx: 0, ry: 0, text: '', n: 1 };
  if (kind === 'rectangle' || kind === 'blur') {
    const bw = m.w;
    const bh = m.h;
    if (!isFiniteInt(bw) || !isFiniteInt(bh) || bw <= 0 || bh <= 0 || x + bw > width || y + bh > height) return { ok: false, problem: 'size' };
    return { ok: true, mark: { ...base, w: bw, h: bh } };
  }
  if (kind === 'arrow') {
    const x2 = m.x2;
    const y2 = m.y2;
    if (!isFiniteInt(x2) || !isFiniteInt(y2) || x2 < 0 || y2 < 0 || x2 > width || y2 > height || (x2 === x && y2 === y)) return { ok: false, problem: 'point' };
    return { ok: true, mark: { ...base, x2, y2 } };
  }
  if (kind === 'ellipse') {
    const rx = m.rx;
    const ry = m.ry;
    if (!isFiniteInt(rx) || !isFiniteInt(ry) || rx <= 0 || ry <= 0 || x - rx < 0 || y - ry < 0 || x + rx > width || y + ry > height) return { ok: false, problem: 'radius' };
    return { ok: true, mark: { ...base, rx, ry } };
  }
  if (kind === 'label') {
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    if (!text || text.length > 200) return { ok: false, problem: 'text' };
    return { ok: true, mark: { ...base, text } };
  }
  const n = m.n === undefined ? 1 : m.n;
  if (!isFiniteInt(n) || n < 1 || n > MARK_MAX_NUMBER) return { ok: false, problem: 'number' };
  return { ok: true, mark: { ...base, n } };
}

/** Reads a whole list of marks, stopping at the first problem (nothing is drawn when one mark is not accepted). */
export function checkMarks(raw: unknown, width: number, height: number): { marks: Mark[]; problem?: { index: number; problem: MarkProblem } } {
  const list = Array.isArray(raw) ? raw : [];
  const marks: Mark[] = [];
  for (let i = 0; i < list.length; i++) {
    const checked = checkMark(list[i], width, height);
    if (!checked.ok || !checked.mark) return { marks: [], problem: { index: i, problem: checked.problem ?? 'kind' } };
    marks.push(checked.mark);
  }
  return { marks };
}
