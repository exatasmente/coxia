import { t } from './i18n';
// QR Code encoder for short ASCII/UTF-8 text: byte mode, error correction L, versions 1-6 (up to 134 bytes).
// Enough for the pairing link; no dependency, nothing leaves the machine.

interface Spec {
  ec: number;
  blocks: number[];
}

// Per version: error correction codewords per block and the data codewords of each block (level L).
const SPECS: Spec[] = [
  { ec: 7, blocks: [19] },
  { ec: 10, blocks: [34] },
  { ec: 15, blocks: [55] },
  { ec: 20, blocks: [80] },
  { ec: 26, blocks: [108] },
  { ec: 18, blocks: [68, 68] },
];
// Center of the single alignment pattern (versions 2-6), counted from the top-left; version 1 has none.
const ALIGN = [0, 18, 22, 26, 30, 34];
const FORMAT_L = 1;

export const MAX_QR_BYTES = 134;

const EXP = new Array<number>(512).fill(0);
const LOG = new Array<number>(256).fill(0);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

export function reedSolomon(data: number[], ecLen: number): number[] {
  const gen = generator(ecLen);
  const rem = new Array<number>(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ (rem.shift() as number);
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// 15 bits: level and mask, BCH(15,5), XOR with the fixed pattern.
export function formatBits(mask: number): number {
  const data = (FORMAT_L << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function codewords(bytes: number[], version: number): number[] {
  const { ec, blocks } = SPECS[version - 1];
  const capacity = blocks.reduce((a, b) => a + b, 0) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  let at = 0;
  const parts = blocks.map((n) => {
    const d = data.slice(at, at + n);
    at += n;
    return { d, e: reedSolomon(d, ec) };
  });
  const out: number[] = [];
  for (let i = 0; i < Math.max(...blocks); i++) for (const p of parts) if (i < p.d.length) out.push(p.d[i]);
  for (let i = 0; i < ec; i++) for (const p of parts) out.push(p.e[i]);
  return out;
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
    // finder-like 1:1:3:1:1 with a light margin
    const s = Array.from({ length: n }, (_, i) => (get(i) ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) for (let at = s.indexOf(pat); at >= 0; at = s.indexOf(pat, at + 1)) score += 40;
  };
  for (let i = 0; i < n; i++) {
    line((j) => m[i][j]);
    line((j) => m[j][i]);
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
  return score;
}

/** Module matrix (true = dark) of the text as a QR code. Throws when it does not fit in version 6-L. */
export function encodeQr(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = SPECS.findIndex((s) => bytes.length <= Math.floor((s.blocks.reduce((a, b) => a + b, 0) * 8 - 12) / 8)) + 1;
  if (version === 0) throw new Error(t('main.qr.tooBig', { bytes: bytes.length, max: MAX_QR_BYTES }));
  const size = 17 + 4 * version;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    mod[r][c] = dark;
    fn[r][c] = true;
  };

  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const d = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, d <= 3 && d !== 2);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  if (version > 1) {
    const a = ALIGN[version - 1];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(a + dr, a + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
    set(7, 8, bit(6));
    set(8, 8, bit(7));
    set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
    set(size - 8, 8, true);
  };
  drawFormat(0);

  const data = codewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const r = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fn[r][c] || i >= data.length * 8) continue;
        mod[r][c] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }

  const apply = (mask: number) => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && MASKS[mask](r, c)) mod[r][c] = !mod[r][c];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    apply(mask);
    drawFormat(mask);
    const score = penalty(mod);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    apply(mask);
  }
  apply(best);
  drawFormat(best);
  return mod;
}

/** SVG path of the dark modules inside a quiet zone of `quiet` modules; the viewBox is `0 0 size size`. */
export function qrPath(matrix: boolean[][], quiet = 4): { d: string; size: number } {
  let d = '';
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }));
  return { d, size: matrix.length + quiet * 2 };
}
