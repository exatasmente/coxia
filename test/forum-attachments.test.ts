// The forum's attachment channels: the bytes travel base64 in one call each, the message carries the refs, and the message of another conversation
// is never opened. The module resolves its stores against the workspace's data folder, so this file points the data root at a throwaway folder first.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const realData = process.env.CERIMONIAS_DATA_DIR;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-forum-attachments-'));
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

/** The four attachment channels of the module, driven as the app drives them. */
function channels(): Record<string, (...args: unknown[]) => unknown> {
  const out: Record<string, (...args: unknown[]) => unknown> = {};
  forumModule({ handle: (channel: string, fn: (...args: never[]) => unknown) => (out[channel] = fn as unknown as (...args: unknown[]) => unknown), notify: () => undefined, emit: () => undefined, job: () => undefined } as unknown as ModuleContext);
  return out;
}

const THREAD = 'g-a-conversation';

beforeEach(() => {
  forumStore().ensureThread({ id: THREAD, kind: 'general', title: 'A conversation' });
});

describe('sending a file to a conversation', () => {
  it('stores the bytes and writes a message that carries the refs', () => {
    const c = channels();
    const ref = c['forum:attachment-put'](THREAD, 'shot.png', PNG) as { id: string; kind: string; bytes: number };
    expect(ref.kind).toBe('image');
    const message = c['forum:attachment-post'](THREAD, 'look at this', [ref.id]) as { kind: string; attachments: { id: string }[]; anchor: string };
    expect(message.kind).toBe('post');
    expect(message.attachments.map((a) => a.id)).toEqual([ref.id]);
    expect(message.anchor).toBeTruthy();
    // the message as it is read back carries the attachments
    const read = forumStore().read(THREAD)?.messages ?? [];
    expect(read.at(-1)?.attachments).toHaveLength(1);
  });

  it('keeps the bytes under the conversation, by the id and the kind, never by the name', () => {
    const c = channels();
    const ref = c['forum:attachment-put'](THREAD, '../../etc/passwd.png', PNG) as { id: string };
    const folder = join(ATAS, 'anexos', THREAD);
    expect(existsSync(folder)).toBe(true);
    expect(existsSync(join(folder, `${ref.id}.img`))).toBe(true);
    expect(existsSync(join(folder, 'passwd.png'))).toBe(false);
  });

  it('refuses a file of a kind that is not accepted, and writes nothing', () => {
    const c = channels();
    const before = existsSync(join(ATAS, 'anexos', THREAD)) ? readdirSync(join(ATAS, 'anexos', THREAD)).length : 0;
    expect(() => c['forum:attachment-put'](THREAD, 'archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]).toString('base64'))).toThrow();
    const after = existsSync(join(ATAS, 'anexos', THREAD)) ? readdirSync(join(ATAS, 'anexos', THREAD)).length : 0;
    expect(after).toBe(before);
  });

  it('removes a file the person took out before sending, and the message never sees it', () => {
    const c = channels();
    const ref = c['forum:attachment-put'](THREAD, 'notes.txt', b64('hello\nworld\n')) as { id: string };
    c['forum:attachment-drop'](THREAD, [ref.id]);
    expect(existsSync(join(ATAS, 'anexos', THREAD, `${ref.id}.txt`))).toBe(false);
    // posting the id that no longer holds a file is refused, nothing is written
    expect(() => c['forum:attachment-post'](THREAD, 'x', [ref.id])).toThrow();
  });

  it('serves the bytes of a message that carries the file, with its anchor', () => {
    const c = channels();
    const ref = c['forum:attachment-put'](THREAD, 'shot.png', PNG) as { id: string };
    const message = c['forum:attachment-post'](THREAD, 'here', [ref.id]) as { seq: number };
    const got = c['forum:attachment-get'](THREAD, message.seq, ref.id) as { data: string; ref: { kind: string } };
    expect(got.ref.kind).toBe('image');
    expect(Buffer.from(got.data, 'base64').toString('base64')).toBe(PNG);
  });
});

describe('a message of another conversation opens nothing', () => {
  it('refuses the bytes when the message is not of the conversation asked', () => {
    const c = channels();
    // a message in one conversation, asked through another
    const other = 'g-another';
    forumStore().ensureThread({ id: other, kind: 'general', title: 'Another' });
    // a message of the second conversation has a different anchor, so its id never serves a file of the first
    const ref = c['forum:attachment-put'](THREAD, 'shot.png', PNG) as { id: string };
    const message = c['forum:attachment-post'](THREAD, 'here', [ref.id]) as { seq: number };
    expect(c['forum:attachment-get'](other, message.seq, ref.id)).toBeNull();
  });

  it('refuses an id the message does not carry', () => {
    const c = channels();
    const a = c['forum:attachment-put'](THREAD, 'a.txt', b64('x\ny\n')) as { id: string };
    const b = c['forum:attachment-put'](THREAD, 'b.txt', b64('x\ny\n')) as { id: string };
    const message = c['forum:attachment-post'](THREAD, 'only a', [a.id]) as { seq: number };
    expect(c['forum:attachment-get'](THREAD, message.seq, b.id)).toBeNull();
  });
});
