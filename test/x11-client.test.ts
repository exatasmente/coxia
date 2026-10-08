// The app's client of an agent's virtual display (#157), against a fake X server on a unix socket: the setup, the size of the root, the frame of `GetImage` and what
// is no frame, the request layout of `XTestFakeInput` and a server that misbehaves (an error packet, a reply nobody asked for, silence, a setup that claims too much).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type X11Connection, X11Error, connectX11 } from '../src/main/screen/x11';
import { FAKE_ROOT, type FakeX, type FakeXOptions, XTEST_MAJOR, gradient, startFakeX } from './helpers/fakeX';

let servers: FakeX[] = [];
let conns: X11Connection[] = [];
afterEach(async () => {
  for (const c of conns) c.close();
  for (const s of servers) await s.close();
  servers = [];
  conns = [];
});

async function open(o: FakeXOptions = {}, deps: Parameters<typeof connectX11>[1] = {}): Promise<{ x: FakeX; c: X11Connection; o: FakeXOptions }> {
  const x = await startFakeX(o);
  servers.push(x);
  const c = await connectX11(x.path, deps);
  conns.push(c);
  return { x, c, o };
}

const fakes = (x: FakeX): Buffer[] => x.requests.filter((r) => r.opcode === XTEST_MAJOR).map((r) => r.bytes);

