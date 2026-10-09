import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type LiveScreen as LiveScreenState, SCREEN_WIDTH_DESKTOP, SCREEN_WIDTH_PHONE, type ScreenInput, clampFrameWidth, isExitChord } from '../../../../shared/screen';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { useIsPhone } from '../../useIsPhone';
import { Sheet } from '../Sheet';
import { jpegSrc, screenApi } from './screenApi';
import { type Size, FLUSH_MS, batchesOf, buttonOf, createHeld, isSentKey, pointerToScreen, pollDelay, takeControl, wheelNotches } from './screenKeys';

// The live screen of an agent: a working stage's, or the one an agent has in a conversation. The viewer is given the screen's key (`run:<id>` or `call:<thread>:<agent>`), never a run.
// The agent's virtual screen, refreshed about twice a second while the viewer is open, in the desktop window and in the paired browser
// alike. On the desktop alone, "Take control" sends the person's clicks, wheel and keys to that screen; the viewer then says plainly that it is on and that it is being
// recorded, and the chord Ctrl+Alt+Shift+Escape (never sent) gives control back. Frames are asked for, never pushed: closing the viewer stops the asking.

interface Frames {
  /** The latest picture as an address the page may show (a `data:` URL: the desktop's policy has no `blob:` for images). */
  src: string | null;
  /** The display's own size, which the pointer is mapped to. */
  screen: Size | null;
  /** Someone controls the screen (read from the answer, so the paired browser sees it too). */
  remote: boolean;
  /** The stage ended: the answer was `none`. */
  ended: boolean;
  /** The last ask failed; it is tried again. */
  failed: boolean;
}

const NOTE_MS = 3000;

