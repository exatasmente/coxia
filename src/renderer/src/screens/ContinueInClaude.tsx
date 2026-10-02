import { useState } from 'react';
import { api } from '../api';

export function ContinueInClaude({ sessionId, dark = false }: { sessionId: string | null | undefined; dark?: boolean }) {
  const [state, setState] = useState<string | null>(null);
  if (!sessionId) return null;
  const open = async () => {
    const r = await api.continueInClaude(sessionId);
    if (r.ok) setState('Abrindo o terminal…');
    else setState('Sessão inválida');
    setTimeout(() => setState(null), 3000);
  };
  const copy = async () => {
    await api.copy(`cd ~/projects && claude-or --resume ${sessionId}`);
    setState('Comando copiado');
    setTimeout(() => setState(null), 2000);
  };
  const style = dark ? { background: 'transparent', color: '#F9FAFB', borderColor: '#374151' } : undefined;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <button type="button" className="btn" style={style} title="Abre um terminal com claude-or --resume nesta sessão do agente" onClick={() => void open()}>
        {state ?? 'Continuar no Claude Code'}
      </button>
      <button type="button" className="btn icon-btn" style={style} aria-label="Copiar o comando de retomada" title="Copiar o comando" onClick={() => void copy()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
    </span>
  );
}