describe('connecting', () => {
  it('does the setup, learns the root window and its size, and finds XTEST', async () => {
    const { x, c } = await open();
    expect(x.setups[0]).toEqual(Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(c.root).toBe(FAKE_ROOT);
    expect(c.size).toEqual({ width: 1280, height: 800 });
    expect(c.canInput).toBe(true);
    expect(c.closed).toBe(false);
  });

  it('works without XTEST: frames still come and no input is sent', async () => {
    const { x, c } = await open({ xtest: false });
    expect(c.canInput).toBe(false);
    expect(await c.fakeInput([{ type: 'motion', x: 1, y: 2 }])).toEqual({ ok: false, delivered: 0 });
    expect(fakes(x)).toHaveLength(0);
    expect(await c.grab()).not.toBeNull();
  });

  it('refuses a path that is not a socket before it dials anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coxia-x11-'));
    try {
      const file = join(dir, 'X99');
      writeFileSync(file, 'x');
      const connect = vi.fn();
      await expect(connectX11(file, { connect })).rejects.toMatchObject({ code: 'not-socket' });
      await expect(connectX11(join(dir, 'missing'), { connect })).rejects.toMatchObject({ code: 'not-socket' });
      expect(connect).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a socket nobody listens on as a connect failure', async () => {
    const x = await startFakeX();
    const path = x.path;
    await x.close();
    await expect(connectX11(path, { isSocket: () => true })).rejects.toMatchObject({ code: 'connect' });
  });

  it('refuses a setup that failed, that claims more than 64 KiB and that is not little-endian', async () => {
    for (const o of [{ setupStatus: 0 }, { setupStatus: 2 }, { setupClaims: 17000 }, { imageOrder: 1 }] satisfies FakeXOptions[]) {
      const x = await startFakeX(o);
      servers.push(x);
      const e = await connectX11(x.path).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(X11Error);
      expect((e as X11Error).code).toBe('setup');
    }
  });

  it('gives up on a server that never answers the setup', async () => {
    // A server that accepts and says nothing.
    const net = await import('node:net');
    const quiet = net.createServer(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), 'coxia-x11-'));
    const path = join(dir, 'X1');
    await new Promise<void>((r) => quiet.listen(path, r));
    try {
      await expect(connectX11(path, { requestMs: 60 })).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      quiet.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the frame', () => {
  it('asks for the geometry, then the whole root as a ZPixmap, and returns the pixels as they are', async () => {
    const { x, c } = await open({ width: 64, height: 32 });
    const f = await c.grab();
    expect(f).not.toBeNull();
    expect(f?.width).toBe(64);
    expect(f?.height).toBe(32);
    expect(f?.data.equals(gradient(64, 32))).toBe(true);
    // Pixel (5, 3): blue 5, green 3, red 7 (blue, green, red, pad).
    expect([...(f?.data.subarray((3 * 64 + 5) * 4, (3 * 64 + 5) * 4 + 4) ?? [])]).toEqual([5, 3, 7, 0]);
    const ops = x.requests.map((r) => r.opcode);
    expect(ops.indexOf(14)).toBeLessThan(ops.indexOf(73));
    const get = x.requests.find((r) => r.opcode === 73)?.bytes as Buffer;
    expect(get.length).toBe(20);
    expect(get[1]).toBe(2);
    expect(get.readUInt32LE(4)).toBe(FAKE_ROOT);
    expect([get.readInt16LE(8), get.readInt16LE(10), get.readUInt16LE(12), get.readUInt16LE(14)]).toEqual([0, 0, 64, 32]);
    expect(get.readUInt32LE(16)).toBe(0xffffffff);
  });

  it('reads the full 1280x800x24 frame', async () => {
    const { c } = await open();
    const f = await c.grab();
    expect(f?.data.length).toBe(1280 * 800 * 4);
  });

  it('follows a root that changed size, and never asks for more than the root has', async () => {
    const { x, c, o } = await open({ width: 64, height: 32 });
    o.width = 40;
    o.height = 20;
    const f = await c.grab();
    expect([f?.width, f?.height, f?.data.length]).toEqual([40, 20, 40 * 20 * 4]);
    expect(c.size).toEqual({ width: 40, height: 20 });
    expect(x.requests.filter((r) => r.opcode === 73).every((r) => r.bytes.readUInt16LE(12) <= 64)).toBe(true);
  });

  it('is no frame for a depth that is not 24', async () => {
    const { x, c } = await open({ depth: 16, bitsPerPixel: 16 });
    expect(await c.grab()).toBeNull();
    expect(x.requests.some((r) => r.opcode === 73)).toBe(false);
  });

  it('is no frame for a pixel format that is not 32 bits', async () => {
    const { x, c } = await open({ bitsPerPixel: 24 });
    expect(await c.grab()).toBeNull();
    expect(x.requests.some((r) => r.opcode === 73)).toBe(false);
  });

  it('is no frame for a screen over 4096 on a side or over 16 MiB of pixels, without asking for it', async () => {
    for (const [width, height] of [
      [4097, 100],
      [100, 4097],
      [4096, 4096],
    ]) {
      const { x, c } = await open({ width, height });
      expect(await c.grab()).toBeNull();
      expect(x.requests.some((r) => r.opcode === 73)).toBe(false);
      expect(c.closed).toBe(false);
    }
  });

  it('is no frame, and ends the connection, when the reply is not the size the geometry implies', async () => {
    const { c } = await open({ width: 64, height: 32, imageLength: 64 * 32 + 1 });
    expect(await c.grab()).toBeNull();
    expect(c.closed).toBe(true);
  });

  it('is no frame, and ends the connection, when the reply claims more than 16 MiB', async () => {
    const { c } = await open({ width: 64, height: 32, imageLength: 0x7fffffff });
    expect(await c.grab()).toBeNull();
    expect(c.closed).toBe(true);
  });

  it('is no frame when the reply is cut short and the connection ends', async () => {
    const { c } = await open({
      width: 64,
      height: 32,
      override: (req, send, socket) => {
        if (req.opcode !== 73) return false;
        const half = Buffer.alloc(32 + 100);
        half[0] = 1;
        half[1] = 24;
        half.writeUInt16LE(req.seq, 2);
        half.writeUInt32LE(64 * 32, 4);
        send(half);
        setTimeout(() => socket.destroy(), 10);
        return true;
      },
    });
    expect(await c.grab()).toBeNull();
    expect(c.closed).toBe(true);
  });

  it('is no frame, and keeps the connection, when the server answers with an X error', async () => {
    const { c } = await open({
      width: 64,
      height: 32,
      override: (req, send) => {
        if (req.opcode !== 73) return false;
        const e = Buffer.alloc(32);
        e[1] = 8;
        e.writeUInt16LE(req.seq, 2);
        send(e);
        return true;
      },
    });
    expect(await c.grab()).toBeNull();
    expect(c.closed).toBe(false);
    expect(await c.geometry()).toMatchObject({ width: 64, height: 32 });
  });

  it('skips events that arrive between requests, a generic one too', async () => {
    const { c } = await open({
      width: 8,
      height: 8,
      override: (req, send) => {
        if (req.opcode !== 14) return false;
        const ev = Buffer.alloc(32);
        ev[0] = 2;
        send(ev);
        const ge = Buffer.alloc(32 + 8);
        ge[0] = 35 | 0x80;
        ge.writeUInt32LE(2, 4);
        send(ge);
        return false;
      },
    });
    expect(await c.grab()).not.toBeNull();
    expect(c.closed).toBe(false);
  });

  it('ends the connection on a reply nobody asked for', async () => {
    const { x, c } = await open();
    const closed = vi.fn();
    c.onClose(closed);
    const stray = Buffer.alloc(32);
    stray[0] = 1;
    x.push(stray);
    await vi.waitFor(() => expect(c.closed).toBe(true));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(await c.grab()).toBeNull();
  });

  it('ends the connection when a request is not answered in time', async () => {
    const { c } = await open({ silent: [14] }, { requestMs: 60 });
    expect(await c.grab()).toBeNull();
    expect(c.closed).toBe(true);
  });
});

