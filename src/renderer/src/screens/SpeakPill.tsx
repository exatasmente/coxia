import { useEffect, useState } from 'react';
import { api } from '../api';

// Which engine speaks: Edge sends the text to Microsoft, Kokoro stays on this machine.
export function SpeakPill() {
  const [engine, setEngine] = useState<'edge' | 'kokoro'>('edge');

  useEffect(() => {
    void api.getSettings().then((s) => setEngine(s.voice.engine));
  }, []);

  return engine === 'kokoro' ? (
    <span className="pill"><span className="dot" />Falar: Kokoro (local)</span>
  ) : (
    <span className="pill"><span className="dot" style={{ background: 'var(--warn)' }} />Falar: Edge (nuvem)</span>
  );
}
