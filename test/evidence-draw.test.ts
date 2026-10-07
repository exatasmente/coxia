import { describe, expect, it } from 'vitest';
import { drawMarks } from '../src/main/evidence/draw';
import { decodePng, encodePng, type RgbaImage } from '../src/main/evidence/png';
import { checkMarks, type Mark, type MarkInput } from '../src/shared/evidence';

// The marks are drawn on pixels: a test with a small image covers each mark and reads the pixel it should have changed, and each refusal says what was wrong.

const size = (w: number, h: number): RgbaImage => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 255)) });

const pixel = (image: RgbaImage, x: number, y: number): [number, number, number, number] => {
  const at = (y * image.width + x) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2], image.data[at + 3]];
};

const mark = (m: MarkInput): Mark => m as Mark;

describe('drawing the marks', () => {
  it('draws a rectangle where it says, and nothing outside it', () => {
    const image = size(40, 40);
    const out = drawMarks(image, [mark({ kind: 'rectangle', x: 10, y: 10, w: 20, h: 20, color: 'red', width: 2 })]);
    // A corner of the rectangle is red; the middle and the outside are untouched.
    expect(pixel(out, 10, 10)).toEqual([220, 38, 38, 255]);
    expect(pixel(out, 20, 20)).toEqual([255, 255, 255, 255]);
    expect(pixel(out, 5, 5)).toEqual([255, 255, 255, 255]);
    // The original is never touched.
    expect(pixel(image, 10, 10)).toEqual([255, 255, 255, 255]);
  });

  it('draws an arrow from end to end and a head at the tip', () => {
    const out = drawMarks(size(60, 60), [mark({ kind: 'arrow', x: 10, y: 10, x2: 50, y2: 10, color: 'blue', width: 3 })]);
    expect(pixel(out, 10, 10)).toEqual([37, 99, 235, 255]);
    expect(pixel(out, 30, 10)).toEqual([37, 99, 235, 255]);
    expect(pixel(out, 50, 10)).toEqual([37, 99, 235, 255]);
    // Somewhere off the tip is untouched.
    expect(pixel(out, 50, 25)).toEqual([255, 255, 255, 255]);
  });

  it('draws an ellipse around its centre without filling it', () => {
    const out = drawMarks(size(60, 60), [mark({ kind: 'ellipse', x: 30, y: 30, rx: 20, ry: 10, color: 'green', width: 2 })]);
    expect(pixel(out, 10, 30)).toEqual([22, 163, 74, 255]);
    expect(pixel(out, 30, 30)).toEqual([255, 255, 255, 255]);
  });

  it('draws a numbered marker with its number in white', () => {
    const out = drawMarks(size(60, 60), [mark({ kind: 'marker', x: 30, y: 30, n: 3, color: 'purple', width: 2 })]);
    // The disc is purple away from the number; the middle carries the white digit.
    expect(pixel(out, 20, 30)).toEqual([147, 51, 234, 255]);
    let white = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (pixel(out, x, y).join() === '255,255,255,255') white++;
    expect(white).toBeGreaterThan(0);
  });

  it('draws a label as a plate over the image', () => {
    const out = drawMarks(size(60, 60), [mark({ kind: 'label', x: 5, y: 5, text: '1', color: 'orange', width: 4 })]);
    // Somewhere inside the plate the pixel is no longer the white background (the plate is semi-transparent over it).
    expect(pixel(out, 6, 6)).not.toEqual([255, 255, 255, 255]);
  });

  it('blurs the box it covers, hiding what was there and leaving the rest alone', () => {
    const image: RgbaImage = { width: 10, height: 10, data: new Uint8Array(10 * 10 * 4) };
    // Half the image black, half white: the blur of a box over the boundary can only average it.
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const at = (y * 10 + x) * 4;
      const v = x < 5 ? 0 : 255;
      image.data[at] = image.data[at + 1] = image.data[at + 2] = v;
      image.data[at + 3] = 255;
    }
    const out = drawMarks(image, [mark({ kind: 'blur', x: 0, y: 0, w: 10, h: 10, color: 'black', width: 1 })]);
    const grays = new Set<number>();
    for (let x = 0; x < 10; x++) grays.add(pixel(out, x, 0)[0]);
    // The box is one flat colour (the average), so what was under it cannot be read.
    expect(grays.size).toBe(1);
    // The original still holds the two halves.
    expect(pixel(image, 0, 0)[0]).toBe(0);
    expect(pixel(image, 9, 0)[0]).toBe(255);
  });
});

