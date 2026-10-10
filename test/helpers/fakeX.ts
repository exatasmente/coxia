import { mkdtempSync, rmSync } from 'node:fs';
import { type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fake X server on a unix socket, with the replies of a plain 1280x800x24 display and the knobs a test needs to make it misbehave. It speaks only the requests the
// app's client sends, which are the only ones it understands. Nothing real is dialled.

export interface FakeXRequest {
  opcode: number;
  /** Minor opcode of an extension request, or the data byte of a core one. */
  data1: number;
  seq: number;
  bytes: Buffer;
}

export interface FakeXOptions {
  width?: number;
  height?: number;
  /** Depth of the root and its pixel format. */
  depth?: number;
  bitsPerPixel?: number;
  /** 0 is the little-endian image byte order the client needs. */
  imageOrder?: number;
  /** The server has XTEST. */
  xtest?: boolean;
  /** Keycodes `minKeycode..maxKeycode` map to `syms` (two per keycode). */
  minKeycode?: number;
  syms?: number[][];
  /** The first byte of the setup reply (1 is Success). */
  setupStatus?: number;
  /** Words of additional data the setup reply claims, in place of the real ones. */
  setupClaims?: number;
  /** What the GetImage reply carries, in place of a gradient. */
  image?: (width: number, height: number) => Buffer;
  /** The length field of the GetImage reply, in place of the right one. */
  imageLength?: number;
  /** The root's children, bottom to top; read at each request, so a test can open and close windows under a connection. */
  windows?: FakeXWindow[];
  /** The child count the QueryTree reply claims, in place of the right one. */
  treeCount?: number;
  /** Requests with these opcodes are never answered. */
  silent?: number[];
  /** Answers the request itself and returns true, or leaves it to the server. */
  override?: (req: FakeXRequest, send: (b: Buffer) => void, socket: Socket) => boolean;
  /** An XTEST request this returns true for gets an error packet. */
  failFake?: (req: FakeXRequest) => boolean;
}

export interface FakeXWindow {
  id: number;
  /** 0 Unmapped, 1 Unviewable, 2 Viewable. */
  mapState: number;
  /** 1 InputOutput, 2 InputOnly. */
  klass?: number;
}

export const XTEST_MAJOR = 132;
export const FAKE_ROOT = 0x2a3;
const pad4 = (n: number): number => (n + 3) & ~3;

export interface FakeX {
  path: string;
  requests: FakeXRequest[];
  /** The setup request arrived as these bytes. */
  setups: Buffer[];
  connections: number;
  /** Closes the server and every connection; removes the folder. */
  close(): Promise<void>;
  /** Sends bytes to the connection at once (an event, a stray reply). */
  push(b: Buffer): void;
}

export function defaultSyms(): number[][] {
  // 8 a/A, 9 Return, 10 Tab, 11 Left, 12 Shift_L, 13 8/asterisk, 14 Escape, 15 Control_L, 16 Alt_L
  return [
    [0x61, 0x41],
    [0xff0d, 0],
    [0xff09, 0],
    [0xff51, 0],
    [0xffe1, 0],
    [0x38, 0x2a],
    [0xff1b, 0],
    [0xffe3, 0],
    [0xffe9, 0],
  ];
}

function setupReply(o: FakeXOptions): Buffer {
  const vendor = Buffer.from('Fake X');
  const formats = 1;
  const depth = o.depth ?? 24;
  const body = Buffer.alloc(32 + pad4(vendor.length) + 8 * formats + 40);
  body.writeUInt32LE(11000000, 0);
  body.writeUInt16LE(vendor.length, 16);
  body.writeUInt16LE(0xffff, 18);
  body[20] = 1;
  body[21] = formats;
  body[22] = o.imageOrder ?? 0;
  body[26] = o.minKeycode ?? 8;
  body[27] = (o.minKeycode ?? 8) + (o.syms ?? defaultSyms()).length - 1;
  vendor.copy(body, 32);
  const f = 32 + pad4(vendor.length);
  body[f] = depth;
  body[f + 1] = o.bitsPerPixel ?? 32;
  body[f + 2] = 32;
  const s = f + 8 * formats;
  body.writeUInt32LE(FAKE_ROOT, s);
  body.writeUInt16LE(o.width ?? 1280, s + 20);
  body.writeUInt16LE(o.height ?? 800, s + 22);
  body[s + 38] = depth;
  const head = Buffer.alloc(8);
  head[0] = o.setupStatus ?? 1;
  head.writeUInt16LE(11, 2);
  head.writeUInt16LE(o.setupClaims ?? body.length / 4, 6);
  return Buffer.concat([head, body]);
}

function reply(seq: number, data1: number, extra: Buffer, fill?: (b: Buffer) => void, lengthWords?: number): Buffer {
  const b = Buffer.alloc(32 + extra.length);
  b[0] = 1;
  b[1] = data1;
  b.writeUInt16LE(seq & 0xffff, 2);
  b.writeUInt32LE(lengthWords ?? extra.length / 4, 4);
  fill?.(b);
  extra.copy(b, 32);
  return b;
}

function errorPacket(seq: number, code: number, opcode: number): Buffer {
  const b = Buffer.alloc(32);
  b[0] = 0;
  b[1] = code;
  b.writeUInt16LE(seq & 0xffff, 2);
  b[10] = opcode;
  return b;
}

export async function startFakeX(o: FakeXOptions = {}): Promise<FakeX> {
  const dir = mkdtempSync(join(tmpdir(), 'coxia-fakex-'));
  const path = join(dir, 'X99');
  const requests: FakeXRequest[] = [];
  const setups: Buffer[] = [];
  const sockets = new Set<Socket>();
  const state = { connections: 0 };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    state.connections++;
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let seq = 0;
    let started = false;
    const send = (b: Buffer): void => void socket.write(b);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!started) {
          if (buf.length < 12) return;
          setups.push(buf.subarray(0, 12));
          buf = buf.subarray(12);
          started = true;
          send(setupReply(o));
          continue;
        }
        if (buf.length < 4) return;
        const len = buf.readUInt16LE(2) * 4;
        if (len === 0 || buf.length < len) return;
        const bytes = buf.subarray(0, len);
        buf = buf.subarray(len);
        seq++;
        // Read at each request, so a test can change the screen under a connection.
        const width = o.width ?? 1280;
        const height = o.height ?? 800;
        const syms = o.syms ?? defaultSyms();
        const req: FakeXRequest = { opcode: bytes[0], data1: bytes[1], seq, bytes };
        requests.push(req);
        if (o.silent?.includes(req.opcode)) continue;
        if (o.override?.(req, send, socket)) continue;
        switch (req.opcode) {
          case 14: {
            send(reply(seq, o.depth ?? 24, Buffer.alloc(0), (b) => {
              b.writeUInt32LE(FAKE_ROOT, 8);
              b.writeUInt16LE(width, 16);
              b.writeUInt16LE(height, 18);
            }));
            break;
          }
          case 73: {
            const w = bytes.readUInt16LE(12);
            const h = bytes.readUInt16LE(14);
            if (w > width || h > height) {
              send(errorPacket(seq, 8, 73));
              break;
            }
            const data = o.image ? o.image(w, h) : gradient(w, h);
            send(reply(seq, o.depth ?? 24, data, undefined, o.imageLength));
            break;
          }
          case 15: {
            const list = o.windows ?? [];
            const body = Buffer.alloc(list.length * 4);
            list.forEach((w, i) => body.writeUInt32LE(w.id, 4 * i));
            send(reply(seq, 0, body, (b) => {
              b.writeUInt32LE(FAKE_ROOT, 8);
              b.writeUInt16LE(o.treeCount ?? list.length, 16);
            }));
            break;
          }
          case 3: {
            const w = (o.windows ?? []).find((x) => x.id === bytes.readUInt32LE(4));
            if (!w) {
              send(errorPacket(seq, 3, 3));
              break;
            }
            send(reply(seq, 0, Buffer.alloc(12), (b) => {
              b.writeUInt16LE(w.klass ?? 1, 12);
              b[26] = w.mapState;
            }));
            break;
          }
          case 98: {
            const n = bytes.readUInt16LE(4);
            const name = bytes.subarray(8, 8 + n).toString();
            const present = name === 'XTEST' && (o.xtest ?? true);
            send(reply(seq, 0, Buffer.alloc(0), (b) => {
              b[8] = present ? 1 : 0;
              b[9] = present ? XTEST_MAJOR : 0;
            }));
            break;
          }
          case 101: {
            const first = bytes[4];
            const count = bytes[5];
            const per = 2;
            const body = Buffer.alloc(count * per * 4);
            for (let i = 0; i < count; i++) for (let j = 0; j < per; j++) body.writeUInt32LE(syms[first - (o.minKeycode ?? 8) + i]?.[j] ?? 0, 4 * (i * per + j));
            send(reply(seq, per, body));
            break;
          }
          case 43:
            send(reply(seq, 0, Buffer.alloc(0)));
            break;
          case XTEST_MAJOR:
            if (o.failFake?.(req)) send(errorPacket(seq, 2, XTEST_MAJOR));
            break;
          default:
            send(errorPacket(seq, 1, req.opcode));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    path,
    requests,
    setups,
    get connections() {
      return state.connections;
    },
    push(b) {
      for (const s of sockets) s.write(b);
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A BGRX gradient: the pixel at (x, y) is blue x mod 256, green y mod 256, red 7, pad 0. */
export function gradient(w: number, h: number): Buffer {
  const b = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      b[i] = x & 0xff;
      b[i + 1] = y & 0xff;
      b[i + 2] = 7;
    }
  }
  return b;
}
