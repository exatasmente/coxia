import { lstatSync } from 'node:fs';
import { type Socket, createConnection } from 'node:net';

// A minimal X11 client for an agent's virtual display: the setup, `GetGeometry`, `GetImage` of the root window, `GetKeyboardMapping` and `XTestFakeInput`. Nothing
// is installed and nothing runs inside the sandbox: the app is a client of the display's own socket. The server may be drawn on by the agent's app, so everything
// that comes back is parsed with its size bounded, and a reply that is not what was asked for closes the connection instead of being guessed at.

/** Why a connection was refused or ended. */
export type X11Code = 'not-socket' | 'connect' | 'setup' | 'timeout' | 'protocol' | 'closed';

export class X11Error extends Error {
  constructor(
    readonly code: X11Code,
    detail = '',
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'X11Error';
  }
}

const SETUP_MAX = 64 * 1024;
const REPLY_MAX = 16 * 1024 * 1024;
const KEYMAP_MAX = 64 * 1024;
const GENERIC_EVENT_MAX = 64 * 1024;
/** Largest screen a frame is read for: 4096 on a side and 16 MiB of pixels. */
export const SCREEN_SIDE_MAX = 4096;
export const FRAME_BYTES_MAX = REPLY_MAX;
const FAKE_INPUT_MAX = 1024;

const REQUEST_MS = 3000;
const IMAGE_MS = 5000;

const OP_GET_GEOMETRY = 14;
const OP_QUERY_EXTENSION = 98;
const OP_GET_KEYBOARD_MAPPING = 101;
const OP_GET_IMAGE = 73;
const OP_GET_INPUT_FOCUS = 43;
const XTEST_FAKE_INPUT = 2;

const FAKE_KEY_PRESS = 2;
const FAKE_KEY_RELEASE = 3;
const FAKE_BUTTON_PRESS = 4;
const FAKE_BUTTON_RELEASE = 5;
const FAKE_MOTION = 6;

const pad4 = (n: number): number => (n + 3) & ~3;

/** What the person's input becomes on the display: an absolute pointer move, a button, a key. */
export type X11Input = { type: 'motion'; x: number; y: number } | { type: 'button'; button: number; down: boolean } | { type: 'key'; keycode: number; down: boolean };

export interface X11Frame {
  width: number;
  height: number;
  /** `width * height * 4` bytes, blue-green-red and a pad byte, row by row. */
  data: Buffer;
}

export interface X11Keymap {
  /** The keycode of the first row. */
  first: number;
  /** Keysyms per keycode. */
  width: number;
  /** `rows * width` keysyms, row by row. */
  syms: Uint32Array;
}

export interface X11Connection {
  readonly root: number;
  /** The root window's size as last read (a `grab` refreshes it). */
  readonly size: { width: number; height: number };
  /** The server has the XTEST extension: input can be sent. */
  readonly canInput: boolean;
  readonly closed: boolean;
  /** The size of the root now, or null when the server does not answer. */
  geometry(): Promise<{ width: number; height: number; depth: number } | null>;
  /** The whole root window as it is now, or null when there is no frame (a size or depth that is not expected, an X error, a connection that is gone). Never throws. */
  grab(): Promise<X11Frame | null>;
  /** The keyboard mapping, read once per connection; null when it cannot be read. */
  keymap(): Promise<X11Keymap | null>;
  /** Sends the events through XTEST in one batch. `ok` is true only when every one was accepted; a connection that failed delivers nothing. Never throws. */
  fakeInput(events: X11Input[]): Promise<{ ok: boolean; delivered: number }>;
  onClose(cb: () => void): void;
  close(): void;
}

export interface X11Deps {
  /** Opens the socket; tests give another. */
  connect?: (path: string) => Socket;
  /** `lstat` of the path, to refuse anything that is not a socket before dialling. */
  isSocket?: (path: string) => boolean;
  /** Time limits in ms. */
  requestMs?: number;
  imageMs?: number;
}

function defaultIsSocket(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch {
    return false;
  }
}

/** Bytes that arrived and have not been read yet; a large reply is put together once, not at each chunk. */
class ByteQueue {
  private parts: Buffer[] = [];
  size = 0;
  push(b: Buffer): void {
    if (b.length === 0) return;
    this.parts.push(b);
    this.size += b.length;
  }
  peek(n: number): Buffer {
    if (this.parts[0].length >= n) return this.parts[0].subarray(0, n);
    const all = Buffer.concat(this.parts, this.size);
    this.parts = [all];
    return all.subarray(0, n);
  }
  take(n: number): Buffer {
    const head = this.peek(n);
    const first = this.parts[0];
    if (first.length === n) this.parts.shift();
    else this.parts[0] = first.subarray(n);
    this.size -= n;
    return head;
  }
}

