import { type ReactNode, useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Bottom sheet: Esc and the backdrop close it, Tab stays inside, focus goes back to what opened it.
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
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
      <div ref={box} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="row spread">
          <h2 className="sheet-title">{label}</h2>
          <button type="button" className="btn" onClick={() => onClose()}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}
