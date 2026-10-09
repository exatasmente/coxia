import { type EvidenceRecord } from '../../shared/evidence';
import { RECORDING_MAX_BYTES, type RecordingMeta } from '../../shared/screen';
import type { Run } from '../../shared/runs';
import { placeEvidence } from './store';

// The app's own recording of a stage's screen, kept as evidence. It is the only way a `webm` piece comes to exist: `detectKind` still refuses video, so a video an
// agent saves with `SaveEvidence` is refused as before, and the bytes here are the app's own muxer's output, never a file of the stage's folder.

/** Why a recording was not kept. */
export type RecordingProblem = 'empty' | 'too-long' | 'not-webm' | 'write';

/** The EBML header of a WebM file: the magic, then the DocType element (id 0x4282, one length byte 4, "webm") within the first 64 bytes. */
const MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOCTYPE = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];

function isWebm(bytes: Uint8Array): boolean {
  if (!MAGIC.every((b, i) => bytes[i] === b)) return false;
  const head = bytes.subarray(0, 64);
  for (let i = 0; i + DOCTYPE.length <= head.length; i++) if (DOCTYPE.every((b, j) => head[i + j] === b)) return true;
  return false;
}

export function putRecording(
  dataDir: string,
  run: Pick<Run, 'id' | 'evidence'>,
  input: { bytes: Uint8Array; stage: string; by: string; title: string; meta: RecordingMeta; at: string },
): { ok: true; record: EvidenceRecord } | { ok: false; problem: RecordingProblem } {
  if (input.bytes.length === 0) return { ok: false, problem: 'empty' };
  if (input.bytes.length > RECORDING_MAX_BYTES) return { ok: false, problem: 'too-long' };
  if (!isWebm(input.bytes)) return { ok: false, problem: 'not-webm' };
  const id = placeEvidence(dataDir, run, 'webm', input.bytes);
  if (!id) return { ok: false, problem: 'write' };
  return {
    ok: true,
    record: {
      id,
      stage: input.stage,
      by: input.by,
      title: input.title.trim().slice(0, 200),
      description: '',
      name: 'screen-recording.webm',
      kind: 'webm',
      bytes: input.bytes.length,
      at: input.at,
      from: null,
      message: null,
      recording: structuredClone(input.meta),
    },
  };
}
