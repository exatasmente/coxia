import type { Run } from '../../../../shared/runs';
import type { RecordingMeta } from '../../../../shared/screen';

// Small pure pieces of the evidence block's player: where a mark sits on the timeline, and the key that tells the evidence list a run kept (or lost) a piece.

/** The least width of a mark on the strip, in percent of it, so a single click of the person is still a mark that can be seen and hit. */
const MARK_MIN_PERCENT = 1.2;

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/** The place of an interval on the timeline, in percent of the recording's length; null for a recording with no length or an interval outside it. */
export function markBox(durationMs: number, mark: RecordingMeta['marks'][number]): { left: number; width: number } | null {
  if (!(durationMs > 0) || !(mark.toMs >= mark.fromMs) || mark.fromMs >= durationMs) return null;
  const left = clamp((mark.fromMs / durationMs) * 100, 0, 100 - MARK_MIN_PERCENT);
  const width = clamp(((Math.min(mark.toMs, durationMs) - mark.fromMs) / durationMs) * 100, MARK_MIN_PERCENT, 100 - left);
  return { left, width };
}

/**
 * A key that changes when the run keeps a piece of evidence, loses one, or a piece is removed by retention: the evidence list reads again when it changes. A recording
 * lands when its stage ends, after the list was read for the stage; the list was otherwise read once per run.
 */
export function evidenceKey(run: Pick<Run, 'evidence'> | null | undefined): string {
  return Object.values(run?.evidence ?? {}).map((e) => `${e.id}${e.removed ? '!' : ''}`).join(',');
}

/**
 * The list just read, with the records that did not change kept as the same objects: an open piece of evidence reads its bytes again when its record changes, and a
 * list read again must not make a recording of megabytes load once more.
 */
export function keepSame<T extends { id: string }>(before: readonly T[] | null | undefined, next: T[] | null): T[] | null {
  if (!next || !before) return next;
  const old = new Map(before.map((e) => [e.id, e]));
  return next.map((e) => {
    const was = old.get(e.id);
    return was && JSON.stringify(was) === JSON.stringify(e) ? was : e;
  });
}
