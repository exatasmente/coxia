import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/main/evidence/type';
import { EVIDENCE_MAX_BYTES } from '../src/shared/evidence';

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const text = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'utf8'));
const png = (): Uint8Array => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
const detect = (head: Uint8Array, size = head.length): ReturnType<typeof detectKind> => detectKind(head, size);

describe('the kind of a file, by its content', () => {
  it('recognises the accepted formats from their signature, whatever the name', () => {
    expect(detect(png()).kind).toBe('png');
    expect(detect(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)).kind).toBe('jpeg');
    expect(detect(text('GIF89a...')).kind).toBe('gif');
    expect(detect(text('GIF87a...')).kind).toBe('gif');
    expect(detect(text('RIFF____WEBPVP8 ')).kind).toBe('webp');
    expect(detect(text('%PDF-1.7\n')).kind).toBe('pdf');
  });

  it('reads a plain text file as text and never as an image', () => {
    expect(detect(text('# A short report\n\nWhat was seen.\n')).kind).toBe('text');
    // The name says nothing: a PNG that is really text is text.
    expect(detect(text('this is not an image'), 21).kind).toBe('text');
  });

  it('refuses content that does not confirm anything, with the reason', () => {
    // A file that says it is an image and really is text is text: the content decides, never the name.
    expect(detect(text('PNG, honest')).kind).toBe('text');
    expect(detect(bytes(0x00, 0x01, 0x02, 0x03, 0xff, 0xfe)).problem).toBe('unknown');
    expect(detect(bytes()).problem).toBe('empty');
  });

  it('names the formats the app puts out of scope, so the reason is exact', () => {
    expect(detect(text('\x00\x00\x00\x18ftypisom')).problem).toBe('video');
    expect(detect(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x00)).problem).toBe('video');
    expect(detect(text('RIFF____AVI ')).problem).toBe('video');
    expect(detect(text('OggS....')).problem).toBe('audio');
    expect(detect(text('ID3\x03\x00')).problem).toBe('audio');
    expect(detect(text('fLaC....')).problem).toBe('audio');
  });

  it('refuses an archive and an executable', () => {
    expect(detect(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)).problem).toBe('archive');
    expect(detect(text('PK\x03\x04')).problem).toBe('archive');
    expect(detect(bytes(0x1f, 0x8b, 0x08)).problem).toBe('archive');
    expect(detect(bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01)).problem).toBe('executable');
    expect(detect(bytes(0x4d, 0x5a, 0x90, 0x00)).problem).toBe('executable');
    expect(detect(text('#!/bin/sh\necho hi\n')).problem).toBe('executable');
  });

  it('refuses a file over the ceiling and says which is the ceiling', () => {
    expect(detect(png(), EVIDENCE_MAX_BYTES + 1).problem).toBe('too-long');
    expect(detect(png(), EVIDENCE_MAX_BYTES).kind).toBe('png');
  });
});
