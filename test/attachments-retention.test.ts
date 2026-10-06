// The retention sweep knows the attachments group: an attachment a live message references is never deleted, an orphan is selected by age like the
// other data, and a record that points at a file already gone does not fail.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const realData = process.env.CERIMONIAS_DATA_DIR;
let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'coxia-attachment-retention-'));
  process.env.CERIMONIAS_DATA_DIR = base;
});
afterEach(() => {
  process.env.CERIMONIAS_DATA_DIR = realData;
  rmSync(base, { recursive: true, force: true });
});

const { attachmentFiles, referencedAttachments } = await import('../src/main/retention');

const put = (thread: string, id: string, ext = '.txt'): void => {
  mkdirSync(join(base, 'anexos', thread), { recursive: true });
  writeFileSync(join(base, 'anexos', thread, `${id}${ext}`), 'hello\nworld\n');
};
const message = (thread: string, seq: number, attachments: { id: string }[]): void => {
  mkdirSync(join(base, 'forum'), { recursive: true });
  writeFileSync(join(base, 'forum', `${thread}.jsonl`), `${JSON.stringify({ v: 1, type: 'message', seq, attachments })}\n`);
};

describe('the attachment group of the retention sweep', () => {
  it('lists the files under each conversation, with the id from the name', () => {
    put('g-one', 'aaaaaaaaaaaaaaaa');
    put('run-r-two', 'bbbbbbbbbbbbbbbb', '.img');
    const files = attachmentFiles(base);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.kind === 'anexos')).toBe(true);
    expect(files.map((f) => f.path.split('/').slice(-2).join('/')).sort()).toEqual(['g-one/aaaaaaaaaaaaaaaa.txt', 'run-r-two/bbbbbbbbbbbbbbbb.img']);
  });

  it('marks a file a live message references, so the sweep keeps it', () => {
    put('g-one', 'aaaaaaaaaaaaaaaa');
    put('g-one', 'cccccccccccccccc');
    message('g-one', 3, [{ id: 'aaaaaaaaaaaaaaaa' }]);
    const files = attachmentFiles(base);
    const kept = files.find((f) => f.path.includes('aaaaaaaaaaaaaaaa'));
    const orphan = files.find((f) => f.path.includes('cccccccccccccccc'));
    expect(kept?.keep).toBe(true);
    expect(orphan?.keep).toBe(false);
  });

  it('reads the references by conversation, so a same id in another conversation is another file', () => {
    put('g-one', 'aaaaaaaaaaaaaaaa');
    put('g-two', 'aaaaaaaaaaaaaaaa');
    message('g-one', 1, [{ id: 'aaaaaaaaaaaaaaaa' }]);
    const keep = referencedAttachments(base);
    expect(keep.has('g-one/aaaaaaaaaaaaaaaa')).toBe(true);
    expect(keep.has('g-two/aaaaaaaaaaaaaaaa')).toBe(false);
    const files = attachmentFiles(base);
    expect(files.find((f) => f.path.includes('g-two'))?.keep).toBe(false);
  });

  it('does not fail on a record that points at a file that is already gone', () => {
    put('g-one', 'aaaaaaaaaaaaaaaa');
    message('g-one', 9, [{ id: 'deadbeefdeadbeef' }]);
    expect(() => attachmentFiles(base)).not.toThrow();
    expect(attachmentFiles(base)).toHaveLength(1);
  });

  it('is empty when the workspace has no attachments folder', () => {
    expect(attachmentFiles(base)).toEqual([]);
    expect(referencedAttachments(base).size).toBe(0);
  });
});
