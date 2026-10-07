import { deflateSync, inflateSync } from 'node:zlib';

// A minimal PNG codec: enough to read an image and write it back with marks on it, without a dependency. It understands the 8-bit colour types a screenshot
// uses (grey, grey+alpha, RGB, RGBA), non-interlaced, which is what a capture or a page of a UI produces. Anything else comes back as a problem the tool turns
// into a sentence: the drawing never guesses at an image it cannot read.

export const PNG_PROBLEMS = ['signature', 'structure', 'interlaced', 'depth', 'colour', 'truncated'] as const;
export type PngProblem = (typeof PNG_PROBLEMS)[number];

export interface RgbaImage {
  width: number;
  height: number;
  /** Four bytes per pixel, in row order. */
  data: Uint8Array;
}

export type DecodeResult = { ok: true; image: RgbaImage } | { ok: false; problem: PngProblem };

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const readU32 = (b: Uint8Array, at: number): number => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes a PNG into RGBA pixels. */
export function decodePng(bytes: Uint8Array): DecodeResult {
  if (bytes.length < 8 || !SIG.every((v, i) => bytes[i] === v)) return { ok: false, problem: 'signature' };
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let seenIhdr = false;
  while (at + 8 <= bytes.length) {
    const length = readU32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (body.length < length) return { ok: false, problem: 'truncated' };
    if (type === 'IHDR') {
      if (length !== 13) return { ok: false, problem: 'structure' };
      width = readU32(body, 0);
      height = readU32(body, 4);
      depth = body[8];
      colour = body[9];
      interlace = body[12];
      seenIhdr = true;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!seenIhdr || !width || !height) return { ok: false, problem: 'structure' };
  if (interlace !== 0) return { ok: false, problem: 'interlaced' };
  if (depth !== 8) return { ok: false, problem: 'depth' };
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (!channels) return { ok: false, problem: 'colour' };
  if (!idat.length) return { ok: false, problem: 'structure' };
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b)))));
  } catch {
    return { ok: false, problem: 'structure' };
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return { ok: false, problem: 'truncated' };
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = src[i];
      line[i] = filter === 0 ? x : filter === 1 ? (x + a) & 0xff : filter === 2 ? (x + b) & 0xff : filter === 3 ? (x + ((a + b) >> 1)) & 0xff : filter === 4 ? (x + paeth(a, b, c)) & 0xff : x;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels === 1) {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = 255;
      } else if (channels === 2) {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = line[s + 1];
      } else if (channels === 3) {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = 255;
      } else {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = line[s + 3];
      }
    }
    prev.set(line);
  }
  return { ok: true, image: { width, height, data: out } };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, Buffer.from(body)])), 0);
  return Buffer.concat([head, name, Buffer.from(body), crc]);
}

/** Encodes RGBA pixels as an opaque PNG. */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from(SIG);
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())]));
}
