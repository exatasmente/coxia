// Deleting a message deletes the files it carried from disk: the store records the removal, the handler takes the files off the message it read
// back, and the files of the messages around it stay. The module resolves its stores against the workspace's data folder, so this file points the
// data root at a throwaway folder first.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const realData = process.env.CERIMONIAS_DATA_DIR;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-forum-delete-'));
  process.env.CERIMONIAS_DATA_DIR = dir;
});
afterEach(() => {
  process.env.CERIMONIAS_DATA_DIR = realData;
  rmSync(dir, { recursive: true, force: true });
});

const { forumModule, forumStore } = await import('../src/main/forum');
const { ATAS } = await import('../src/main/env');
type ModuleContext = import('../src/main/module').ModuleContext;

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

function channels(): Record<string, (...args: unknown[]) => unknown> {
  const out: Record<string, (...args: unknown[]) => unknown> = {};
  forumModule({ handle: (channel: string, fn: (...args: never[]) => unknown) => (out[channel] = fn as unknown as (...args: unknown[]) => unknown), notify: () => undefined, emit: () => undefined, job: () => undefined } as unknown as ModuleContext);
  return out;
}

const THREAD = 'g-a-conversation';
const folder = (): string => join(ATAS, 'anexos', THREAD);

beforeEach(() => {
  forumStore().ensureThread({ id: THREAD, kind: 'general', title: 'A conversation' });
});

describe('deleting a message deletes its files from disk', () => {
  it('removes the files the message carried and leaves the message gone', () => {
    const c = channels();
    const ref = c['forum:attachment-put'](THREAD, 'shot.png', PNG) as { id: string };
    const message = c['forum:attachment-post'](THREAD, 'here', [ref.id]) as { seq: number };
    expect(existsSync(join(folder(), `${ref.id}.img`))).toBe(true);
    expect(c['forum:attachment-delete'](THREAD, message.seq)).toBe(true);
    expect(existsSync(join(folder(), `${ref.id}.img`))).toBe(false);
    expect((forumStore().read(THREAD)?.messages ?? []).some((m) => m.seq === message.seq)).toBe(false);
  });

  it('keeps the files of the messages around the one deleted', () => {
    const c = channels();
    const first = c['forum:attachment-put'](THREAD, 'a.txt', b64('a\nb\n')) as { id: string };
    const before = c['forum:attachment-post'](THREAD, 'first', [first.id]) as { seq: number };
    const middle = c['forum:attachment-put'](THREAD, 'shot.png', PNG) as { id: string };
    const doomed = c['forum:attachment-post'](THREAD, 'middle', [middle.id]) as { seq: number };
    const after = c['forum:attachment-put'](THREAD, 'b.txt', b64('c\nd\n')) as { id: string };
    c['forum:attachment-post'](THREAD, 'last', [after.id]);
    expect(c['forum:attachment-delete'](THREAD, doomed.seq)).toBe(true);
    expect(existsSync(join(folder(), `${middle.id}.img`))).toBe(false);
    expect(existsSync(join(folder(), `${first.id}.txt`))).toBe(true);
    expect(existsSync(join(folder(), `${after.id}.txt`))).toBe(true);
    const left = (forumStore().read(THREAD)?.messages ?? []).map((m) => m.seq);
    expect(left).toContain(before.seq);
    expect(left).not.toContain(doomed.seq);
  });

  it('is nothing to do for a message that is already gone, and never touches a file of its own', () => {
    const c = channels();
    const ref = c['forum:attachment-put'](THREAD, 'a.txt', b64('a\nb\n')) as { id: string };
    const message = c['forum:attachment-post'](THREAD, 'here', [ref.id]) as { seq: number };
    expect(c['forum:attachment-delete'](THREAD, message.seq)).toBe(true);
    expect(c['forum:attachment-delete'](THREAD, message.seq)).toBe(false);
    // a message of another conversation is never opened through this one
    const other = 'g-another';
    forumStore().ensureThread({ id: other, kind: 'general', title: 'Another' });
    expect(c['forum:attachment-delete'](other, message.seq)).toBe(false);
  });

  it('leaves nothing of its own in the conversation folder when the last file goes', () => {
    const c = channels();
    // What the folder starts with belongs to the other cases of this file: only the file this one adds matters.
    const before = existsSync(folder()) ? readdirSync(folder()).length : 0;
    const ref = c['forum:attachment-put'](THREAD, 'only.txt', b64('x\ny\n')) as { id: string };
    const message = c['forum:attachment-post'](THREAD, 'only this', [ref.id]) as { seq: number };
    expect(readdirSync(folder())).toHaveLength(before + 1);
    c['forum:attachment-delete'](THREAD, message.seq);
    expect(readdirSync(folder()).filter((n) => n.startsWith(ref.id))).toEqual([]);
    expect(readdirSync(folder())).toHaveLength(before);
  });
});