interface Pending {
  /** Sequence numbers this exchange sent: errors in `first..last` belong to it, and the reply comes with `last`. */
  first: number;
  last: number;
  /** The most the reply may carry beyond its 32 bytes, and the exact amount when it is known. */
  maxExtra: number;
  exactExtra?: number;
  /** Sequence numbers of requests that failed before the last (a batch of `XTestFakeInput`). */
  failed: number[];
  timer: ReturnType<typeof setTimeout>;
  done: (r: Exchange) => void;
}

type Exchange = { kind: 'reply'; reply: Buffer; failed: number[] } | { kind: 'xerror'; code: number } | { kind: 'dead' };

interface Setup {
  root: number;
  width: number;
  height: number;
  depth: number;
  /** Bits per pixel the server uses for the root's depth. */
  bitsPerPixel: number;
  minKeycode: number;
  maxKeycode: number;
}

function parseSetup(b: Buffer): Setup {
  if (b.length < 40) throw new X11Error('setup', 'short reply');
  const vendor = b.readUInt16LE(24);
  const screens = b[28];
  const formats = b[29];
  const imageOrder = b[30];
  if (imageOrder !== 0) throw new X11Error('setup', 'image byte order is not little-endian');
  if (screens < 1) throw new X11Error('setup', 'no screen');
  const formatsAt = 40 + pad4(vendor);
  const screenAt = formatsAt + 8 * formats;
  if (screenAt + 40 > b.length) throw new X11Error('setup', 'screen is outside the reply');
  const depth = b[screenAt + 38];
  let bitsPerPixel = 0;
  for (let i = 0; i < formats; i++) if (b[formatsAt + 8 * i] === depth) bitsPerPixel = b[formatsAt + 8 * i + 1];
  return { root: b.readUInt32LE(screenAt), width: b.readUInt16LE(screenAt + 20), height: b.readUInt16LE(screenAt + 22), depth, bitsPerPixel, minKeycode: b[34], maxKeycode: b[35] };
}

