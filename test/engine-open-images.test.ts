// The open engine shows the model the images an agent reads: Read returns a picture (PNG, JPEG, GIF, WebP) when the model takes images, the loop sends it in a
// message of its own right after the tool results (a tool message carries text only), and a server that refuses an image teaches the client to send a line
// in its place from then on. The estimate counts a picture by a fixed weight, not by its base64.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, agentHooks, obj, secretPath, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { estimateTokens } from '../src/main/engine/open/text';
import { imageType } from '../src/main/engine/open/tools/read';
import { type Fake, errorStep, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

// A 16×16 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4I2JDEmIY1TCqYfhqAAAeBCwQ81sZJgAAAABJRU5ErkJggg==', 'base64');
const schema = obj({ texto: str });
const finalCall = () => toolStep([{ id: 'call_final', name: 'final_answer', args: { texto: 'vi' } }]);
const readCall = (file: string) => toolStep([{ id: 'call_r', name: 'Read', args: { file_path: file } }]);

let dir: string;
let fake: Fake | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-images-'));
  writeFileSync(join(dir, 'shot.png'), PNG);
});

afterEach(async () => {
  await fake?.close();
  fake = null;
  rmSync(dir, { recursive: true, force: true });
});

function params(f: Fake, over: Partial<OpenRunParams> = {}): OpenRunParams {
  return {
    role: 'deep',
    prompt: 'Look at shot.png',
    schema,
    client: new ChatClient({ baseUrl: f.url, model: 'fake-model', retryDelayMs: 0 }),
    cwd: dir,
    allowedTools: ['Read'],
    hooks: agentHooks(),
    isSecret: (p) => secretPath(p, dir),
    secretGlobs: SECRET_GLOBS,
    docs: { claudeMd: [], skillDirs: [], agentDirs: [] },
    maxTurns: 6,
    sessionsDir: join(dir, '.sessions'),
    ripgrep: 'off',
    ...over,
  };
}

type Msg = { role: string; content: unknown };
const messages = (body: unknown): Msg[] => (body as { messages: Msg[] }).messages;
const imageParts = (body: unknown) => messages(body).flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; image_url?: { url: string } }[]) : [])).filter((c) => c.type === 'image_url');

describe('an image the agent reads', () => {
  it('reaches the model in a message right after the tool results, with the tool saying what it is', async () => {
    fake = await fakeOpenAI([readCall('shot.png'), finalCall()]);
    const r = await runOpen(params(fake));
    expect(r.data).toEqual({ texto: 'vi' });
    const second = messages(fake.chats()[1].body);
    const tool = second.findIndex((m) => m.role === 'tool');
    expect(String(second[tool].content)).toContain('shot.png');
    // The picture follows the tool message, in a user message of its own.
    expect(second[tool + 1].role).toBe('user');
    expect(imageParts(fake.chats()[1].body).map((p) => p.image_url?.url.slice(0, 22))).toEqual(['data:image/png;base64,']);
  });

  it('is not sent to a model the provider says takes no image: the tool says so instead', async () => {
    fake = await fakeOpenAI([readCall('shot.png'), finalCall()]);
    await runOpen(params(fake, { capabilities: { images: false } }));
    expect(imageParts(fake.chats()[1].body)).toEqual([]);
    const tool = messages(fake.chats()[1].body).find((m) => m.role === 'tool');
    expect(String(tool?.content)).toContain('shot.png');
  });

  it('is replaced by a line when the server refuses it, and the client stops sending images', async () => {
    fake = await fakeOpenAI([readCall('shot.png'), errorStep(400, 'Image input is not supported for this model'), finalCall()]);
    const p = params(fake);
    const r = await runOpen(p);
    expect(r.data).toEqual({ texto: 'vi' });
    // The refused request had the picture; the one sent again has none.
    expect(imageParts(fake.chats()[1].body)).toHaveLength(1);
    expect(imageParts(fake.chats()[2].body)).toEqual([]);
    expect(p.client.learned.noImages).toBe(true);
  });

  it('stays hidden when the read policy hides its path, whatever its type', async () => {
    writeFileSync(join(dir, '.env'), PNG);
    fake = await fakeOpenAI([readCall('.env'), finalCall()]);
    await runOpen(params(fake));
    expect(imageParts(fake.chats()[1].body)).toEqual([]);
  });
});

describe('the image type and weight', () => {
  it('reads the type from the first bytes, never the name', () => {
    writeFileSync(join(dir, 'not-a-picture.png'), 'just text\n');
    writeFileSync(join(dir, 'photo.bin'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
    writeFileSync(join(dir, 'anim.dat'), Buffer.from('GIF89a......'));
    writeFileSync(join(dir, 'pic'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]));
    expect(imageType(join(dir, 'shot.png'))).toBe('image/png');
    expect(imageType(join(dir, 'not-a-picture.png'))).toBeNull();
    expect(imageType(join(dir, 'photo.bin'))).toBe('image/jpeg');
    expect(imageType(join(dir, 'anim.dat'))).toBe('image/gif');
    expect(imageType(join(dir, 'pic'))).toBe('image/webp');
  });

  it('counts a picture by a fixed weight, not by its base64', () => {
    const big = `data:image/png;base64,${'A'.repeat(400_000)}`;
    const tokens = estimateTokens([{ role: 'user', content: [{ type: 'image_url', image_url: { url: big } }] }]);
    expect(tokens).toBeLessThan(5_000);
  });
});
