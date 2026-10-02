import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_CHANNELS, buildApi } from '../src/shared/apiChannels';
import { base64ToArrayBuffer, bytesToBase64, decodeWire, encodeWire } from '../src/shared/wire';

const read = (p: string): string => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('channel table', () => {
  it('builds every method from the table, passing the arguments through', async () => {
    const calls: unknown[][] = [];
    const api = buildApi(async (channel, ...args) => void calls.push([channel, ...args]), () => () => undefined);
    for (const [method, channel] of Object.entries(API_CHANNELS)) {
      calls.length = 0;
      await (api as unknown as Record<string, (...a: unknown[]) => unknown>)[method]('a', 2);
      expect(calls, method).toEqual([[channel, 'a', 2]]);
    }
  });

  it('covers every method of the Api interface, so preload and browser cannot drift', () => {
    const body = /export interface Api \{([\s\S]*?)\n\}/.exec(read('src/shared/types.ts'))?.[1] ?? '';
    const methods = [...body.matchAll(/^ {2}(\w+)[(<]/gm)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(30);
    for (const m of methods) {
      if (m === 'invoke' || m === 'onEvent') continue;
      expect(Object.keys(API_CHANNELS), m).toContain(m);
    }
  });

  it('is the only place with channel names: preload and the web adapter use buildApi', () => {
    for (const file of ['src/preload/index.ts', 'src/renderer/src/webApi.ts']) {
      const text = read(file);
      expect(text, file).toContain('buildApi(');
      expect(text, file).not.toMatch(/'(state|cards|agent|voice|actions|gate):\w+'/);
    }
  });

  it('has a main-process handler for every channel in the table', () => {
    const main = read('src/main/index.ts');
    for (const channel of Object.values(API_CHANNELS)) expect(main, channel).toContain(`handle('${channel}'`);
  });

  it('has no duplicate channels', () => {
    const values = Object.values(API_CHANNELS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('wire format', () => {
  it('round trips bytes as base64', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(new Uint8Array(base64ToArrayBuffer(bytesToBase64(bytes)))).toEqual(bytes);
  });

  it('tags ArrayBuffer, typed arrays and Buffer, and decodes them to ArrayBuffer', () => {
    const buf = new Uint8Array([1, 2, 3, 250]);
    const sent = JSON.parse(JSON.stringify(encodeWire(['x', buf.buffer, Buffer.from(buf), { audio: buf }])));
    expect(sent[1]).toEqual({ $bytes: 'AQID+g==' });
    const got = decodeWire(sent) as [string, ArrayBuffer, ArrayBuffer, { audio: ArrayBuffer }];
    expect(got[1]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(got[1])).toEqual(buf);
    expect(new Uint8Array(got[2])).toEqual(buf);
    expect(new Uint8Array(got[3].audio)).toEqual(buf);
  });

  it('keeps undefined arguments and null results apart', () => {
    const sent = JSON.parse(JSON.stringify(encodeWire(['a', undefined, null])));
    expect(decodeWire(sent)).toEqual(['a', undefined, null]);
    expect(decodeWire(JSON.parse(JSON.stringify(encodeWire(undefined))))).toBeUndefined();
  });

  it('leaves plain data alone', () => {
    const value = { a: [1, 'b', { c: null }], d: true };
    expect(decodeWire(JSON.parse(JSON.stringify(encodeWire(value))))).toEqual(value);
  });
});
