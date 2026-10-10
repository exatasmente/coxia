import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '../i18n';

// i18n-ignore-next-line: CSS selector
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const WIDE = 'sheet sheet-wide'; // i18n-ignore: CSS classes

// Bottom sheet: Esc and the backdrop close it, Tab stays inside, focus goes back to what opened it. With `captureKeys` the sheet leaves Esc and Tab alone: what is inside
// takes the keyboard (the live screen's Take control sends every key to the agent's screen), and the buttons and the backdrop still close it.
export function Sheet({ label, onClose, children, wide, captureKeys }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean; captureKeys?: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const capture = useRef(!!captureKeys);
  capture.current = !!captureKeys;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (capture.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        const items = Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus();
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={() => onClose()}>
      <div ref={box} className={wide ? WIDE : 'sheet'} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="row spread">
          <h2 className="sheet-title">{label}</h2>
          <button type="button" className="btn" onClick={() => onClose()}>{t('ui.sheet.close')}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
