import { useEffect, useState } from 'react';
import { buildMinutes } from '../../../shared/minutes';
import type { HistoryEntry, SavedCeremony } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText, plural } from '../api';
import { ContinueInClaude } from './ContinueInClaude';
import { EfeitoStatus } from './EfeitoStatus';
import { BackIcon } from './icons';

function time(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
}

function span(start: number | null, end: number | null): string {
  return end ? `${time(start)}–${time(end)}` : `${time(start)} · em andamento`;
}

function day(date: string): string {
  const d = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export function History({ go }: { go: (s: Screen) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SavedCeremony | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .listHistory()
      .then((list) => {
        setEntries(list);
        setSelected(list[0]?.id ?? null);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    api.getHistory(selected).then(setDetail, (e) => setError(errorText(e)));
  }, [selected]);

  const copy = async (what: string, text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const days = [...new Set((entries ?? []).map((e) => e.date))];
  const m = detail ? buildMinutes(detail) : null;
  const deepDives = detail ? Object.entries(detail.deep).filter(([, d]) => d.msgs.length) : [];
  const written = (ref: string, dest: string) => detail?.saveResult?.written.find((w) => w.ref === ref && w.dest === dest);

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 20 }}>
        <header className="row" style={{ gap: 14 }}>
          <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>Histórico de cerimônias</h1>
          <span className="faint">{entries ? `${entries.length} cerimônias` : ''}</span>
        </header>
        {error && <div className="error">{error}</div>}

        <div className="cols" style={{ gap: 20 }}>
          <aside className="panel" style={{ flex: '1 1 280px', maxWidth: 340, minWidth: 260, gap: 6 }}>
            {!entries && <div className="row faint"><span className="spinner" /> Lendo o histórico…</div>}
            {entries?.length === 0 && <p className="small faint">Nenhuma cerimônia gravada ainda.</p>}
            {days.map((date) => (
              <div key={date} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                <h2 className="section-title" style={{ fontSize: 12 }}>{day(date)}</h2>
                {entries
                  ?.filter((e) => e.date === date)
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className={`option ${selected === e.id ? 'on' : ''}`}
                      aria-pressed={selected === e.id}
                      onClick={() => setSelected(e.id)}
                      style={{ padding: 12 }}
                    >
                      <span className="row spread">
                        <span style={{ fontWeight: 600 }}>Pré-daily · {span(e.startedAt, e.endedAt)}</span>
                        <span className={`badge ${e.ataSaved ? 'badge-now' : 'badge-quiet'}`} style={{ fontSize: 11 }}>{e.ataSaved ? 'ata gravada' : 'sem ata'}</span>
                      </span>
                      <span className="small muted" style={{ display: 'block', marginTop: 4 }}>
                        {[
                          plural(e.activities, 'atividade', 'atividades'),
                          plural(e.decisions, 'decisão', 'decisões'),
                          plural(e.effects, 'efeito', 'efeitos'),
                          e.deepDives ? plural(e.deepDives, 'desbloqueio', 'desbloqueios') : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </aside>

          <main style={{ flex: '3 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {selected && !detail && <div className="row faint"><span className="spinner" /> Abrindo a cerimônia…</div>}
            {detail && m && (
              <>
                <section className="panel" style={{ padding: 20 }}>
                  <div className="row spread">
                    <div>
                      <div className="faint">{day(detail.date)}</div>
                      <h2 style={{ fontSize: 22, fontWeight: 700 }}>Pré-daily · {span(detail.startedAt, detail.endedAt)}</h2>
                    </div>
                    {detail.saveResult && <span className="mono faint" style={{ wordBreak: 'break-all' }}>{detail.saveResult.ataPath}</span>}
                  </div>
                </section>

                <section className="panel" style={{ padding: 20 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Decisões · {m.decisions.length}</h2>
                  {!m.decisions.length && <p className="small faint">Nenhuma decisão.</p>}
                  {m.decisions.map((d, i) => {
                    const w = written(d.ref, d.dest);
                    return (
                      <div key={`${d.ref}-${i}`} className="item">
                        <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                          <span className="mono small muted">{d.ref}</span>
                          <span>{d.text}</span>
                        </span>
                        <span className="dest">→ {d.dest}</span>
                        <span className="small" style={{ color: w?.ok ? 'var(--teal-ink)' : 'var(--faint)' }}>
                          {w ? (w.ok ? 'gravada' : w.detail) : 'não gravada'}
                        </span>
                      </div>
                    );
                  })}
                </section>

                <section className="panel" style={{ padding: 20 }}>
                  <div className="row spread">
                    <h2 style={{ fontSize: 18, fontWeight: 600 }}>Efeitos · {m.effects.length}</h2>
                    <button
                      type="button"
                      className="btn"
                      disabled={!m.effects.length}
                      onClick={() =>
                        void copy('effects', ['Ações da pré-daily, peça o meu "sim" antes de cada uma:', ...m.effects.map((e, i) => `${i + 1}. ${e.ref} (${e.repo}): ${e.text}`)].join('\n'))
                      }
                    >
                      {copied === 'effects' ? 'Copiado' : 'Copiar para o Claude Code'}
                    </button>
                  </div>
                  {m.effects.map((e, i) => (
                    <div key={`${e.ref}-${i}`} className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--line-2)' }}>
                      <span className="badge-e3">E3</span>
                      <span style={{ flex: '1 1 260px' }}>{e.text}</span>
                      <span className="mono faint">{e.repo} · {e.ref}</span>
                      <EfeitoStatus effect={e} ceremonyId={detail.id} date={detail.date} />
                    </div>
                  ))}
                  {m.unanswered.length > 0 && (
                    <>
                      <h3 className="section-title" style={{ marginTop: 8 }}>Perguntas sem resposta</h3>
                      {m.unanswered.map((u) => (
                        <div key={u.ref} className="item ask"><span className="mono small">{u.ref}</span><span className="small">{u.question}</span></div>
                      ))}
                    </>
                  )}
                </section>

                {detail.teams && (
                  <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
                    <div className="row spread">
                      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Texto da daily do time</h2>
                      <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} onClick={() => void copy('teams', detail.teams as string)}>
                        {copied === 'teams' ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <pre className="teams">{detail.teams}</pre>
                  </section>
                )}

                <section className="panel" style={{ padding: 20 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>O que cada agente disse</h2>
                  {(detail.cards?.cards ?? []).map((card) => {
                    const turn = detail.turns[card.ref];
                    return (
                      <div key={card.ref} className="item">
                        <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                          <span className="mono small muted">#{card.iid}</span>
                          <span style={{ fontWeight: 600 }}>{card.title}</span>
                        </span>
                        <span className="small">{turn?.speech ?? 'Agente não chegou a falar.'}</span>
                        {turn?.question && <span className="small" style={{ color: 'var(--blue-ink)' }}>Pergunta: {turn.question}{detail.answered[card.ref] ? ' (respondida)' : ''}</span>}
                        <span><ContinueInClaude sessionId={turn?.sessionId} /></span>
                      </div>
                    );
                  })}
                </section>

                {deepDives.map(([ref, d]) => (
                  <section key={ref} className="panel" style={{ padding: 20, gap: 12 }}>
                    <div className="row spread">
                      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Desbloqueio · {ref}</h2>
                      <ContinueInClaude sessionId={d.sessionId} />
                    </div>
                    {d.msgs.map((msg, i) => (
                      <div key={i} className={`bubble-row ${msg.me ? 'me' : ''}`}>
                        <div className="bubble">
                          <div className="who">{msg.me ? 'Você' : 'Agente'} · {msg.at}</div>
                          <div style={{ lineHeight: 1.5 }}>{msg.text}</div>
                        </div>
                      </div>
                    ))}
                    {d.sources.length > 0 && <p className="faint mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>Leu: {d.sources.join(' · ')}</p>}
                  </section>
                ))}

                <section className="panel" style={{ padding: 20 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Transcrição</h2>
                  {m.transcript.length === 0 && <p className="small faint">Sem falas registradas.</p>}
                  {m.transcript.map((t, i) => (
                    <div key={i} className="log-line">
                      <span className="at">{t.at}</span>
                      <span className="who">{t.who}</span>
                      <span className="text">{t.text}</span>
                    </div>
                  ))}
                </section>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
