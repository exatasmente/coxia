import { createHash } from 'node:crypto';
import { clampFrameWidth } from '../../shared/screen';

// A frame of the agent's screen, from the pixels the display server sent to the picture a viewer shows. The raw reply is blue-green-red and a pad byte (not alpha);
// the pad byte is set to opaque in place before anything reads the frame, so a stray value there never makes a still screen look changed. The JPEG comes from
// Electron's `nativeImage`, which only exists in the app: it is a parameter, and the tests give a fake.

/** What of `nativeImage` the encoder uses. */
export interface ImageLike {
  resize(options: { width: number; quality?: 'good' | 'better' | 'best' }): ImageLike;
  toJPEG(quality: number): Uint8Array;
  getSize(): { width: number; height: number };
  isEmpty(): boolean;
}

export interface NativeImageLike {
  createFromBitmap(buffer: Buffer, options: { width: number; height: number }): ImageLike;
}

export interface RawFrame {
  width: number;
  height: number;
  /** `width * height * 4` bytes, blue-green-red and a pad byte. */
  data: Buffer;
}

export interface Encoded {
  jpeg: Uint8Array;
  /** The size of the picture the JPEG holds. */
  width: number;
  height: number;
}

export interface FrameEncoder {
  /** The frame as a JPEG about `width` wide (a viewer's width, clamped); null when the image could not be made. */
  encode(frame: RawFrame, width: number): Encoded | null;
}

/** Sets the pad byte of every pixel to 0xff, in place. */
export function fixPad(data: Buffer): void {
  for (let i = 3; i < data.length; i += 4) data[i] = 0xff;
}

/** What tells one frame from another: the pixels (after `fixPad`) and the size. */
export function hashFrame(frame: RawFrame): string {
  return createHash('md5').update(`${frame.width}x${frame.height}:`).update(frame.data).digest('hex');
}

/** The quality of a picture of this width: the phone's smaller one is compressed harder. */
export const jpegQuality = (width: number): number => (width >= 960 ? 75 : 60);

export function createFrameEncoder(deps: { nativeImage: NativeImageLike }): FrameEncoder {
  return {
    encode(frame, width) {
      try {
        const w = clampFrameWidth(width);
        const image = deps.nativeImage.createFromBitmap(frame.data, { width: frame.width, height: frame.height });
        if (image.isEmpty()) return null;
        const shown = w >= frame.width ? image : image.resize({ width: w, quality: 'good' });
        const size = shown.getSize();
        return { jpeg: shown.toJPEG(jpegQuality(w)), width: size.width, height: size.height };
      } catch {
        return null;
      }
    },
  };
}
