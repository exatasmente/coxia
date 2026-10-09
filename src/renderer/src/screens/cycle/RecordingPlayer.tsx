import { useRef, useState } from 'react';
import type { EvidenceView } from '../../../../shared/evidence';
import { clock } from '../../api';
import { useT } from '../../i18n';
import { markBox } from './recording';

// The app's own recording of an agent's screen, played in the evidence block: the video, and under it a strip with one mark for each interval in which a person used the
// screen. A mark seeks the video to where that interval began. The bytes are read only when the person opens it (a recording is up to 24 MiB).

/** The player: a video on a `blob:` address (the media policy of both builds allows it) and the strip of marks. */
export function RecordingPlayer({ record, url }: { record: EvidenceView; url: string }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState(false);
  const meta = record.recording;
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
      <video ref={video} className="cy-rec-video" src={url} controls preload="none" onError={() => setBroken(true)}>
        {t('ui.cycle.rec.noPlay')}
      </video>
      {broken && <p className="small error" role="alert">{t('ui.cycle.rec.noPlay')}</p>}
      {meta && (
        <>
          <p className="faint small">{t('ui.cycle.rec.duration', { time: clock(0, meta.durationMs) })}</p>
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
        </>
      )}
    </div>
  );
}
