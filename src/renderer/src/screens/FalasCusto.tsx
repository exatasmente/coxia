import { useEffect, useState } from 'react';
import type { CustoFalas, CustoSummary } from '../../../shared/custo';
import { api } from '../api';

const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;

// Speeches served again because the activity did not change: no agent call, no cost.
export function FalasEconomia({ falas }: { falas: CustoFalas }) {
  return (
    <div className="panel" style={{ padding: '14px 18px', minWidth: 190, flex: '1 1 190px', gap: 2 }}>
      <div className="small muted">Falas reaproveitadas hoje</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{falas.reusedToday}</div>
      <div className="small faint">
        {falas.avoidedToday === null ? 'Sem média por fala ainda' : `${usd(falas.avoidedToday)} evitados`} · {falas.reusedWeek} em 7 dias
        {falas.avgPerSpeech !== null ? ` · ${usd(falas.avgPerSpeech)} por fala` : ''}
      </div>
    </div>
  );
}

// Real average price of one speech per model over the last 7 days, to choose the model of the "turn" role.
export function FalaCostByModel({ current }: { current: string }) {
  const [falas, setFalas] = useState<CustoFalas | null>(null);
  useEffect(() => {
    void api.invoke<CustoSummary>('custo:summary').then((s) => setFalas(s.falas), () => setFalas(null));
  }, []);
  if (!falas) return null;
  if (!falas.byModel.length) return <div className="small faint" style={{ marginTop: 6 }}>Custo por fala: ainda sem falas nos últimos 7 dias.</div>;
  return (
    <div className="small" style={{ marginTop: 6 }}>
      <div className="faint">Custo médio real por fala, últimos 7 dias</div>
      {falas.byModel.map((m) => (
        <div key={m.model} className="row" style={{ gap: 8 }}>
          <span className="mono" style={{ fontWeight: m.model === current ? 700 : 400 }}>{m.model}</span>
          <span>{usd(m.avg)}</span>
          <span className="faint">{m.speeches} {m.speeches === 1 ? 'fala' : 'falas'}{m.model === current ? ' · em uso' : ''}</span>
        </div>
      ))}
      {falas.byModel.some((m) => m.model === 'desconhecido') && (
        <div className="faint">"desconhecido": abra a tela Custo e atualize para ler o modelo dessas chamadas.</div>
      )}
    </div>
  );
}
