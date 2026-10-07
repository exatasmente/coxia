import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from '../src/shared/evidence';
import { EVIDENCE_MAX_BYTES } from '../src/shared/evidence';
import { evidenceToolImpls } from '../src/main/evidence/engineTool';
import { evidenceToolsOf } from '../src/main/evidence/handlers';
import { encodePng } from '../src/main/evidence/png';
import { shellMcpServer, shellToolImpl, viewImageToolImpl } from '../src/main/sandbox/engineTool';
import type { SandboxSession } from '../src/main/sandbox/session';
import { offersViewImage } from '../src/main/sandbox/tool';

// The evidence tools and the one `ViewImage`, driven through the app's handlers as the engines call them: keeping a file of the output folder, refusing what is not one, marking an
// image, and looking at the result. No model, no sandbox, no network: a temporary output folder is enough.

const PNG = (): Uint8Array => encodePng({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(200) });

function world(): { stageDir: string; dataDir: string; kept: EvidenceRecord[]; tools: ReturnType<typeof evidenceToolsOf> } {
  const stageDir = mkdtempSync(join(tmpdir(), 'evidence-stage-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'evidence-data-'));
  mkdirSync(join(stageDir, 'out'), { recursive: true });
  const kept: EvidenceRecord[] = [];
  const run = { id: 'r-abc123-abcd', evidence: {} as Record<string, EvidenceRecord> } as never;
  const tools = evidenceToolsOf({
    dataDir,
    stageDir,
    run,
    stage: 'qa',
    by: 'qa',
    onKept: (record) => {
      kept.push(record);
      (run as unknown as { evidence: Record<string, EvidenceRecord> }).evidence[record.id] = record;
    },
    now: () => '2026-10-06T12:00:00.000Z',
  });
  return { stageDir, dataDir, kept, tools };
}

const put = (stageDir: string, name: string, content: Uint8Array | string): string => {
  writeFileSync(join(stageDir, 'out', name), content);
  return `/coxia/out/${name}`;
};

describe('SaveEvidence', () => {
  it('keeps a file of the output folder, with the id, and reads the kind from the bytes', async () => {
    const w = world();
    const answer = await w.tools.save({ path: put(w.stageDir, 'shot.png', PNG()), title: 'The screen', description: 'The field' });
    expect(answer.text).toContain('ev-1');
    expect(w.kept[0]).toMatchObject({ id: 'ev-1', title: 'The screen', kind: 'png', stage: 'qa', by: 'qa', description: 'The field' });
    // A text file is kept as text even when it says it is an image.
    const asText = await w.tools.save({ path: put(w.stageDir, 'report.png', 'a short report'), title: 'Report' });
    expect(asText.text).toContain('ev-2');
    expect(w.kept[1]).toMatchObject({ kind: 'text' });
  });

  it('refuses a path outside the output folder, a link, a file over the ceiling and content it does not accept', async () => {
    const w = world();
    const outside = await w.tools.save({ path: '/etc/hostname', title: 'x' });
    expect(outside.text).toMatch(/output folder|fora|out/i);
    const traversal = await w.tools.save({ path: '/coxia/out/../secret', title: 'x' });
    expect(traversal.text).toMatch(/\.\.|sai|leaves/i);
    const link = put(w.stageDir, 'link.txt', 'x');
    symlinkSync('/etc/hostname', join(w.stageDir, 'out', 'linked.txt'));
    const linked = await w.tools.save({ path: '/coxia/out/linked.txt', title: 'x' });
    expect(linked.text).toMatch(/link/i);
    void link;
    const big = put(w.stageDir, 'big.bin', Buffer.alloc(EVIDENCE_MAX_BYTES + 1));
    const over = await w.tools.save({ path: big, title: 'x' });
    expect(over.text).toMatch(/MiB|teto|ceiling/i);
    const video = put(w.stageDir, 'clip.mp4', Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
    const refused = await w.tools.save({ path: video, title: 'x' });
    expect(refused.text).toMatch(/v[íi]deo|video/i);
    expect(w.kept).toEqual([]);
  });
});

describe('AnnotateImage and ViewImage', () => {
  it('marks an image and keeps the result linked to the one it came from; a bad mark is refused', async () => {
    const w = world();
    await w.tools.save({ path: put(w.stageDir, 'shot.png', PNG()), title: 'Original' });
    const marked = await w.tools.annotate({ source: 'ev-1', marks: [{ kind: 'rectangle', x: 0, y: 0, w: 2, h: 2, color: 'red', width: 1 }] });
    expect(marked.text).toContain('ev-2');
    expect(w.kept[1]).toMatchObject({ id: 'ev-2', from: 'ev-1', kind: 'png' });
    const bad = await w.tools.annotate({ source: 'ev-1', marks: [{ kind: 'rectangle', x: 0, y: 0, w: 2, h: 2, color: 'pink', width: 1 }] });
    expect(bad.text).toMatch(/marca|mark/i);
    expect(w.kept).toHaveLength(2);
  });

  it('refuses an id that is not of this stage, or that is not an image', async () => {
    const w = world();
    await w.tools.save({ path: put(w.stageDir, 'report.txt', 'a log'), title: 'Log' });
    const notImage = await w.tools.annotate({ source: 'ev-1', marks: [{ kind: 'rectangle', x: 0, y: 0, w: 1, h: 1, color: 'red', width: 1 }] });
    expect(notImage.text).toMatch(/imagem|image/i);
    const other = await w.tools.annotate({ source: 'ev-9', marks: [] });
    expect(other.text).toMatch(/etapa|stage/i);
  });

  it('looks at an image and answers with the image itself', async () => {
    const w = world();
    await w.tools.save({ path: put(w.stageDir, 'shot.png', PNG()), title: 'Original' });
    const looked = await w.tools.view({ source: 'ev-1' });
    expect(looked.image?.media).toBe('image/png');
    expect(looked.image?.data.length).toBeGreaterThan(0);
  });
});

// The one ViewImage: the sandbox's tool, which takes an evidence id as well when the stage keeps evidence. The sandbox read is a fake that knows one file.
describe('the one ViewImage', () => {
  const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
  const ctx = { cwd: '/', roots: ['/'], isSecret: () => false, secretGlobs: [], outputMax: 1000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, seesImages: () => true };
  const reads: string[] = [];
  const session = (withRead = true): SandboxSession => ({
    exec: async () => ({ n: 1, command: '', exitCode: 0, timedOut: false, output: '', ms: 0 }),
    log: [],
    close: async () => undefined,
    ...(withRead
      ? {
          readImage: (path: string) => {
            reads.push(path);
            return path === '/coxia/out/home.png' ? { ok: true as const, path, mediaType: 'image/png', data: 'c2FuZGJveA==' } : { ok: false as const, why: 'outside' as const };
          },
        }
      : {}),
  });

  it('is one tool of that name for a stage with evidence and a GUI sandbox, listed once', () => {
    const w = world();
    const s = { ...session(), gui: { browsers: '/b', display: null } } as SandboxSession;
    const names = [shellToolImpl(s), viewImageToolImpl(s, w.tools), ...evidenceToolImpls(w.tools)].map((t) => t.name);
    expect(names.filter((n) => n === 'ViewImage')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    expect(offersViewImage(s, w.tools)).toBe(true);
  });

  it('is offered to a stage with evidence even with no GUI, and not to one with neither', () => {
    const w = world();
    expect(offersViewImage(session(), w.tools)).toBe(true);
    expect(offersViewImage(session())).toBe(false);
    expect(offersViewImage(null, w.tools)).toBe(false);
  });

  it('describes evidence ids only to a stage that keeps evidence', () => {
    const w = world();
    const withEvidence = viewImageToolImpl(session(), w.tools);
    const without = viewImageToolImpl(session());
    expect(withEvidence.description).toMatch(/ev-3/);
    expect(JSON.stringify(withEvidence.parameters)).toMatch(/evidence id/);
    expect(without.description).not.toMatch(/evidence|ev-\d/i);
    expect(JSON.stringify(without.parameters)).not.toMatch(/evidence|ev-\d/i);
  });

  it('sends an evidence id to the evidence, and a path of the output folder to the sandbox read', async () => {
    const w = world();
    await w.tools.save({ path: put(w.stageDir, 'shot.png', PNG()), title: 'Original' });
    const tool = viewImageToolImpl(session(), w.tools);
    reads.length = 0;
    const evidence = await tool.run({ source: ' ev-1 ' }, ctx);
    expect(reads).toEqual([]);
    expect(evidence.images?.[0]).toMatchObject({ path: 'ev-1', mediaType: 'image/png' });
    const sandbox = await tool.run({ source: '/coxia/out/home.png' }, ctx);
    expect(reads).toEqual(['/coxia/out/home.png']);
    expect(sandbox.images?.[0]).toMatchObject({ path: '/coxia/out/home.png', mediaType: 'image/png', data: 'c2FuZGJveA==' });
  });

  it('still takes the `path` of the first contract', async () => {
    const w = world();
    const tool = viewImageToolImpl(session(), w.tools);
    const shown = await tool.run({ path: '/coxia/out/home.png' }, ctx);
    expect(shown.images?.[0]).toMatchObject({ path: '/coxia/out/home.png' });
  });

  it('reads the output folder through the evidence when the sandbox cannot', async () => {
    const w = world();
    put(w.stageDir, 'plain.png', PNG());
    const tool = viewImageToolImpl(session(false), w.tools);
    const shown = await tool.run({ source: '/coxia/out/plain.png' }, ctx);
    expect(shown.images?.[0]).toMatchObject({ mediaType: 'image/png' });
  });

  it('refuses with the missing wording when there is neither a sandbox read nor evidence', async () => {
    const tool = viewImageToolImpl(session(false));
    const refused = await tool.run({ source: 'home.png' }, ctx);
    expect(refused.images).toBeUndefined();
    expect(String(refused.response)).toContain('/coxia/out');
  });

  it('keeps the evidence route to what the model can take: the real media type, no image for a model that takes none, and nothing over 4 MB', async () => {
    const w = world();
    await w.tools.save({ path: put(w.stageDir, 'anim.gif', GIF), title: 'Animation' });
    await w.tools.save({ path: put(w.stageDir, 'pic.webp', WEBP), title: 'Picture' });
    const tool = viewImageToolImpl(session(), w.tools);
    expect((await tool.run({ source: 'ev-1' }, ctx)).images?.[0].mediaType).toBe('image/gif');
    expect((await tool.run({ source: 'ev-2' }, ctx)).images?.[0].mediaType).toBe('image/webp');
    const blind = await tool.run({ source: 'ev-1' }, { ...ctx, seesImages: () => false });
    expect(blind.images).toBeUndefined();
    await w.tools.save({ path: put(w.stageDir, 'huge.png', Buffer.concat([Buffer.from(PNG()), Buffer.alloc(4 * 1024 * 1024)])), title: 'Huge' });
    const big = await tool.run({ source: 'ev-3' }, ctx);
    expect(big.images).toBeUndefined();
    expect(String(big.response)).toMatch(/4 MB/);
  });

  it('says what a file that is not an image is, from the bytes', async () => {
    const w = world();
    put(w.stageDir, 'notes.png', 'plain words');
    const looked = await w.tools.view({ source: '/coxia/out/notes.png' });
    expect(looked.image).toBeUndefined();
    expect(looked.text).toMatch(/PNG, JPEG, GIF|imagem/);
  });

  it('is one tool of that name on the Claude SDK server too, answering an evidence id with the image block and its line', async () => {
    const w = world();
    await w.tools.save({ path: put(w.stageDir, 'anim.gif', GIF), title: 'Animation' });
    const server = (await shellMcpServer(session(), w.tools)) as { coxia_sandbox: { instance: { _registeredTools: Record<string, { handler?: (a: unknown, x: unknown) => Promise<{ content: { type: string; mimeType?: string }[] }>; callback?: (a: unknown, x: unknown) => Promise<{ content: { type: string; mimeType?: string }[] }> }> } } };
    const registered = server.coxia_sandbox.instance._registeredTools;
    expect(Object.keys(registered)).toEqual(['Shell', 'ViewImage']);
    const run = registered.ViewImage.handler ?? registered.ViewImage.callback!;
    const answer = await run({ source: 'ev-1' }, {});
    expect(answer.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(answer.content[1].mimeType).toBe('image/gif');
    const refused = await run({ source: '/etc/passwd' }, {});
    expect(refused.content.map((c) => c.type)).toEqual(['text']);
    const without = (await shellMcpServer(session())) as { coxia_sandbox: { instance: { _registeredTools: Record<string, unknown> } } };
    expect(Object.keys(without.coxia_sandbox.instance._registeredTools)).toEqual(['Shell']);
  });
});
