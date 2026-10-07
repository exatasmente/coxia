import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from '../src/shared/evidence';
import { EVIDENCE_MAX_BYTES } from '../src/shared/evidence';
import { evidenceToolsOf } from '../src/main/evidence/handlers';
import { encodePng } from '../src/main/evidence/png';

// The three evidence tools, driven through the app's handlers as the engines call them: keeping a file of the output folder, refusing what is not one, marking an
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
