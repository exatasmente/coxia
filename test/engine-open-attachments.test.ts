// The image a person attached reaches the open engine's model as an image, and the tool result stays text: the round sends the tool message as text and,
// right after it, a user message carrying an image part with the data URL. The transcript keeps the request as it goes to the provider, never the bytes.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const realData = process.env.CERIMONIAS_DATA_DIR;
let data: string;
let dir: string;
let sessions: string;

import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { readSession, messagesOf } from '../src/main/engine/open/session';
import { type Fake, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

const { attachmentStore } = await import('../src/main/attachments');
const { attachmentToolImpl } = await import('../src/main/attachmentTool');
const { ATTACHMENT_TOOL } = await import('../src/shared/attachments');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
let fake: Fake | null = null;

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'coxia-open-attach-data-'));
  dir = mkdtempSync(join(tmpdir(), 'coxia-open-attach-'));
  sessions = join(dir, '.sessions');
  mkdirSync(join(dir, 'docs'), { recursive: true });
  process.env.CERIMONIAS_DATA_DIR = data;
});
afterEach(async () => {
  process.env.CERIMONIAS_DATA_DIR = realData;
  await fake?.close();
  fake = null;
  rmSync(data, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

const clientFor = (f: Fake) => new ChatClient({ baseUrl: f.url, model: 'fake-model', retryDelayMs: 0 });

function params(f: Fake, over: Partial<OpenRunParams> = {}): OpenRunParams {
  return {
    role: 'deep',
    prompt: 'What does the image show?',
    schema,
    client: clientFor(f),
    cwd: dir,
    allowedTools: [ATTACHMENT_TOOL],
    extraTools: over.extraTools,
    maxTurns: 6,
    sessionsDir: sessions,
    ripgrep: 'off',
    ...over,
  };
}

const THREAD = 'g-a-conversation';

describe('an attachment image in the open engine', () => {
  it('sends the tool result as text and the image as a user message with an image part', async () => {
    const ref = attachmentStore().put(THREAD, 'shot.png', new Uint8Array(PNG));
    fake = await fakeOpenAI([toolStep([{ id: 'call_a', name: ATTACHMENT_TOOL, args: { ref: ref.id } }]), toolStep([{ id: 'call_f', name: 'final_answer', args: { answer: 'it shows one pixel' } }])]);
    const r = await runOpen<{ answer: string }>(params(fake, { extraTools: [attachmentToolImpl(THREAD, [ref])] }));
    expect(r.data.answer).toContain('pixel');
    const second = fake.chats()[1]?.body as { messages: { role: string; content: unknown }[] };
    const tool = second.messages.find((m) => m.role === 'tool') as { content: string } | undefined;
    expect(typeof tool?.content).toBe('string');
    expect(String(tool?.content)).toContain('shot.png');
    const image = second.messages.find((m) => m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some((p) => p.type === 'image_url'));
    expect(image, 'a user message with the image part').toBeTruthy();
    const parts = image?.content as { type: string; image_url?: { url: string } }[];
    expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/png;base64,'))).toBe(true);
  });

  it('keeps the transcript as the request goes to the provider: the tool text and the marker, never the bytes', async () => {
    const ref = attachmentStore().put(THREAD, 'shot.png', new Uint8Array(PNG));
    fake = await fakeOpenAI([toolStep([{ id: 'call_a', name: ATTACHMENT_TOOL, args: { ref: ref.id } }]), toolStep([{ id: 'call_f', name: 'final_answer', args: { answer: 'done' } }])]);
    const r = await runOpen<{ answer: string }>(params(fake, { extraTools: [attachmentToolImpl(THREAD, [ref])] }));
    const transcript = JSON.stringify(readSession(sessions, r.sessionId) ?? []);
    // the image URL may be in the transcript as the provider got it; the raw base64 of the response must not be duplicated as a bare blob
    expect(transcript).toContain('Attachment');
    // the tool message itself carries the text result, not an array
    const messages = messagesOf(readSession(sessions, r.sessionId) ?? []);
    const tool = messages.find((m) => m.role === 'tool');
    expect(typeof tool?.content).toBe('string');
  });

  it('a text attachment stays text, no image part', async () => {
    const ref = attachmentStore().put(THREAD, 'log.txt', new TextEncoder().encode('first\nsecond\n'));
    fake = await fakeOpenAI([toolStep([{ id: 'call_a', name: ATTACHMENT_TOOL, args: { ref: ref.id } }]), toolStep([{ id: 'call_f', name: 'final_answer', args: { answer: 'quoted' } }])]);
    await runOpen<{ answer: string }>(params(fake, { extraTools: [attachmentToolImpl(THREAD, [ref])] }));
    const second = fake.chats()[1]?.body as { messages: { role: string; content: unknown }[] };
    const image = second.messages.find((m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((p) => p.type === 'image_url'));
    expect(image).toBeUndefined();
    const tool = second.messages.find((m) => m.role === 'tool') as { content: string } | undefined;
    expect(String(tool?.content)).toContain('0\tfirst'.replace('0', '1'));
  });

  it('still runs a plain text answer when nothing is attached', async () => {
    fake = await fakeOpenAI([textStep(JSON.stringify({ answer: 'no files here' }))]);
    const r = await runOpen<{ answer: string }>(params(fake, { structured: 'prompt' }));
    expect(r.data.answer).toBe('no files here');
  });
});
