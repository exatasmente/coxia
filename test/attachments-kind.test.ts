import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS, attachmentExt, cleanAttachmentName, detectAttachmentKind, formatBytes } from '../src/shared/attachments';

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

// A one-pixel PNG: the smallest real image, used only to give the signature something honest.
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
const GIF = text('GIF89a').slice(0, 6) as Uint8Array;
const PDF = text('%PDF-1.7\n1 0 obj\n');

describe('the kind of an attachment is decided by its content', () => {
  it('reads the signature of an image, whatever the name would say', () => {
    expect(detectAttachmentKind(PNG)).toBe('image');
    expect(detectAttachmentKind(JPEG)).toBe('image');
    expect(detectAttachmentKind(GIF)).toBe('image');
    expect(detectAttachmentKind(WEBP)).toBe('image');
  });

  it('reads a PDF by %PDF-', () => {
    expect(detectAttachmentKind(PDF)).toBe('pdf');
  });

  it('reads JSON when the text begins with { or [ and parses', () => {
    expect(detectAttachmentKind(text('{"a": 1}'))).toBe('json');
    expect(detectAttachmentKind(text('[1, 2, 3]'))).toBe('json');
    expect(detectAttachmentKind(text('  \n\t{"a":1}'))).toBe('json');
  });

  it('reads CSV when two or more lines share the same comma-separated field count', () => {
    expect(detectAttachmentKind(text('name,size\nlog,12\n'))).toBe('csv');
    expect(detectAttachmentKind(text('a,b,c\r\n1,2,3\r\n'))).toBe('csv');
  });

  it('reads plain text as text: JSON and CSV that do not hold up fall back', () => {
    expect(detectAttachmentKind(text('hello world\nsecond line\n'))).toBe('text');
    expect(detectAttachmentKind(text('{"unterminated": \n'))).toBe('text');
    expect(detectAttachmentKind(text('just one line, with a comma\n'))).toBe('text');
    // a comma line whose field counts differ is not a table
    expect(detectAttachmentKind(text('a,b\n1,2,3\n'))).toBe('text');
  });

  it('refuses a ZIP or Office container, whatever the name says', () => {
    expect(detectAttachmentKind(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBeNull();
    expect(detectAttachmentKind(bytes(0x50, 0x4b, 0x05, 0x06, 0x00, 0x00))).toBeNull();
  });

  it('refuses a binary with a NUL in its first bytes', () => {
    expect(detectAttachmentKind(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
    expect(detectAttachmentKind(text('MZ\u0000\u0000binary'))).toBeNull();
  });

  it('does not let a name with the extension swapped fool it, in either direction', () => {
    // a PNG named .txt is still an image; a text named .png is still text
    expect(detectAttachmentKind(PNG)).toBe('image');
    expect(detectAttachmentKind(text('notes about the png\nmore text\n'))).toBe('text');
  });

  it('gives a file on disk an extension from the kind, never from the name', () => {
    expect(attachmentExt('image')).toBe('.img');
    expect(attachmentExt('text')).toBe('.txt');
    expect(attachmentExt('pdf')).toBe('.pdf');
    expect(attachmentExt('json')).toBe('.json');
    expect(attachmentExt('csv')).toBe('.csv');
  });
});

describe('the name a person gave a file is data', () => {
  it('drops control characters, trims and caps at 200 characters', () => {
    expect(cleanAttachmentName('  shot.png  ')).toBe('shot.png');
    expect(cleanAttachmentName('a\u0000b\u001fc.png')).toBe('abc.png');
    expect(cleanAttachmentName('x'.repeat(300))).toHaveLength(200);
    expect(cleanAttachmentName('')).toBe('file');
    expect(cleanAttachmentName(undefined)).toBe('file');
  });

  it('lets a name carry a slash or dots without it meaning a path', () => {
    // the store never uses the name as a path; the value comes back as given (minus controls)
    expect(cleanAttachmentName('../../etc/passwd')).toBe('../../etc/passwd');
  });
});

describe('the size a person reads', () => {
  it('formats bytes, kB and MB', () => {
    expect(formatBytes(830)).toBe('830 B');
    expect(formatBytes(12 * 1024)).toBe('12 kB');
    expect(formatBytes(4.5 * 1024 * 1024)).toBe('4.5 MB');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('keeps the limits the spec proposed', () => {
    expect(ATTACHMENT_LIMITS.imageBytes).toBe(5 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.otherBytes).toBe(1024 * 1024);
    expect(ATTACHMENT_LIMITS.messageBytes).toBe(10 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.perMessage).toBe(10);
  });
});
