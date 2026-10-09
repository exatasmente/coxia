import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';

/**
 * Full screen over the app, with zoom (wheel, pinch, + and −), drag, fit and Esc. It knows nothing of what it shows: `children` draws the content with the
 * transform it is given, so a diagram and an image share the same controls. Its own module so a screen that only shows images does not load the diagram renderer.
 */
export function ZoomViewer({ title, onClose, children }: { title?: string; onClose: () => void; children: (style: CSSProperties) => ReactNode }) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const zoom = useCallback((f: number) => setScale((s) => Math.min(6, Math.max(0.3, s * f))), []);
  const reset = useCallback(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoom(1.2);
      else if (e.key === '-') zoom(1 / 1.2);
      else if (e.key === '0') reset();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, zoom, reset]);

  const transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`; // i18n-ignore: CSS value

  return (
    <div className="diagram-overlay" role="dialog" aria-modal="true" aria-label={title ?? t('ui.diagram.fullscreen')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="diagram-toolbar">
        <span className="small" style={{ flex: '1 1 auto', fontWeight: 600 }}>{title ?? t('ui.diagram.title')}</span>
        <button type="button" className="btn" onClick={() => zoom(1 / 1.2)} aria-label={t('ui.diagram.zoomOut')}>−</button>
        <span className="mono small" style={{ minWidth: 48, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
        <button type="button" className="btn" onClick={() => zoom(1.2)} aria-label={t('ui.diagram.zoomIn')}>+</button>
        <button type="button" className="btn" onClick={reset}>{t('ui.diagram.fit')}</button>
        <button ref={closeRef} type="button" className="btn btn-dark" onClick={onClose}>{t('ui.diagram.close')}</button>
      </div>
      <div
        className="diagram-stage"
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          drag.current = touches.current.size === 1 ? { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y } : null;
          pinch.current = null;
        }}
        onPointerMove={(e) => {
          if (!touches.current.has(e.pointerId)) return;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current) zoom(d / pinch.current);
            pinch.current = d;
          } else if (drag.current) {
            setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
          }
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          drag.current = null;
          pinch.current = null;
        }}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          drag.current = null;
          pinch.current = null;
        }}
      >
        {children({ transform })}
      </div>
      <p className="small diagram-hint">{t('ui.diagram.hint')}</p>
    </div>
  );
}
