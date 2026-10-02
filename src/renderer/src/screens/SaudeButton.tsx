import { useEffect, useState } from 'react';
import type { SaudeSnapshot } from '../../../shared/saude';
import type { Screen } from '../App';
import { saudeApi } from '../saudeApi';

export function SaudeButton({ go }: { go: (s: Screen) => void }) {
  const [snap, setSnap] = useState<SaudeSnapshot | null>(null);
  useEffect(() => {
    void saudeApi.get().then(setSnap);
    return saudeApi.onChanged(setSnap);
  }, []);
  const problems = snap?.problems ?? 0;
  return (
    <button
      type="button"
      className={`btn ${problems ? 'btn-amber' : ''}`}
      style={{ minHeight: 34 }}
      title={problems ? `${problems} problema(s) nas tarefas ou dependências` : 'Tarefas e dependências do app'}
      onClick={() => go({ name: 'saude' })}
    >
      Saúde{problems ? ` · ${problems}` : ''}
    </button>
  );
}
