import { useMemo } from 'react';
import { encodeQr, qrPath } from '../../../shared/qr';

// Drawn locally from the text; always dark on white so any camera reads it in both themes.
export function QrCode({ text, label }: { text: string; label: string }) {
  const qr = useMemo(() => {
    try {
      return qrPath(encodeQr(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!qr) return null;
  return (
    <svg className="web-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={qr.size} height={qr.size} style={{ fill: 'var(--white)' }} />
      <path d={qr.d} style={{ fill: 'var(--night)' }} />
    </svg>
  );
}
