import type { RawFrame } from '../../src/main/screen/frame';
import type { RecorderSink } from '../../src/main/screen/recorder';
import type { WebmChunk } from '../../src/main/screen/webm';

// An encoder that is only an object: it keeps what it was fed, answers each frame with a chunk of a chosen size, and can be made slow, full or broken.

export interface FakeSink extends RecorderSink {
  opened: { width: number; height: number }[];
  fed: { ts: number; key: boolean; width: number; height: number }[];
  closed: number;
  aborted: number;
  /** Bytes of the chunk made for each frame fed. */
  chunkBytes: number;
  /** The next `open` answers false. */
  refuseOpen: boolean;
  /** The next frames are not taken (the encoder is behind). */
  behind: number;
  /** The encoder broke. */
  broken: boolean;
  /** `close` answers null. */
  failClose: boolean;
  /** Held until released: what an `open` waits for. */
  gate: Promise<void> | null;
}

export function fakeSink(chunkBytes = 100): FakeSink {
  const chunks: WebmChunk[] = [];
  const sink: FakeSink = {
    opened: [],
    fed: [],
    closed: 0,
    aborted: 0,
    chunkBytes,
    refuseOpen: false,
    behind: 0,
    broken: false,
    failClose: false,
    gate: null,
    async open(width, height) {
      if (sink.gate) await sink.gate;
      if (sink.refuseOpen) return false;
      sink.opened.push({ width, height });
      return true;
    },
    feed(ts: number, frame: RawFrame, key: boolean) {
      if (sink.broken) return false;
      if (sink.behind > 0) {
        sink.behind--;
        return false;
      }
      sink.fed.push({ ts, key, width: frame.width, height: frame.height });
      chunks.push({ ts, key, data: new Uint8Array(sink.chunkBytes).fill(key ? 1 : 2) });
      return true;
    },
    bytes: () => chunks.reduce((n, c) => n + c.data.length, 0),
    failed: () => sink.broken,
    async close() {
      sink.closed++;
      return sink.failClose ? null : [...chunks];
    },
    abort() {
      sink.aborted++;
    },
  };
  return sink;
}

/** A frame of the given size whose content is its `shade` (a different shade is a different picture). */
export const frameOf = (shade: number, width = 8, height = 4): RawFrame => ({ width, height, data: Buffer.alloc(width * height * 4, shade) });
