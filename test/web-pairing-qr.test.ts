import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { consumePairFragment } from '../src/renderer/src/pairFragment';
import { MAX_QR_BYTES, encodeQr, formatBits, qrPath, reedSolomon } from '../src/shared/qr';
import { pairingLink, readPairFragment } from '../src/shared/webAccess';

const PUBLIC = 'https://coxia.acme.test/cerimonias/';

describe('qr encoder', () => {
  it('matches the ISO 18004 example: "01234567", version 1-M, error correction codewords', () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(reedSolomon(data, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it('produces the format information words of level L for the eight masks', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(formatBits)).toEqual([0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976]);
  });

  it('picks the smallest version that fits', () => {
    expect(encodeQr('a').length).toBe(21);
    expect(encodeQr('x'.repeat(17)).length).toBe(21);
    expect(encodeQr('x'.repeat(18)).length).toBe(25);
    expect(encodeQr(pairingLink(PUBLIC, 'ZEPC-QDFJ-B3B4')).length).toBe(33);
    expect(encodeQr('x'.repeat(MAX_QR_BYTES)).length).toBe(41);
    expect(() => encodeQr('x'.repeat(MAX_QR_BYTES + 1))).toThrow(/grande demais/);
  });

  it('draws finder, timing and the dark module, and is deterministic', () => {
    const m = encodeQr(pairingLink(PUBLIC, 'ZEPC-QDFJ-B3B4'));
    const n = m.length;
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let dr = 0; dr < 7; dr++) for (let dc = 0; dc < 7; dc++) {
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        expect(m[r0 + dr][c0 + dc], `${r0},${c0}+${dr},${dc}`).toBe(ring !== 2);
      }
    }
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8][8]).toBe(true);
    expect(encodeQr(pairingLink(PUBLIC, 'ZEPC-QDFJ-B3B4'))).toEqual(m);
    expect(encodeQr(pairingLink(PUBLIC, 'ZEPC-QDFJ-B3B5'))).not.toEqual(m);
  });

  it('renders an SVG path with a quiet zone of four modules', () => {
    const m = encodeQr('a');
    const { d, size } = qrPath(m);
    expect(size).toBe(29);
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect((d.match(/M/g) ?? []).length).toBe(m.flat().filter(Boolean).length);
  });
});

describe('pairing link', () => {
  it('carries the code in the fragment, never in the query string', () => {
    const link = pairingLink(PUBLIC, 'ZEPC-QDFJ-B3B4');
    const url = new URL(link);
    expect(link).toBe('https://coxia.acme.test/cerimonias/#pair=ZEPC-QDFJ-B3B4');
    expect(url.search).toBe('');
    expect(url.pathname).toBe('/cerimonias/');
    expect(url.hash).toBe('#pair=ZEPC-QDFJ-B3B4');
    // what the browser sends to nginx and Cloudflare: no fragment
    expect(`${url.origin}${url.pathname}${url.search}`).not.toContain('ZEPC');
  });

  it('drops any query or fragment of the configured public url', () => {
    expect(pairingLink('https://coxia.acme.test/cerimonias/?x=1#old', 'AAAA-BBBB-CCCC')).toBe('https://coxia.acme.test/cerimonias/#pair=AAAA-BBBB-CCCC');
  });

  it('reads only a well formed pair fragment', () => {
    expect(readPairFragment('#pair=ZEPC-QDFJ-B3B4')).toBe('ZEPC-QDFJ-B3B4');
    expect(readPairFragment('#pair=short')).toBeNull();
    expect(readPairFragment('#pair=ZEPC-QDFJ-B3B4&x=1')).toBeNull();
    expect(readPairFragment('#other=ZEPC-QDFJ-B3B4')).toBeNull();
    expect(readPairFragment('')).toBeNull();
  });
});

describe('the web app strips the code from the address bar', () => {
  function fakeWindow(hash: string) {
    const win = {
      location: { hash, pathname: '/cerimonias/', search: '?a=1' },
      history: {
        replaced: [] as Array<string | null | undefined>,
        replaceState(_data: unknown, _unused: string, url?: string | null) {
          this.replaced.push(url);
          win.location.hash = '';
        },
      },
    };
    return win;
  }

  it('returns the code and rewrites the URL without the fragment, keeping path and query', () => {
    const win = fakeWindow('#pair=ZEPC-QDFJ-B3B4');
    expect(consumePairFragment(win)).toBe('ZEPC-QDFJ-B3B4');
    expect(win.history.replaced).toEqual(['/cerimonias/?a=1']);
    expect(win.location.hash).toBe('');
  });

  it('strips even a malformed pair fragment, and leaves other fragments alone', () => {
    const bad = fakeWindow('#pair=x');
    expect(consumePairFragment(bad)).toBeNull();
    expect(bad.history.replaced).toHaveLength(1);
    const other = fakeWindow('#section');
    expect(consumePairFragment(other)).toBeNull();
    expect(other.history.replaced).toHaveLength(0);
  });

  it('is wired before anything renders: WebGate reads it at load, and the Settings QR is built with pairingLink', () => {
    const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
    expect(read('src/renderer/src/WebGate.tsx')).toMatch(/const pairCode = isWeb\(\) \? consumePairFragment\(window\) : null/);
    expect(read('src/renderer/src/screens/WebAccessSection.tsx')).toContain('pairingLink(settings.publicUrl, pair.code)');
  });
});
