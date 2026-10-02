import { useEffect, useState } from 'react';
import type { CustoFalas, CustoSummary } from '../../../shared/custo';
import { api } from '../api';
import { intlLocale, useT } from '../i18n';

const usd = (n: number) => `US$ ${n.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;

// Speeches served again because the activity did not change: no agent call, no cost.
export function FalasEconomia({ falas }: { falas: CustoFalas }) {
  const t = useT();
  return (
    <div className="panel" style={{ padding: '14px 18px', minWidth: 190, flex: '1 1 190px', gap: 2 }} /* i18n-ignore */>
      <div className="small muted">{t('ui.cost.falas.reusedToday')}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{falas.reusedToday}</div>
      <div className="small faint">
        {falas.avoidedToday === null ? t('ui.cost.falas.noAverage') : t('ui.cost.falas.avoided', { amount: usd(falas.avoidedToday) })} · {t('ui.cost.falas.week', { count: falas.reusedWeek })}
        {falas.avgPerSpeech !== null ? ` · ${t('ui.cost.falas.perSpeech', { amount: usd(falas.avgPerSpeech) })}` : ''}
      </div>
    </div>
  );
}

// Real average price of one speech per model over the last 7 days, to choose the model of the "turn" role.
export function FalaCostByModel({ current }: { current: string }) {
  const t = useT();
  const [falas, setFalas] = useState<CustoFalas | null>(null);
  useEffect(() => {
    void api.invoke<CustoSummary>('custo:summary').then((s) => setFalas(s.falas), () => setFalas(null));
  }, []);
  if (!falas) return null;
  if (!falas.byModel.length) return <div className="small faint" style={{ marginTop: 6 }}>{t('ui.cost.falas.none')}</div>;
  return (
    <div className="small" style={{ marginTop: 6 }}>
      <div className="faint">{t('ui.cost.falas.avgTitle')}</div>
      {falas.byModel.map((m) => (
        <div key={m.model} className="row" style={{ gap: 8 }}>
          <span className="mono" style={{ fontWeight: m.model === current ? 700 : 400 }}>{m.model}</span>
          <span>{usd(m.avg)}</span>
          <span className="faint">{t('ui.cost.falas.count', { count: m.speeches })}{m.model === current ? ` · ${t('ui.cost.falas.inUse')}` : ''}</span>
        </div>
      ))}
      {falas.byModel.some((m) => m.model === 'desconhecido') && (
        <div className="faint">{t('ui.cost.falas.unknownModel')}</div>
      )}
    </div>
  );
}