describe('input', () => {
  it('sends a pointer move, a button press and release and a key press and release as XTestFakeInput of 36 bytes', async () => {
    const { x, c } = await open();
    const r = await c.fakeInput([
      { type: 'motion', x: 321, y: 456 },
      { type: 'button', button: 1, down: true },
      { type: 'button', button: 1, down: false },
      { type: 'key', keycode: 38, down: true },
      { type: 'key', keycode: 38, down: false },
    ]);
    expect(r).toEqual({ ok: true, delivered: 5 });
    const f = fakes(x);
    expect(f).toHaveLength(5);
    for (const b of f) {
      expect(b.length).toBe(36);
      expect(b[0]).toBe(XTEST_MAJOR);
      expect(b[1]).toBe(2);
      expect(b.readUInt16LE(2)).toBe(9);
      expect(b.readUInt32LE(8)).toBe(0);
      expect(b.readUInt32LE(12)).toBe(FAKE_ROOT);
      expect(b[35]).toBe(0);
    }
    expect([f[0][4], f[0][5], f[0].readInt16LE(24), f[0].readInt16LE(26)]).toEqual([6, 0, 321, 456]);
    expect([f[1][4], f[1][5], f[2][4], f[2][5]]).toEqual([4, 1, 5, 1]);
    expect([f[3][4], f[3][5], f[4][4], f[4][5]]).toEqual([2, 38, 3, 38]);
  });

  it('ends the batch with a request that answers, so a failure is known by the time it returns', async () => {
    const { x, c } = await open();
    await c.fakeInput([{ type: 'motion', x: 1, y: 1 }]);
    expect(x.requests.at(-1)?.opcode).toBe(43);
  });

  it('names the request that failed: the others are delivered and the connection stays', async () => {
    const { x, c } = await open({ failFake: (req) => req.bytes[5] === 99 });
    const r = await c.fakeInput([
      { type: 'key', keycode: 38, down: true },
      { type: 'key', keycode: 99, down: true },
      { type: 'key', keycode: 38, down: false },
    ]);
    expect(r).toEqual({ ok: false, delivered: 2 });
    expect(c.closed).toBe(false);
    expect(fakes(x)).toHaveLength(3);
    expect(await c.fakeInput([{ type: 'motion', x: 2, y: 2 }])).toEqual({ ok: true, delivered: 1 });
  });

  it('closes and reports not delivered, without throwing, when a reply does not parse', async () => {
    const { c } = await open({
      override: (req, send) => {
        if (req.opcode !== 43) return false;
        const bad = Buffer.alloc(32);
        bad[0] = 1;
        bad.writeUInt16LE(req.seq + 7, 2);
        send(bad);
        return true;
      },
    });
    const closed = vi.fn();
    c.onClose(closed);
    await expect(c.fakeInput([{ type: 'motion', x: 1, y: 1 }])).resolves.toEqual({ ok: false, delivered: 0 });
    expect(c.closed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    await expect(c.fakeInput([{ type: 'motion', x: 1, y: 1 }])).resolves.toEqual({ ok: false, delivered: 0 });
    await expect(c.keymap()).resolves.toBeNull();
  });

  it('closes and reports not delivered when the barrier is never answered', async () => {
    const { c } = await open({ silent: [43] }, { requestMs: 60 });
    expect(await c.fakeInput([{ type: 'motion', x: 1, y: 1 }])).toEqual({ ok: false, delivered: 0 });
    expect(c.closed).toBe(true);
  });

  it('takes no empty batch and no batch over 1024 events', async () => {
    const { x, c } = await open();
    expect(await c.fakeInput([])).toEqual({ ok: false, delivered: 0 });
    expect(await c.fakeInput(Array.from({ length: 1025 }, () => ({ type: 'motion' as const, x: 1, y: 1 })))).toEqual({ ok: false, delivered: 0 });
    expect(fakes(x)).toHaveLength(0);
  });

  it('serves batches one at a time, in the order they were asked', async () => {
    const { x, c } = await open();
    const all = await Promise.all([1, 2, 3].map((n) => c.fakeInput([{ type: 'motion', x: n, y: n }])));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(fakes(x).map((b) => b.readInt16LE(24))).toEqual([1, 2, 3]);
  });
});

describe('the keyboard mapping', () => {
  it('reads it once per connection, from the minimum keycode the server named', async () => {
    const { x, c } = await open();
    const m = await c.keymap();
    expect(m).toMatchObject({ first: 8, width: 2 });
    expect(m?.syms[0]).toBe(0x61);
    expect(m?.syms[1]).toBe(0x41);
    expect(await c.keymap()).toBe(m);
    expect(x.requests.filter((r) => r.opcode === 101)).toHaveLength(1);
  });

  it('is null when the reply has the wrong size', async () => {
    const { c } = await open({
      override: (req, send) => {
        if (req.opcode !== 101) return false;
        const r = Buffer.alloc(32 + 8);
        r[0] = 1;
        r[1] = 2;
        r.writeUInt16LE(req.seq, 2);
        r.writeUInt32LE(2, 4);
        send(r);
        return true;
      },
    });
    expect(await c.keymap()).toBeNull();
    expect(c.closed).toBe(false);
  });
});