/** The connection of one stage's display; made once, before the agent's first command, and never dialled again (a lost one ends the live screen). */
export async function connectX11(path: string, deps: X11Deps = {}): Promise<X11Connection> {
  if (!(deps.isSocket ?? defaultIsSocket)(path)) throw new X11Error('not-socket');
  const requestMs = deps.requestMs ?? REQUEST_MS;
  const imageMs = deps.imageMs ?? IMAGE_MS;
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = (deps.connect ?? ((p) => createConnection({ path: p })))(path);
    const fail = (e: Error): void => reject(new X11Error('connect', e.message));
    s.once('error', fail);
    s.once('connect', () => {
      s.off('error', fail);
      resolve(s);
    });
  });

  const queue = new ByteQueue();
  const closers: (() => void)[] = [];
  let closed = false;
  let seq = 0;
  let pending: Pending | null = null;
  let setup: Setup | null = null;
  let setupDone: ((s: Setup) => void) | null = null;
  let setupFailed: ((e: X11Error) => void) | null = null;

  const shut = (why?: X11Error): void => {
    if (closed) return;
    closed = true;
    socket.destroy();
    if (setupFailed) {
      const f = setupFailed;
      setupFailed = null;
      setupDone = null;
      f(why ?? new X11Error('closed', 'before the setup'));
    }
    if (pending) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      p.done({ kind: 'dead' });
    }
    for (const cb of closers) cb();
  };
  const fail = (code: X11Code, detail: string): void => shut(new X11Error(code, detail));

  const drain = (): void => {
    for (;;) {
      if (closed) return;
      if (!setup) {
        if (queue.size < 8) return;
        const head = queue.peek(8);
        // 1 is Success; 0 (failed) and 2 (authenticate) end here: the display of a stage asks for no authorization.
        if (head[0] !== 1) return fail('setup', `status ${head[0]}`);
        const extra = head.readUInt16LE(6) * 4;
        if (extra > SETUP_MAX) return fail('setup', 'reply is too large');
        if (queue.size < 8 + extra) return;
        try {
          setup = parseSetup(queue.take(8 + extra));
        } catch (e) {
          return fail('setup', (e as Error).message);
        }
        const done = setupDone;
        setupDone = null;
        setupFailed = null;
        done?.(setup);
        continue;
      }
      if (queue.size < 32) return;
      const head = queue.peek(32);
      const type = head[0];
      if (type === 0) {
        // An error packet: it names the request that failed by sequence number.
        const at = head.readUInt16LE(2);
        queue.take(32);
        const p = pending;
        if (!p || !inRange(at, p)) return fail('protocol', 'error for a request nobody sent');
        if (at === (p.last & 0xffff)) {
          clearTimeout(p.timer);
          pending = null;
          p.done({ kind: 'xerror', code: head[1] });
        } else p.failed.push(at);
        continue;
      }
      if (type === 1) {
        const p = pending;
        if (!p || head.readUInt16LE(2) !== (p.last & 0xffff)) return fail('protocol', 'reply nobody asked for');
        const extra = head.readUInt32LE(4) * 4;
        if (extra > p.maxExtra || (p.exactExtra !== undefined && extra !== p.exactExtra)) return fail('protocol', 'reply of an unexpected size');
        if (queue.size < 32 + extra) return;
        const reply = queue.take(32 + extra);
        clearTimeout(p.timer);
        pending = null;
        p.done({ kind: 'reply', reply, failed: p.failed });
        continue;
      }
      // An event: skipped. A generic event carries more.
      if ((type & 0x7f) === 35) {
        const extra = head.readUInt32LE(4) * 4;
        if (extra > GENERIC_EVENT_MAX) return fail('protocol', 'generic event is too large');
        if (queue.size < 32 + extra) return;
        queue.take(32 + extra);
      } else queue.take(32);
    }
  };
  const inRange = (at: number, p: Pending): boolean => {
    for (let s = p.first; s <= p.last; s++) if ((s & 0xffff) === at) return true;
    return false;
  };

  socket.on('data', (chunk: Buffer) => {
    queue.push(chunk);
    drain();
  });
  socket.on('error', () => shut());
  socket.on('close', () => shut());

  const settled = new Promise<Setup>((resolve, reject) => {
    setupDone = resolve;
    setupFailed = reject;
  });
  const setupTimer = setTimeout(() => fail('timeout', 'setup'), requestMs);
  // Byte order 'l', protocol 11.0, no authorization.
  socket.write(Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const info = await settled.finally(() => clearTimeout(setupTimer));

  // One request at a time: a reply is matched by its sequence number, and a batch ends with a request that always answers.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const exchange = (data: Buffer, count: number, limits: { maxExtra: number; exactExtra?: number; ms: number }): Promise<Exchange> =>
    new Promise((resolve) => {
      if (closed) return resolve({ kind: 'dead' });
      const first = seq + 1;
      seq += count;
      const timer = setTimeout(() => fail('timeout', 'request'), limits.ms);
      pending = { first, last: seq, maxExtra: limits.maxExtra, ...(limits.exactExtra !== undefined ? { exactExtra: limits.exactExtra } : {}), failed: [], timer, done: resolve };
      socket.write(data);
    });

  const simple = (opcode: number, data1: number, words: number, rest?: Buffer): Buffer => {
    const b = Buffer.alloc(words * 4);
    b[0] = opcode;
    b[1] = data1;
    b.writeUInt16LE(words, 2);
    rest?.copy(b, 4);
    return b;
  };

  const size = { width: info.width, height: info.height };

  const geometryNow = (): Promise<{ width: number; height: number; depth: number } | null> =>
    serial(async () => {
      const rest = Buffer.alloc(4);
      rest.writeUInt32LE(info.root, 0);
      const r = await exchange(simple(OP_GET_GEOMETRY, 0, 2, rest), 1, { maxExtra: 0, ms: requestMs });
      if (r.kind !== 'reply') return null;
      const width = r.reply.readUInt16LE(16);
      const height = r.reply.readUInt16LE(18);
      size.width = width;
      size.height = height;
      return { width, height, depth: r.reply[1] };
    });

  // XTEST: asked once, at the start; an absent extension leaves the frames working and the input off.
  const major = await serial(async () => {
    const name = Buffer.from('XTEST');
    const body = Buffer.alloc(4 + pad4(name.length));
    body.writeUInt16LE(name.length, 0);
    name.copy(body, 4);
    const r = await exchange(simple(OP_QUERY_EXTENSION, 0, 2 + pad4(name.length) / 4, body), 1, { maxExtra: 0, ms: requestMs });
    return r.kind === 'reply' && r.reply[8] === 1 ? r.reply[9] : 0;
  });
  if (closed) throw new X11Error('closed', 'lost during the setup');

  let keymapCached: X11Keymap | null = null;

  const conn: X11Connection = {
    root: info.root,
    size,
    canInput: major > 0,
    get closed() {
      return closed;
    },
    geometry: geometryNow,
    async grab() {
      const g = await geometryNow();
      // A screen another size than a frame the app can take, or a depth that is not 24 on 32 bits per pixel, has no frame.
      if (!g || g.depth !== 24 || info.bitsPerPixel !== 32) return null;
      const { width, height } = g;
      if (width < 1 || height < 1 || width > SCREEN_SIDE_MAX || height > SCREEN_SIDE_MAX || width * height * 4 > FRAME_BYTES_MAX) return null;
      return serial(async () => {
        const rest = Buffer.alloc(16);
        rest.writeUInt32LE(info.root, 0);
        rest.writeInt16LE(0, 4);
        rest.writeInt16LE(0, 6);
        rest.writeUInt16LE(width, 8);
        rest.writeUInt16LE(height, 10);
        rest.writeUInt32LE(0xffffffff, 12);
        // Format 2 is ZPixmap.
        const r = await exchange(simple(OP_GET_IMAGE, 2, 5, rest), 1, { maxExtra: width * height * 4, exactExtra: width * height * 4, ms: imageMs });
        if (r.kind !== 'reply' || r.reply[1] !== 24) return null;
        return { width, height, data: r.reply.subarray(32) };
      });
    },
    async keymap() {
      if (keymapCached) return keymapCached;
      const count = info.maxKeycode - info.minKeycode + 1;
      if (count < 1) return null;
      const got = await serial(async () => {
        const rest = Buffer.alloc(4);
        rest[0] = info.minKeycode;
        rest[1] = count;
        const r = await exchange(simple(OP_GET_KEYBOARD_MAPPING, 0, 2, rest), 1, { maxExtra: KEYMAP_MAX, ms: requestMs });
        if (r.kind !== 'reply') return null;
        const width = r.reply[1];
        const extra = r.reply.length - 32;
        if (width < 1 || extra !== count * width * 4) return null;
        const syms = new Uint32Array(count * width);
        for (let i = 0; i < syms.length; i++) syms[i] = r.reply.readUInt32LE(32 + 4 * i);
        return { first: info.minKeycode, width, syms };
      });
      if (got) keymapCached = got;
      return got;
    },
    async fakeInput(events) {
      if (closed || major === 0 || events.length === 0 || events.length > FAKE_INPUT_MAX) return { ok: false, delivered: 0 };
      const data = Buffer.alloc(events.length * 36 + 4);
      events.forEach((e, i) => {
        const at = i * 36;
        data[at] = major;
        data[at + 1] = XTEST_FAKE_INPUT;
        data.writeUInt16LE(9, at + 2);
        // Time 0 is the server's own clock; the root window is the one the pointer is relative to.
        data.writeUInt32LE(info.root, at + 12);
        if (e.type === 'motion') {
          data[at + 4] = FAKE_MOTION;
          data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(e.x))), at + 24);
          data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(e.y))), at + 26);
        } else if (e.type === 'button') {
          data[at + 4] = e.down ? FAKE_BUTTON_PRESS : FAKE_BUTTON_RELEASE;
          data[at + 5] = e.button;
        } else {
          data[at + 4] = e.down ? FAKE_KEY_PRESS : FAKE_KEY_RELEASE;
          data[at + 5] = e.keycode;
        }
      });
      // A request nobody answers: the barrier is one that does, and by the time its reply comes every request before it was processed, so an error that came first
      // names one that failed.
      data[events.length * 36] = OP_GET_INPUT_FOCUS;
      data.writeUInt16LE(1, events.length * 36 + 2);
      const r = await serial(() => exchange(data, events.length + 1, { maxExtra: 0, ms: requestMs }));
      if (r.kind !== 'reply') return { ok: false, delivered: 0 };
      const delivered = events.length - r.failed.length;
      return { ok: delivered === events.length, delivered };
    },
    onClose(cb) {
      if (closed) cb();
      else closers.push(cb);
    },
    close: shut,
  };
  return conn;
}
