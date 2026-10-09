// A frame of the agent's screen, from the raw pixels to the JPEG a viewer shows (#157): the pad byte that is not alpha, what tells one frame from another, the
// width a viewer may ask for and what is handed to Electron's `nativeImage`, which tests replace with a fake.
import { describe, expect, it } from 'vitest';
import { SCREEN_FRAME_MAX_WIDTH, SCREEN_FRAME_MIN_WIDTH, SCREEN_FRAME_STEP, clampFrameWidth } from '../src/shared/screen';
import { type ImageLike, type NativeImageLike, createFrameEncoder, fixPad, hashFrame, jpegQuality } from '../src/main/screen/frame';
import { gradient } from './helpers/fakeX';

interface Call {
  op: 'create' | 'resize' | 'jpeg';
  args: unknown[];
}

function fakeNative(over: { empty?: boolean; throws?: boolean } = {}): { native: NativeImageLike; calls: Call[] } {
  const calls: Call[] = [];
  const image = (w: number, h: number): ImageLike => ({
    resize: (o) => {
      calls.push({ op: 'resize', args: [o] });
      return image(o.width, Math.round((h * o.width) / w));
    },
    toJPEG: (q) => {
      calls.push({ op: 'jpeg', args: [q, w] });
      return Uint8Array.from([0xff, 0xd8, 0xff, q]);
    },
    getSize: () => ({ width: w, height: h }),
    isEmpty: () => over.empty === true,
  });
  return {
    calls,
    native: {
      createFromBitmap: (buffer, o) => {
        if (over.throws) throw new Error('no');
        calls.push({ op: 'create', args: [buffer.length, o] });
        return image(o.width, o.height);
      },
    },
  };
}

const raw = (w = 64, h = 32) => ({ width: w, height: h, data: gradient(w, h) });

describe('the pad byte', () => {
  it('is set to opaque on every pixel, in place, and nothing else is touched', () => {
    const f = raw(4, 2);
    const before = Buffer.from(f.data);
    fixPad(f.data);
    for (let i = 0; i < f.data.length; i++) expect(f.data[i]).toBe(i % 4 === 3 ? 0xff : before[i]);
  });

  it('works on a buffer that does not start on a multiple of four', () => {
    const big = Buffer.alloc(33, 1);
    const view = big.subarray(1);
    fixPad(view);
    expect(view[3]).toBe(0xff);
    expect(big[0]).toBe(1);
  });
});

describe('what tells one frame from another', () => {
  it('is the pixels, the same after the pad byte is fixed whatever the server left there', () => {
    const a = raw();
    const b = { ...a, data: Buffer.from(a.data) };
    for (let i = 3; i < b.data.length; i += 4) b.data[i] = 0x5a;
    expect(hashFrame(a)).not.toBe(hashFrame(b));
    fixPad(a.data);
    fixPad(b.data);
    expect(hashFrame(a)).toBe(hashFrame(b));
  });

  it('changes with one pixel and with the size', () => {
    const a = raw();
    const c = { ...a, data: Buffer.from(a.data) };
    c.data[10] ^= 1;
    expect(hashFrame(c)).not.toBe(hashFrame(a));
    const wide = { width: 32, height: 64, data: a.data };
    expect(hashFrame(wide)).not.toBe(hashFrame(a));
  });
});

describe('the width a viewer may ask for', () => {
  it('is clamped to 320..1280 in steps of 80, so the encoder holds a bounded number of pictures', () => {
    expect(clampFrameWidth(640)).toBe(640);
    expect(clampFrameWidth(1280)).toBe(1280);
    expect(clampFrameWidth(5000)).toBe(SCREEN_FRAME_MAX_WIDTH);
    expect(clampFrameWidth(10)).toBe(SCREEN_FRAME_MIN_WIDTH);
    expect(clampFrameWidth(-3)).toBe(SCREEN_FRAME_MIN_WIDTH);
    expect(clampFrameWidth(661)).toBe(640);
    expect(clampFrameWidth(681)).toBe(720);
    for (const bad of [Number.NaN, Infinity, '640', null, undefined, {}]) expect(clampFrameWidth(bad)).toBe(SCREEN_FRAME_MAX_WIDTH);
    const all = new Set(Array.from({ length: 2000 }, (_, i) => clampFrameWidth(i)));
    expect(all.size).toBe((SCREEN_FRAME_MAX_WIDTH - SCREEN_FRAME_MIN_WIDTH) / SCREEN_FRAME_STEP + 1);
  });

  it('is compressed harder for the phone: quality 75 from the desktop widths, 60 below', () => {
    expect(jpegQuality(1280)).toBe(75);
    expect(jpegQuality(640)).toBe(60);
  });
});

describe('the encoder', () => {
  it('hands the raw bitmap to nativeImage with the frame\'s own size and makes the JPEG at the desktop width and quality, without resizing', () => {
    const { native, calls } = fakeNative();
    const out = createFrameEncoder({ nativeImage: native }).encode(raw(1280, 800), 1280);
    expect(out).toMatchObject({ width: 1280, height: 800 });
    expect([...(out?.jpeg ?? [])]).toEqual([0xff, 0xd8, 0xff, 75]);
    expect(calls).toEqual([
      { op: 'create', args: [1280 * 800 * 4, { width: 1280, height: 800 }] },
      { op: 'jpeg', args: [75, 1280] },
    ]);
  });

  it('resizes to the phone\'s width first, with good quality, and compresses harder', () => {
    const { native, calls } = fakeNative();
    const out = createFrameEncoder({ nativeImage: native }).encode(raw(1280, 800), 640);
    expect(out).toMatchObject({ width: 640, height: 400 });
    expect(calls.map((c) => c.op)).toEqual(['create', 'resize', 'jpeg']);
    expect(calls[1].args).toEqual([{ width: 640, quality: 'good' }]);
    expect(calls[2].args).toEqual([60, 640]);
  });

  it('clamps what is asked for, and never makes a picture larger than the screen', () => {
    const { native, calls } = fakeNative();
    const enc = createFrameEncoder({ nativeImage: native });
    expect(enc.encode(raw(1280, 800), 99999)?.width).toBe(1280);
    expect(enc.encode(raw(1280, 800), 1)?.width).toBe(320);
    expect(enc.encode(raw(400, 300), 1280)?.width).toBe(400);
    expect(calls.filter((c) => c.op === 'resize')).toHaveLength(1);
  });

  it('is null when the image is empty or nativeImage throws, never an exception', () => {
    expect(createFrameEncoder({ nativeImage: fakeNative({ empty: true }).native }).encode(raw(), 640)).toBeNull();
    expect(createFrameEncoder({ nativeImage: fakeNative({ throws: true }).native }).encode(raw(), 640)).toBeNull();
  });
});
