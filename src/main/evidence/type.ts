import { EVIDENCE_MAX_BYTES, type EvidenceKind } from '../../shared/evidence';

// The kind of a file, read from its bytes and never from its name or its extension: a `.png` that is text is text and a `.txt` that is a PNG is an image. A file
// the app does not accept (video, audio, an archive, an executable, anything whose content is not what it says) comes back as null with a reason.

/** Why the content is not one the app accepts. */
export const KIND_PROBLEMS = ['empty', 'too-long', 'video', 'audio', 'archive', 'executable', 'unknown'] as const;
export type KindProblem = (typeof KIND_PROBLEMS)[number];

export interface KindResult {
  kind: EvidenceKind | null;
  problem?: KindProblem;
}

const starts = (bytes: Uint8Array, sig: readonly number[]): boolean => sig.every((b, i) => bytes[i] === b);

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

// What a container the app refuses looks like, so the reason names it instead of a shrug.
const ARCHIVE_SIGS: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04], // ZIP and everything built on it (docx, xlsx, jar, apk)
  [0x1f, 0x8b], // gzip
  [0x42, 0x5a, 0x68], // bzip2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a], // xz
  [0x37, 0x7a, 0xbc, 0xaf], // 7z
  [0x52, 0x61, 0x72, 0x21], // rar
  [0x28, 0xb5, 0x2f, 0xfd], // zstd
];
const EXECUTABLE_SIGS: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x4d, 0x5a], // PE/COFF (a Windows .exe or .dll)
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O
  [0xfe, 0xed, 0xfa, 0xce],
  [0x23, 0x21], // a script: this one is only a hint, checked below against the shebang being the whole first bytes
];

/** A shebang at the very start of a text file: what makes a plain text file an executable script. */
const isShebang = (bytes: Uint8Array): boolean => bytes[0] === 0x23 && bytes[1] === 0x21 && bytes.slice(2, 64).some((b) => b === 0x0a);

/** Whether the bytes read as text: no NUL and nothing that decodes to a replacement character inside the sample. */
function looksText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  // A NUL byte means binary in every text format the app accepts.
  if (bytes.includes(0)) return false;
  // A conservative check: the sample is UTF-8, and a stray control byte (other than tab, newline, carriage return and form feed) makes it binary.
  const decoded = Buffer.from(bytes).toString('utf8');
  if (decoded.includes('\uFFFD')) return false;
  for (const b of bytes) if (b < 0x09 || (b > 0x0d && b < 0x20)) return false;
  return true;
}

/**
 * The kind of a file from its content. `head` is the start of the file (and may be the whole file). The reason is one of `KIND_PROBLEMS`, which the tool turns
 * into a sentence: `too-long` for a file over the ceiling, the format name for one the app does not accept, `unknown` for content that confirms nothing.
 */
export function detectKind(head: Uint8Array, size: number): KindResult {
  if (size > EVIDENCE_MAX_BYTES) return { kind: null, problem: 'too-long' };
  if (size === 0 || head.length === 0) return { kind: null, problem: 'empty' };
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'png' };
  if (starts(head, [0xff, 0xd8, 0xff])) return { kind: 'jpeg' };
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return { kind: 'gif' };
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return { kind: 'webp' };
  if (ascii(head, 0, '%PDF-')) return { kind: 'pdf' };
  // Video and audio containers: the formats the issue puts out of scope, named so the reason is exact.
  if (ascii(head, 4, 'ftyp') && (ascii(head, 8, 'isom') || ascii(head, 8, 'mp42') || ascii(head, 8, 'avc1') || ascii(head, 8, 'M4V '))) return { kind: null, problem: 'video' };
  if (starts(head, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: null, problem: 'video' }; // Matroska/WebM
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'AVI ')) return { kind: null, problem: 'video' };
  if (ascii(head, 0, 'OggS')) return { kind: null, problem: 'audio' };
  if (ascii(head, 0, 'ID3') || starts(head, [0xff, 0xfb]) || starts(head, [0xff, 0xf3])) return { kind: null, problem: 'audio' };
  if (ascii(head, 0, 'fLaC')) return { kind: null, problem: 'audio' };
  if (ARCHIVE_SIGS.some((s) => starts(head, s))) return { kind: null, problem: 'archive' };
  if (EXECUTABLE_SIGS.slice(0, 4).some((s) => starts(head, s))) return { kind: null, problem: 'executable' };
  if (isShebang(head)) return { kind: null, problem: 'executable' };
  if (looksText(head)) return { kind: 'text' };
  return { kind: null, problem: 'unknown' };
}
