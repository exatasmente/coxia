// The read-only tool a called agent opens a person's attachment with: it reads the files of its conversation by the ref the message lists, never a path
// on the computer, sends an image as an image and a text as text, and refuses (with the reason) a kind that does not go to the model.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const realData = process.env.CERIMONIAS_DATA_DIR;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-attachment-tool-'));
  process.env.CERIMONIAS_DATA_DIR = dir;
});
afterEach(() => {
  process.env.CERIMONIAS_DATA_DIR = realData;
  rmSync(dir, { recursive: true, force: true });
});

const { attachmentStore } = await import('../src/main/attachments');
const { attachmentToolImpl, attachmentTextAnswer } = await import('../src/main/attachmentTool');
const { ToolError } = await import('../src/main/engine/open/tools/types');
const { setLanguage } = await import('../src/shared/i18n');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const TEXT = new TextEncoder().encode('first line\nsecond line\nthird line\n');

const THREAD = 'g-a-conversation';
const ctx = { outputMax: 30_000 } as never;

beforeEach(() => setLanguage('en'));

describe('the attachment tool', () => {
  it('reads a text of its own conversation, numbered so the agent can quote it', async () => {
    const ref = attachmentStore().put(THREAD, 'log.txt', TEXT);
    const tool = attachmentToolImpl(THREAD, [ref]);
    const r = await tool.run({ ref: ref.id }, ctx);
    const text = r.render(r.response);
    expect(text).toContain('1\tfirst line');
    expect(text).toContain('third line');
    expect(text).toContain('log.txt');
  });

  it('gives an image as an image result, with the name and size as text, never the content', async () => {
    const ref = attachmentStore().put(THREAD, 'shot.png', new Uint8Array(PNG));
    const tool = attachmentToolImpl(THREAD, [ref]);
    const r = await tool.run({ ref: ref.id }, ctx);
    expect((r.response as { type?: string }).type).toBe('attachment_image');
    expect(String((r.response as { url?: string }).url)).toContain('data:image/png;base64,');
    const text = r.render(r.response);
    expect(text).toContain('shot.png');
    expect(text).not.toContain('base64');
  });

  it('refuses a PDF, JSON or CSV with the reason it does not go to the model', async () => {
    const pdf = attachmentStore().put(THREAD, 'report.pdf', new TextEncoder().encode('%PDF-1.7\n'));
    const tool = attachmentToolImpl(THREAD, [pdf]);
    const r = await tool.run({ ref: pdf.id }, ctx);
    const text = r.render(r.response);
    expect(text.toLowerCase()).toContain('pdf');
    expect(text.length).toBeGreaterThan(20);
  });

  it('does not resolve a ref the message of this conversation does not carry', async () => {
    const ref = attachmentStore().put('run-r-one', 'shot.png', new Uint8Array(PNG));
    const tool = attachmentToolImpl('run-r-two', [ref]);
    await expect(tool.run({ ref: ref.id }, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('does not resolve a ref that looks like a path', async () => {
    const tool = attachmentToolImpl(THREAD, []);
    await expect(tool.run({ ref: '../../etc/passwd' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('never hands the model a path on the computer', async () => {
    const ref = attachmentStore().put(THREAD, 'log.txt', TEXT);
    const tool = attachmentToolImpl(THREAD, [ref]);
    const r = await tool.run({ ref: ref.id }, ctx);
    const text = r.render(r.response);
    // no separator that would name a real location, and no absolute path
    expect(text).not.toMatch(/\/tmp\/|\\|:\/\//);
  });

  it('tells the agent when the file is gone', () => {
    const text = attachmentTextAnswer(null, 'deadbeefdeadbeef');
    expect(text).toContain('deadbeefdeadbeef');
  });
});
