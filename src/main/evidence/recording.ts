import { type EvidenceRecord } from '../../shared/evidence';
import { t } from '../../shared/i18n';
import { RECORDING_MAX_BYTES, type RecordingMeta, isWebm } from '../../shared/screen';
import type { Run } from '../../shared/runs';
import { placeEvidence } from './store';

// The app's own recording of a stage's screen, kept as evidence. It is the only way a `webm` piece comes to exist: `detectKind` still refuses video, so a video an
// agent saves with `SaveEvidence` is refused as before, and the bytes here are the app's own muxer's output, never a file of the stage's folder.

/** Why a recording was not kept. */
export type RecordingProblem = 'empty' | 'too-long' | 'not-webm' | 'write';

/** Why a recording ended without a file the store could keep: the recorder's own reasons, then the store's. */
export type NotKept = RecordingProblem | 'no-frame' | 'unused' | 'encoder';

/** The reason, in words, for the line the conversation gets when a recording could not be kept. */
export const notKeptText = (why: NotKept): string => t(why === 'empty' || why === 'no-frame' ? 'main.screen.notKept.noFrame' : `main.screen.notKept.${why === 'too-long' ? 'tooLong' : why === 'not-webm' ? 'notWebm' : why}`, { max: Math.round(RECORDING_MAX_BYTES / (1024 * 1024)) });

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