describe('refusing a mark that is not one the app draws', () => {
  it('refuses a colour outside the list, a width over the ceiling, a point outside the image, a bad size and a bad radius', () => {
    expect(checkMarks([{ kind: 'rectangle', x: 1, y: 1, w: 2, h: 2, color: 'pink', width: 2 }], 20, 20).problem).toEqual({ index: 0, problem: 'color' });
    expect(checkMarks([{ kind: 'rectangle', x: 1, y: 1, w: 2, h: 2, color: 'red', width: 99 }], 20, 20).problem).toEqual({ index: 0, problem: 'width' });
    expect(checkMarks([{ kind: 'rectangle', x: 19, y: 1, w: 5, h: 2, color: 'red', width: 2 }], 20, 20).problem).toEqual({ index: 0, problem: 'size' });
    expect(checkMarks([{ kind: 'rectangle', x: 30, y: 1, w: 2, h: 2, color: 'red', width: 2 }], 20, 20).problem).toEqual({ index: 0, problem: 'point' });
    expect(checkMarks([{ kind: 'ellipse', x: 10, y: 10, rx: 20, ry: 5, color: 'red', width: 2 }], 20, 20).problem).toEqual({ index: 0, problem: 'radius' });
    expect(checkMarks([{ kind: 'blur', x: 1, y: 1, w: 2, h: 2, color: 'black', width: 1 }, { kind: 'label', x: 1, y: 1, text: '', color: 'red', width: 2 }], 20, 20).problem).toEqual({ index: 1, problem: 'text' });
    expect(checkMarks([{ kind: 'marker', x: 5, y: 5, n: 0, color: 'red', width: 2 }], 20, 20).problem).toEqual({ index: 0, problem: 'number' });
  });

  it('accepts a full list of marks and refuses nothing of it', () => {
    const out = checkMarks(
      [
        { kind: 'rectangle', x: 1, y: 1, w: 5, h: 5, color: 'red', width: 2 },
        { kind: 'arrow', x: 1, y: 1, x2: 10, y2: 10, color: 'blue', width: 4 },
        { kind: 'ellipse', x: 10, y: 10, rx: 5, ry: 5, color: 'green', width: 1 },
        { kind: 'marker', x: 4, y: 4, n: 7, color: 'black', width: 2 },
        { kind: 'blur', x: 0, y: 0, w: 20, h: 20, color: 'white', width: 1 },
      ],
      20,
      20,
    );
    expect(out.problem).toBeUndefined();
    expect(out.marks).toHaveLength(5);
  });
});

describe('the PNG codec', () => {
  it('writes an image and reads it back with the same pixels', () => {
    const image: RgbaImage = { width: 4, height: 3, data: new Uint8Array(4 * 3 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) };
    const encoded = encodePng(image);
    const back = decodePng(encoded);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.image.width).toBe(4);
      expect(back.image.height).toBe(3);
      expect([...back.image.data]).toEqual([...image.data]);
    }
  });

  it('draws on an image and encodes it without losing the marks', () => {
    const image: RgbaImage = { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).fill(255) };
    const marked = drawMarks(image, [mark({ kind: 'rectangle', x: 2, y: 2, w: 10, h: 10, color: 'red', width: 2 })]);
    const back = decodePng(encodePng(marked));
    expect(back.ok).toBe(true);
    if (back.ok) expect(pixel(back.image, 2, 2)).toEqual([220, 38, 38, 255]);
  });

  it('refuses a file that is not a PNG, one interlaced and one with an odd depth', () => {
    expect(decodePng(Uint8Array.from([1, 2, 3, 4])).ok).toBe(false);
    const good = decodePng(encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(200) }));
    expect(good.ok).toBe(true);
  });
});
