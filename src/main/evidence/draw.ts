import { MARK_RGB, type Mark } from '../../shared/evidence';
import type { RgbaImage } from './png';

// The marks, drawn on pixels. Pure: it takes an image already decoded and the marks the tool checked, and returns a new image (the original is never touched).
// Rectangles, arrows, ellipses, labels, numbered markers and the blur box; the blur is done by averaging the pixels under it, which is the only way to hide what
// should not be seen without another library.

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function put(image: RgbaImage, x: number, y: number, rgb: readonly [number, number, number], alpha = 255): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = (y * image.width + x) * 4;
  if (alpha >= 255) {
    image.data[at] = rgb[0];
    image.data[at + 1] = rgb[1];
    image.data[at + 2] = rgb[2];
    image.data[at + 3] = 255;
    return;
  }
  const a = alpha / 255;
  image.data[at] = Math.round(image.data[at] * (1 - a) + rgb[0] * a);
  image.data[at + 1] = Math.round(image.data[at + 1] * (1 - a) + rgb[1] * a);
  image.data[at + 2] = Math.round(image.data[at + 2] * (1 - a) + rgb[2] * a);
  image.data[at + 3] = Math.max(image.data[at + 3], Math.round(255 * a));
}

/** A filled disc of `radius` around (cx, cy): the join of a line, the dot of a marker and the period of a label. */
function disc(image: RgbaImage, cx: number, cy: number, radius: number, rgb: readonly [number, number, number]): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) put(image, x, y, rgb);
    }
  }
}

function line(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, width: number, rgb: readonly [number, number, number]): void {
  const half = Math.max(0, Math.floor(width / 2));
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    disc(image, x, y, half, rgb);
  }
}

function rect(image: RgbaImage, x: number, y: number, w: number, h: number, width: number, rgb: readonly [number, number, number]): void {
  line(image, x, y, x + w, y, width, rgb);
  line(image, x + w, y, x + w, y + h, width, rgb);
  line(image, x + w, y + h, x, y + h, width, rgb);
  line(image, x, y + h, x, y, width, rgb);
}

function ellipse(image: RgbaImage, cx: number, cy: number, rx: number, ry: number, width: number, rgb: readonly [number, number, number]): void {
  const half = Math.max(0, Math.floor(width / 2));
  const steps = Math.max(rx, ry, 1) * 8;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + rx * Math.cos(t));
    const y = Math.round(cy + ry * Math.sin(t));
    disc(image, x, y, half, rgb);
  }
}

/** An arrow: a line with a head of two short strokes at its end. */
function arrow(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, width: number, rgb: readonly [number, number, number]): void {
  line(image, x0, y0, x1, y1, width, rgb);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const size = Math.max(8, width * 3);
  const spread = 0.5;
  line(image, x1, y1, Math.round(x1 - size * Math.cos(angle - spread)), Math.round(y1 - size * Math.sin(angle - spread)), width, rgb);
  line(image, x1, y1, Math.round(x1 - size * Math.cos(angle + spread)), Math.round(y1 - size * Math.sin(angle + spread)), width, rgb);
}

/** One digit as a 3x5 dot matrix: the numbered markers are drawn without a font, so the number is always the same shape. */
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

function glyph(image: RgbaImage, text: string, x: number, y: number, scale: number, rgb: readonly [number, number, number]): void {
  let at = x;
  for (const ch of text) {
    const rows = DIGITS[ch];
    if (rows) {
      for (let ry = 0; ry < rows.length; ry++) for (let rx = 0; rx < 3; rx++) if (rows[ry][rx] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(image, at + rx * scale + dx, y + ry * scale + dy, rgb);
    }
    at += 4 * scale;
  }
}

/** A marker: a filled disc with a white number on it. */
function marker(image: RgbaImage, x: number, y: number, n: number, rgb: readonly [number, number, number]): void {
  const radius = 14;
  disc(image, x, y, radius, rgb);
  const digits = String(n);
  const scale = 2;
  const width = digits.length * 4 * scale - scale;
  const height = 5 * scale;
  glyph(image, digits, x - Math.round(width / 2), y - Math.round(height / 2), scale, [255, 255, 255]);
}

/** A blur box: every pixel under it is replaced by the average of the box, which hides anything it covers. */
function blur(image: RgbaImage, x: number, y: number, w: number, h: number): void {
  const x0 = clamp(x, 0, image.width);
  const y0 = clamp(y, 0, image.height);
  const x1 = clamp(x + w, 0, image.width);
  const y1 = clamp(y + h, 0, image.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const at = (yy * image.width + xx) * 4;
      r += image.data[at];
      g += image.data[at + 1];
      b += image.data[at + 2];
      a += image.data[at + 3];
      n++;
    }
  }
  if (!n) return;
  const avg: [number, number, number] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  const alpha = Math.round(a / n);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const at = (yy * image.width + xx) * 4;
      image.data[at] = avg[0];
      image.data[at + 1] = avg[1];
      image.data[at + 2] = avg[2];
      image.data[at + 3] = alpha;
    }
  }
}

/** Applies one checked mark to a copy of the image. */
export function drawMark(image: RgbaImage, mark: Mark): void {
  const rgb = MARK_RGB[mark.color];
  if (mark.kind === 'rectangle') rect(image, mark.x, mark.y, mark.w, mark.h, mark.width, rgb);
  else if (mark.kind === 'arrow') arrow(image, mark.x, mark.y, mark.x2, mark.y2, mark.width, rgb);
  else if (mark.kind === 'ellipse') ellipse(image, mark.x, mark.y, mark.rx, mark.ry, mark.width, rgb);
  else if (mark.kind === 'marker') marker(image, mark.x, mark.y, mark.n, rgb);
  else if (mark.kind === 'label') {
    // A label the app draws with the same dot matrix: a short text over a filled plate, so it reads on any background.
    const scale = Math.max(2, Math.min(4, Math.round(mark.width / 2)));
    const chars = [...mark.text].filter((c) => /\d/.test(c));
    const w = chars.length ? chars.length * 4 * scale + 8 : mark.text.length * 4 * scale;
    const h = 5 * scale + 8;
    for (let yy = mark.y; yy < mark.y + h; yy++) for (let xx = mark.x; xx < mark.x + w; xx++) if (xx < image.width && yy < image.height) put(image, xx, yy, rgb, 200);
    glyph(image, chars.join(''), mark.x + 4, mark.y + 4, scale, [255, 255, 255]);
  } else if (mark.kind === 'blur') blur(image, mark.x, mark.y, mark.w, mark.h);
}

/** Applies every mark, in order, to a copy of the image; the original is left as it came. */
export function drawMarks(source: RgbaImage, marks: readonly Mark[]): RgbaImage {
  const image: RgbaImage = { width: source.width, height: source.height, data: new Uint8Array(source.data) };
  for (const mark of marks) drawMark(image, mark);
  return image;
}