/** Asks for the latest frame of the screen over and over: not while the document is hidden, never overlapping, slower after a slow answer, and no more once the stage ended. */
function useFrames(screenKey: string, width: number): Frames {
  const [frames, setFrames] = useState<Frames>({ src: null, screen: null, remote: false, ended: false, failed: false });
  useEffect(() => {
    let live = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let since = 0;
    const tick = async (): Promise<void> => {
      if (!live || busy || document.hidden) return;
      busy = true;
      const began = Date.now();
      let next: Partial<Frames> = {};
      let again = true;
      try {
        const answer = await screenApi.frame(screenKey, since, width);
        if (!live) return;
        if (answer.state === 'none') {
          next = { ended: true, remote: false, failed: false };
          again = false;
        } else if (answer.state === 'same') {
          next = { remote: answer.control, failed: false };
        } else {
          since = answer.seq;
          next = { src: jpegSrc(answer.jpeg), screen: answer.screen, remote: answer.control, failed: false };
        }
      } catch {
        next = { failed: true };
      } finally {
        busy = false;
      }
      if (!live) return;
      setFrames((f) => (Object.entries(next).every(([k, v]) => f[k as keyof Frames] === v) ? f : { ...f, ...next }));
      if (again) timer = setTimeout(() => void tick(), pollDelay(Date.now() - began));
    };
    const onVisibility = (): void => {
      if (document.hidden || busy) return;
      if (timer) clearTimeout(timer);
      timer = null;
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [screenKey, width]);
  return frames;
}

/** What the viewer needs to know of the screen it shows: its size and whether it is recorded. */
export type ViewerState = Pick<LiveScreenState, 'width' | 'height' | 'recording'>;

/** The viewer of a live screen, in a sheet. `state` may be gone while it is open (the stage ended, the screen was closed): it then says so and stops asking. */
export function LiveScreen({ screenKey, state, onClose }: { screenKey: string; state: ViewerState | null; onClose: () => void }) {
  const t = useT();
  const web = isWeb();
  const phone = useIsPhone();
  const width = clampFrameWidth(web || phone ? SCREEN_WIDTH_PHONE : SCREEN_WIDTH_DESKTOP);
  const frames = useFrames(screenKey, width);
  const live = state;
  const ended = frames.ended || !live;

  const [control, setControl] = useState(false);
  const [rejected, setRejected] = useState(0);
  const controlRef = useRef(false);
  const held = useRef(createHeld());
  const pending = useRef<ScreenInput[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const size = useRef<Size | null>(null);
  size.current = frames.screen ?? (live ? { width: live.width, height: live.height } : null);

  const noteRejected = useCallback((count: number) => {
    setRejected(count);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setRejected(0), NOTE_MS);
  }, []);

  /** Sends what is queued, in calls of at most `SCREEN_INPUT_MAX` events, one after the other. */
  const flush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const batches = batchesOf(pending.current);
    pending.current = [];
    for (const batch of batches) {
      chain.current = chain.current.then(async () => {
        const answer = await screenApi.input(screenKey, batch).catch(() => null);
        if (!answer) return;
        if (answer.rejected > 0) noteRejected(answer.rejected);
        // The main process says control is not on (or the screen is gone): the viewer follows.
        if (answer.reason && controlRef.current) {
          controlRef.current = false;
          setControl(false);
        }
      });
    }
  }, [screenKey, noteRejected]);

  const queue = useCallback(
    (event: ScreenInput) => {
      pending.current.push(event);
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
    },
    [flush],
  );

  /** Puts up every key and button the person still holds, so none stays down on the agent's screen. */
  const releaseHeld = useCallback(() => {
    for (const event of held.current.releaseAll()) pending.current.push(event);
    if (pending.current.length > 0) flush();
  }, [flush]);

  const stopControl = useCallback(() => {
    if (!controlRef.current) return;
    controlRef.current = false;
    setControl(false);
    releaseHeld();
    chain.current = chain.current.then(() => screenApi.control(screenKey, false).then(() => undefined, () => undefined));
  }, [screenKey, releaseHeld]);

  const startControl = async (): Promise<void> => {
    if (!(await takeControl((on) => screenApi.control(screenKey, on), () => open.current))) return;
    controlRef.current = true;
    setControl(true);
    stageBox.current?.focus();
  };

  // Closing the viewer, or the stage ending, gives control back; an ask for it that is still in flight is given back when its answer comes.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  useEffect(() => () => stopControl(), [stopControl]);
  useEffect(() => {
    if (ended) stopControl();
  }, [ended, stopControl]);
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  // While control is on the viewer takes the keyboard, the wheel and the window's loss of focus; all of it is undone when it goes off.
  useEffect(() => {
    if (!control) return;
    const onKey = (e: KeyboardEvent): void => {
      const down = e.type === 'keydown';
      // The way out never reaches the agent's screen.
      if (down && isExitChord(e.key, { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey })) {
        e.preventDefault();
        e.stopPropagation();
        stopControl();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!isSentKey(e.key)) return;
      if (down) queue(held.current.keyDown(e.code || e.key, e.key));
      else {
        const up = held.current.keyUp(e.code || e.key);
        if (up) queue(up);
      }
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const dy = wheelNotches(e.deltaY, e.deltaMode);
      if (dy !== 0) queue({ t: 'scroll', dy });
    };
    const box = stageBox.current;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', releaseHeld);
    box?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', releaseHeld);
      box?.removeEventListener('wheel', onWheel);
    };
  }, [control, queue, releaseHeld, stopControl]);

  const place = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const el = image.current;
    const screen = size.current;
    if (!el || !screen) return null;
    const r = el.getBoundingClientRect();
    return pointerToScreen({ left: r.left, top: r.top, width: r.width, height: r.height }, { x: e.clientX, y: e.clientY }, screen);
  };
  const onMove = (e: ReactPointerEvent): void => {
    if (!control) return;
    const at = place(e);
    if (at) queue({ t: 'move', ...at });
  };
  const onDown = (e: ReactPointerEvent): void => {
    if (!control) return;
    const b = buttonOf(e.button);
    if (!b) return;
    e.preventDefault();
    stageBox.current?.focus();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const at = place(e);
    if (at) queue({ t: 'move', ...at });
    queue(held.current.buttonDown(b));
  };
  const onUp = (e: ReactPointerEvent): void => {
    if (!control) return;
    const b = buttonOf(e.button);
    if (!b) return;
    const at = place(e);
    if (at) queue({ t: 'move', ...at });
    const up = held.current.buttonUp(b);
    if (up) queue(up);
  };

  const recording = live?.recording;
  return (
    <Sheet label={t('ui.cycle.live.title')} onClose={onClose} wide captureKeys={control}>
      <div className="cy-live">
        <div className="row cy-live-bar">
          {recording && <span className={`badge ${recording === 'on' ? 'cy-tone-blocked' : 'cy-tone-quiet'}`}>{recording === 'on' ? t('ui.cycle.live.recordingOn') : recording === 'waiting' ? t('ui.cycle.live.recordingWaiting') : t('ui.cycle.live.recordingStopped')}</span>}
          {frames.remote && !control && <span className="badge cy-tone-person">{t('ui.cycle.live.remote')}</span>}
          {!web && !ended && (
            <div className="cy-switch-row cy-live-switch">
              <button type="button" role="switch" aria-checked={control} aria-label={t('ui.cycle.live.control')} className={`cy-switch ${control ? 'on' : ''}`} onClick={() => (control ? stopControl() : void startControl())}>
                <span className="cy-switch-knob" aria-hidden="true" />
              </button>
              <span className="cy-switch-text">
                <span>{t('ui.cycle.live.control')}</span>
                <span className="faint">{t('ui.cycle.live.controlHint')}</span>
              </span>
            </div>
          )}
        </div>
        {control && (
          <p className="cy-live-banner" role="status">
            {recording === 'stopped' ? t('ui.cycle.live.controlStopped') : recording === 'waiting' ? t('ui.cycle.live.controlWaiting') : t('ui.cycle.live.controlOn')}
          </p>
        )}
        {rejected > 0 && <p className="small cy-live-rejected" role="status">{t('ui.cycle.live.rejected', { count: rejected })}</p>}
        <div
          ref={stageBox}
          className={`cy-live-stage ${control ? 'controlled' : ''}`}
          tabIndex={-1}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => control && e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          {frames.src ? (
            <img ref={image} className="cy-live-image" src={frames.src} alt={t('ui.cycle.live.alt')} draggable={false} />
          ) : (
            !ended && <p className="small faint cy-live-wait"><span className="spinner" aria-hidden="true" /> {t('ui.cycle.live.waiting')}</p>
          )}
        </div>
        {frames.failed && !ended && <p className="small faint" role="status">{t('ui.cycle.live.failed')}</p>}
        {ended && <p className="small cy-live-ended" role="status">{t('ui.cycle.live.ended')}</p>}
      </div>
    </Sheet>
  );
}
