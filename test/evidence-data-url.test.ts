import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_MAX_BYTES, evidenceDataUrl } from '../src/shared/evidence';

const decoded = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** The sources the desktop's `<meta>` policy allows for an image. */
const desktopImgSrc = (): string[] => {
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const directive = policy.split(';').map((d) => d.trim().split(/\s+/)).find(([name]) => name === 'img-src');
  return directive?.slice(1) ?? [];
};

describe('an image of evidence as a data address', () => {
  it('carries the media type and the exact bytes, from an ArrayBuffer or a Uint8Array', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x80]);
    const url = evidenceDataUrl(bytes.buffer, 'image/png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect([...decoded(url)]).toEqual([...bytes]);
    expect(evidenceDataUrl(bytes, 'image/png')).toBe(url);
  });

  it('encodes a file at the ceiling the same way without the native encoder, and without overflowing the stack', () => {
    const bytes = new Uint8Array(EVIDENCE_MAX_BYTES).map((_, i) => (i * 31) & 0xff);
    const native = evidenceDataUrl(bytes, 'image/jpeg');
    // An older paired browser has no Uint8Array.prototype.toBase64.
    Object.defineProperty(bytes, 'toBase64', { value: undefined });
    const fallback = evidenceDataUrl(bytes, 'image/jpeg');
    expect(fallback).toBe(native);
    expect(decoded(fallback).equals(Buffer.from(bytes))).toBe(true);
  });

  it('is a source the desktop policy allows, which a blob address is not', () => {
    const sources = desktopImgSrc();
    expect(sources).toContain('data:');
    expect(sources).not.toContain('blob:');
  });
});
