import type { X11Connection, X11Frame } from '../../src/main/screen/x11';

// A display that is only an object: what it shows can be changed, its reads counted, held or made to fail, and its connection lost.

export interface FakeConn extends X11Connection {
  grabs: number;
  /** What the display shows now; changing a byte is a change on screen. */
  pixels: Buffer;
  /** Answers the next reads with nothing. */
  failReads: number;
  /** Holds the next read until released. */
  hold: (() => void) | null;
  release(): void;
}

export const W = 8;
export const H = 4;

export function fakeConn(): FakeConn {
  const closers: (() => void)[] = [];
  let release: () => void = () => undefined;
  const conn: FakeConn = {
    root: 1,
    size: { width: W, height: H },
    canInput: true,
    closed: false,
    grabs: 0,
    pixels: Buffer.alloc(W * H * 4, 3),
    failReads: 0,
    hold: null,
    release: () => release(),
    async geometry() {
      return { width: W, height: H, depth: 24 };
    },
    async grab(): Promise<X11Frame | null> {
      conn.grabs++;
      if (conn.closed) return null;
      if (conn.hold === null && conn.failReads === 0) return { width: W, height: H, data: Buffer.from(conn.pixels) };
      if (conn.failReads > 0) {
        conn.failReads--;
        return null;
      }
      await new Promise<void>((r) => (release = r));
      conn.hold = null;
      return conn.closed ? null : { width: W, height: H, data: Buffer.from(conn.pixels) };
    },
    async keymap() {
      return null;
    },
    async fakeInput() {
      return { ok: true, delivered: 0 };
    },
    onClose: (cb) => void closers.push(cb),
    close() {
      if (conn.closed) return;
      (conn as { closed: boolean }).closed = true;
      release();
      for (const cb of closers) cb();
    },
  };
  return conn;
}
