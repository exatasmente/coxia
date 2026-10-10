import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { putRecording } from '../src/main/evidence/recording';
import { dropEvidence, evidencePath, putEvidence, readEvidence, uploadsOf } from '../src/main/evidence/store';
import { detectKind } from '../src/main/evidence/type';
import { EVIDENCE_EXT, EVIDENCE_KIND_MEDIA, EVIDENCE_MAX_BYTES, evidenceViewOf, isEvidenceImage, isUploadable } from '../src/shared/evidence';
import { RECORDING_MAX_BYTES, type RecordingMeta } from '../src/shared/screen';
import { webmHead } from './helpers/webm';

// The app's own recording of a stage's screen as evidence: the `webm` kind exists only through `putRecording`; the agent's `SaveEvidence` goes through `detectKind`,
// which still refuses video.

const META: RecordingMeta = { durationMs: 12_000, width: 1280, height: 800, marks: [{ fromMs: 2000, toMs: 5000 }] };
const base = { stage: 'qa', by: 'qa', title: 'Screen recording of the stage (made by the app)', meta: META, at: '2026-10-08T12:00:00.000Z' };
const run = (evidence = {}) => ({ id: 'r-abc123-abcd', evidence });

describe('putRecording', () => {
  it('keeps a WebM as ev-N.webm, owner-only, with the recording on the record', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rec-data-'));
    const bytes = webmHead(100);
    const put = putRecording(dataDir, run(), { ...base, bytes });
    expect(put.ok).toBe(true);
    if (!put.ok) return;
    expect(put.record).toMatchObject({ id: 'ev-1', kind: 'webm', stage: 'qa', by: 'qa', bytes: bytes.length, from: null, message: null, recording: META });
    const path = evidencePath(dataDir, 'r-abc123-abcd', put.record);
    expect(path).toBe(join(dataDir, 'evidence', 'r-abc123-abcd', 'ev-1.webm'));
    expect(statSync(path as string).mode & 0o777).toBe(0o600);
    expect(Buffer.from(readEvidence(dataDir, 'r-abc123-abcd', put.record) as Uint8Array).equals(Buffer.from(bytes))).toBe(true);
    // The record is a copy: changing the meta afterwards does not change the record.
    META.marks.push({ fromMs: 9, toMs: 10 });
    expect(put.record.recording?.marks).toHaveLength(1);
    META.marks.pop();
    expect(dropEvidence(dataDir, 'r-abc123-abcd', put.record)).toBe(true);
    expect(existsSync(path as string)).toBe(false);
  });

  it('numbers after the run\'s records and never writes over a stored file', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rec-data-'));
    const first = putRecording(dataDir, run(), { ...base, bytes: webmHead(1) });
    const second = putRecording(dataDir, run(), { ...base, bytes: webmHead(2) });
    // The run object the caller holds is older than the folder: the second takes the next free id, not the first's.
    expect([first, second].map((p) => (p.ok ? p.record.id : null))).toEqual(['ev-1', 'ev-2']);
    expect(statSync(join(dataDir, 'evidence', 'r-abc123-abcd', 'ev-1.webm')).size).toBe(webmHead(1).length);
  });

  it('refuses what is not a WebM, an empty file and a file over its own ceiling, and writes nothing', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rec-data-'));
    const problem = (bytes: Uint8Array) => {
      const put = putRecording(dataDir, run(), { ...base, bytes });
      return put.ok ? null : put.problem;
    };
    expect(problem(new Uint8Array())).toBe('empty');
    expect(problem(Uint8Array.from(Buffer.from('plain text, not a video')))).toBe('not-webm');
    // The EBML magic alone is Matroska, not the app's recording: the DocType has to say webm.
    expect(problem(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x6d, 0x6b, 0x76, 0x20]))).toBe('not-webm');
    // A DocType after the first 64 bytes does not count.
    expect(problem(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array<number>(70).fill(0), ...webmHead().slice(4)]))).toBe('not-webm');
    expect(problem(webmHead(RECORDING_MAX_BYTES))).toBe('too-long');
    expect(existsSync(join(dataDir, 'evidence'))).toBe(false);
    // Its ceiling is its own: a video does not fit the 8 MiB of the other pieces, and exactly the ceiling is kept.
    expect(RECORDING_MAX_BYTES).toBeGreaterThan(EVIDENCE_MAX_BYTES);
    expect(problem(webmHead(RECORDING_MAX_BYTES - webmHead().length))).toBeNull();
  });
});

describe('the webm kind', () => {
  it('is a video of its own: not an image, not uploadable, with a media type and an extension', () => {
    expect(EVIDENCE_KIND_MEDIA.webm).toBe('video/webm');
    expect(EVIDENCE_EXT.webm).toBe('webm');
    expect(isEvidenceImage('webm')).toBe(false);
    expect(isUploadable({ media: 'video/webm', bytes: webmHead(10) })).toBe(false);
    expect(evidenceViewOf({ ...base, id: 'ev-1', description: '', name: 'x', kind: 'webm', bytes: 1, from: null, message: null }).media).toBe('video/webm');
  });

  it('is not what an agent can save: the same bytes pass putRecording and fail putEvidence, and detectKind still says video', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rec-data-'));
    const bytes = webmHead(50);
    expect(detectKind(bytes, bytes.length)).toEqual({ kind: null, problem: 'video' });
    const stageDir = mkdtempSync(join(tmpdir(), 'rec-stage-'));
    const file = join(stageDir, 'clip.webm');
    writeFileSync(file, bytes);
    const refused = putEvidence(dataDir, run() as never, { path: file, name: 'clip.webm', title: 'x', description: '', stage: 'qa', by: 'qa', at: base.at });
    expect(refused).toEqual({ ok: false, problem: 'video' });
    expect(putRecording(dataDir, run(), { ...base, bytes }).ok).toBe(true);
    expect(readFileSync(join(dataDir, 'evidence', 'r-abc123-abcd', 'ev-1.webm')).length).toBe(bytes.length);
  });

  it('never goes up to the code host: a cited id of a recording yields no upload', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'rec-data-'));
    const put = putRecording(dataDir, run(), { ...base, bytes: webmHead(10) });
    if (!put.ok) throw new Error('not kept');
    const held = { ...run({ [put.record.id]: put.record }) } as never;
    expect(uploadsOf(dataDir, held, ['ev-1'])).toEqual([]);
  });
});
