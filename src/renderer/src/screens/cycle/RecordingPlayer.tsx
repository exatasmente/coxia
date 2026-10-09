import { useRef, useState } from 'react';
import type { EvidenceView } from '../../../../shared/evidence';
import { clock } from '../../api';
import { useT } from '../../i18n';
import { RECORDING_IDLE_PAUSE_MS, realAtMedia } from '../../../../shared/screen';
import { cutLeft, markBox } from './recording';

// The app's own recording of an agent's screen, played in the evidence block: the video, and under it a strip with one mark for each interval in which a person used the
// screen. A mark seeks the video to where that interval began. The bytes are read only when the person opens it (a recording is up to 24 MiB). A video whose idle
// stretches were shortened says so: the length of the video and the stage's own time, a tick at each cut with the time it left out, and the stage's time at the
// point being played.

/** The player: a video on a `blob:` address (the media policy of both builds allows it) and the strip of marks. */
export function RecordingPlayer({ record, url }: { record: EvidenceView; url: string }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState(false);
  // The stage's time at the point being played; only shown for a video with cuts.
  const [real, setReal] = useState(0);
  const meta = record.recording;
  const cuts = meta?.cuts ?? [];
  // The video is not preloaded, so a mark clicked before the first play has no length to seek in yet: it loads the metadata first.
  const seek = (ms: number): void => {
    const el = video.current;
    if (!el) return;
    const go = (): void => {
      el.currentTime = ms / 1000;
    };
    if (el.readyState >= 1) go();
    else {
      el.addEventListener('loadedmetadata', go, { once: true });
      el.load();
    }
  };
  return (
    <div className="cy-rec">
      <video
        ref={video}
        className="cy-rec-video"
        src={url}
        controls
        preload="none"
        onError={() => setBroken(true)}
        onTimeUpdate={cuts.length > 0 ? (e) => setReal(realAtMedia(cuts, Math.round(e.currentTarget.currentTime * 1000))) : undefined}
      >
        {t('ui.cycle.rec.noPlay')}
      </video>
      {broken && <p className="small error" role="alert">{t('ui.cycle.rec.noPlay')}</p>}
      {meta && (
        <>
          <p className="faint small">
            {cuts.length > 0
              ? t('ui.cycle.rec.durationReal', { time: clock(0, meta.durationMs), real: clock(0, meta.realMs ?? realAtMedia(cuts, meta.durationMs)) })
              : t('ui.cycle.rec.duration', { time: clock(0, meta.durationMs) })}
          </p>
          {cuts.length > 0 && <p className="faint small cy-rec-real">{t('ui.cycle.rec.realTime', { time: clock(0, real) })}</p>}
          {meta.truncated && <p className="small cy-rec-capped">{t(meta.truncated === 'size' ? 'ui.cycle.rec.truncatedSize' : 'ui.cycle.rec.truncatedTime')}</p>}
          {meta.marks.length > 0 && (
            <div className="cy-rec-marks-box">
              <span className="faint small">{t('ui.cycle.rec.marks')}</span>
              <div className="cy-rec-marks">
                {meta.marks.map((mark, i) => {
                  const box = markBox(meta.durationMs, mark);
                  if (!box) return null;
                  const label = t('ui.cycle.rec.mark', { from: clock(0, mark.fromMs), to: clock(0, mark.toMs) });
                  return (
                    <button
                      // The strip is positioned by the recording's own length: the style carries geometry only, never a color.
                      key={`${mark.fromMs}-${i}`}
                      type="button"
                      className="cy-rec-mark"
                      style={{ left: `${box.left}%`, width: `${box.width}%` }}
                      aria-label={label}
                      title={label}
                      onClick={() => seek(mark.fromMs)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {cuts.some((cut) => cutLeft(meta.durationMs, cut) !== null) && (
            <div className="cy-rec-marks-box">
              <span className="faint small">{t('ui.cycle.rec.cuts')}</span>
              <div className="cy-rec-cuts">
                {cuts.map((cut, i) => {
                  const left = cutLeft(meta.durationMs, cut);
                  if (left === null) return null;
                  const label = t('ui.cycle.rec.cut', { at: clock(0, cut.atMs), skipped: clock(0, cut.skippedMs), real: clock(0, realAtMedia(cuts, cut.atMs)) });
                  return (
                    <button
                      // Geometry only, never a color.
                      key={`${cut.atMs}-${i}`}
                      type="button"
                      className="cy-rec-cut"
                      style={{ left: `${left}%` }}
                      aria-label={label}
                      title={label}
                      // The tick sits where the pause ends: the video is taken to where it began.
                      onClick={() => seek(Math.max(0, cut.atMs - RECORDING_IDLE_PAUSE_MS))}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
