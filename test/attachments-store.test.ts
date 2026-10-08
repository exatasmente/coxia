import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAttachmentStore, type AttachmentStore } from '../src/main/attachments';
import { type AttachmentLimits } from '../src/shared/attachments';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const png = (): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

const LIMITS: AttachmentLimits = { imageBytes: 5 * 1024 * 1024, otherBytes: 1024, messageBytes: 4096, perMessage: 3 };

let root: string;
let store: AttachmentStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-attachments-'));
  store = createAttachmentStore({ base: root, limits: () => LIMITS });
});

const THREAD = 'run-r-abc-1234';

describe('storing an attachment', () => {
  it('keeps the file under the conversation, by the kind the content revealed', () => {
    const ref = store.put(THREAD, 'shot.png', png());
    expect(ref).toMatchObject({ kind: 'image', bytes: 16 });
    expect(ref.id).toMatch(/^[a-f0-9]{16}$/);
    const dir = join(root, 'anexos', THREAD);
    expect(readdirSync(dir)).toEqual([`${ref.id}.img`]);
    // the name the person gave is data, not a path: the file on disk takes the id, never the name
    expect(existsSync(join(dir, 'shot.png'))).toBe(false);
  });

  it('reads back the file it wrote, with the same bytes', () => {
    const ref = store.put(THREAD, 'log.txt', text('hello world\nfrom the person\n'));
    const got = store.get(THREAD, ref.id);
    expect(got?.ref.kind).toBe('text');
    expect(new TextDecoder().decode(got?.bytes)).toBe('hello world\nfrom the person\n');
  });

  it('refuses a file over the limit for its kind, and writes nothing', () => {
    expect(() => store.put(THREAD, 'notes.txt', text('x'.repeat(2048)))).toThrow();
    expect(existsSync(join(root, 'anexos', THREAD))).toBe(false);
  });

  it('refuses a refused kind (a ZIP), and writes nothing', () => {
    expect(() => store.put(THREAD, 'doc.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toThrow();
  });

  it('refuses a message over its total, and over the count of files', () => {
    expect(() => store.put(THREAD, 'a.txt', text('a'.repeat(500)), { messageBytes: 4000 })).toThrow();
    store.put(THREAD, 'a.txt', text('a\nb\n'));
    store.put(THREAD, 'b.txt', text('a\nb\n'));
    store.put(THREAD, 'c.txt', text('a\nb\n'));
    expect(() => store.put(THREAD, 'd.txt', text('a\nb\n'), { count: 3 })).toThrow();
  });

  it('counts the files a conversation already holds', () => {
    expect(store.sizeOf(THREAD)).toBe(0);
    store.put(THREAD, 'a.txt', text('x\ny\n'));
    store.put(THREAD, 'b.txt', text('x\ny\n'));
    expect(store.sizeOf(THREAD)).toBe(2);
    expect(store.list(THREAD)).toHaveLength(2);
  });
});

describe('reaching an attachment', () => {
  it('never resolves an id of another conversation', () => {
    const ref = store.put('run-r-one', 'shot.png', png());
    expect(store.get('run-r-two', ref.id)).toBeNull();
    expect(store.readForTool('run-r-two', ref.id)).toBeNull();
    expect(() => store.drop('run-r-two', ref.id)).not.toThrow();
    expect(store.get('run-r-one', ref.id)).not.toBeNull();
  });

  it('does nothing for an unknown id', () => {
    expect(store.get(THREAD, 'deadbeefdeadbeef')).toBeNull();
    expect(store.readForTool(THREAD, 'nope')).toBeNull();
  });

  it('does not reach a folder outside the conversation', () => {
    // an id that tried to become a path is not a valid id and resolves to nothing
    expect(store.get(THREAD, '../../etc/passwd')).toBeNull();
    expect(store.safeId('../x')).toBe('');
  });

  it('removes one attachment and leaves the others', () => {
    const a = store.put(THREAD, 'a.txt', text('x\ny\n'));
    const b = store.put(THREAD, 'b.txt', text('x\ny\n'));
    store.drop(THREAD, a.id);
    expect(store.get(THREAD, a.id)).toBeNull();
    expect(store.get(THREAD, b.id)).not.toBeNull();
  });
});

describe('dropping a whole conversation', () => {
  it('removes every file of the conversation and its folder, and leaves the other conversations alone', () => {
    const a = store.put(THREAD, 'a.txt', text('x\ny\n'));
    store.put(THREAD, 'shot.png', png());
    store.put(THREAD, 'b.json', text('{"a":1}'));
    const other = store.put('run-r-other-1234', 'c.txt', text('x\ny\n'));
    expect(store.sizeOf(THREAD)).toBe(3);
    store.dropThread(THREAD);
    expect(store.list(THREAD)).toEqual([]);
    expect(store.get(THREAD, a.id)).toBeNull();
    expect(existsSync(join(root, 'anexos', THREAD))).toBe(false);
    expect(store.get('run-r-other-1234', other.id)).not.toBeNull();
    expect(existsSync(join(root, 'anexos'))).toBe(true);
  });

  it('is nothing to do for a conversation that holds nothing, and can be repeated', () => {
    expect(() => store.dropThread('run-r-empty-1234')).not.toThrow();
    store.put(THREAD, 'a.txt', text('x\n'));
    store.dropThread(THREAD);
    expect(() => store.dropThread(THREAD)).not.toThrow();
  });

  it('refuses a name that is no conversation\'s, and never reaches outside the attachments folder', () => {
    store.put(THREAD, 'a.txt', text('x\n'));
    for (const bad of ['', '..', '.', '.hidden', '../anexos', 42, null]) expect(() => store.dropThread(bad as string), String(bad)).toThrow();
    // a path-like name is folded to a harmless one inside the folder, not followed
    expect(() => store.dropThread('a/../../..')).not.toThrow();
    expect(store.list(THREAD)).toHaveLength(1);
    expect(existsSync(join(root, 'anexos'))).toBe(true);
  });
});

describe('reading for the tool', () => {
  it('gives an image as an image, with the name and size as text - never the content', () => {
    const ref = store.put(THREAD, 'shot.png', png());
    const read = store.readForTool(THREAD, ref.id);
    expect(read?.ref.kind).toBe('image');
    expect(read?.text).toBeUndefined();
    expect(read?.reason).toBeUndefined();
  });

  it('gives a text numbered like the Read tool, and says so when it is cut', () => {
    const ref = store.put(THREAD, 'log.txt', text('first\nsecond\nthird\n'));
    const read = store.readForTool(THREAD, ref.id);
    expect(read?.text).toContain('1\tfirst');
    const part = store.readForTool(THREAD, ref.id, 2, 1);
    expect(part?.text).toContain('2\tsecond');
    expect(part?.clipped).toBe(true);
  });

  it('gives a PDF, JSON or CSV the reason it does not go to the model, in words', () => {
    const pdf = store.put(THREAD, 'doc.pdf', text('%PDF-1.7\n'));
    const read = store.readForTool(THREAD, pdf.id);
    expect(read?.text).toBeUndefined();
    expect(read?.reason).toBeTruthy();
  });
});
