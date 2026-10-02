import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { shortRef } from '../api';
import type { Ceremony } from '../ceremony';
import { MicIcon } from './icons';
import { TempoHoje } from './TempoHoje';
import { VoiceToggle } from './VoiceToggle';
import { RadarButton, WorktreeBadge } from './radarSlots';
import { WatchersBanner } from './WatchersBanner';

type Filter = 'all' | 'blocked' | 'ask';

export function Today({ ceremony: c, go, pendingActions }: { ceremony: Ceremony; go: (s: Screen) => void; pendingActions: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const cards = c.cards?.cards ?? [];
  const ready = cards.filter((card) => c.turns[card.ref]).length;
  const blocked = cards.filter((card) => card.blockers.length);
  const asking = cards.filter((card) => c.turns[card.ref]?.question);
  const forQa = cards.filter((card) => card.spec && /Code Review OK|Test Fail|Ready To Test/i.test(card.stage ?? ''));
  const shown = filter === 'blocked' ? blocked : filter === 'ask' ? asking : cards;
  const date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  // Turns already prepared (or restored from disk) come from the cache; only the missing ones call an agent.
  useEffect(() => {
    if (c.cards) void c.prepareAll();
  }, [c.cards, c.prepareAll]);

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1320, gap: 28 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--night)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
              </svg>
            </div>
            <div>
              <div className="faint">{today}</div>
              <h1 style={{ fontSize: 26, fontWeight: 700 }}>Bom dia, Luiz</h1>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill"><span className="dot" />Ouvir: whisper local</span>
            <span className="pill"><span className="dot" style={{ background: '#B45309' }} />Falar: Edge (nuvem)</span>
            <span className="pill"><span className="dot" />Agentes: DeepSeek + playbook</span>
            <span className="pill" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber-line)', color: 'var(--amber-ink)', fontWeight: 500 }}>
              Só leitura · efeitos vão para a ata
            </span>
            <button type="button" className="btn" style={{ minHeight: 34 }} onClick={() => go({ name: 'history' })}>Histórico</button>
            <button type="button" className="btn" style={{ minHeight: 34 }} onClick={() => go({ name: 'settings' })}>Configurações</button>
            <button type="button" className="btn" style={{ minHeight: 34 }} onClick={() => go({ name: 'custo' })}>Custo</button>
            <RadarButton go={go} />
            <VoiceToggle />
            <button type="button" className="btn" style={{ minHeight: 34 }} onClick={() => go({ name: 'auditoria' })}>Auditoria</button>
            {/* slot: header buttons of feature modules */}
          </div>
        </header>

        {c.cardsError && <div className="error">Não consegui montar os cartões: {c.cardsError}</div>}

        <TempoHoje refreshKey={`${c.startedAt}-${c.callEnded}-${Object.values(c.deep).reduce((n, d) => n + d.msgs.length, 0)}`} />
        {/* slot: banners of feature modules */}
        <WatchersBanner go={go} />

        {pendingActions > 0 && (
          <div className="item row spread" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber-line)' }}>
            <span className="small" style={{ color: 'var(--amber-ink)', fontWeight: 500 }}>
              {pendingActions === 1 ? '1 ação de release aguardando o seu “seguir”.' : `${pendingActions} ações de release aguardando o seu “seguir”.`}
            </span>
            <button type="button" className="btn" onClick={() => go({ name: 'actions' })}>Ver ações</button>
          </div>
        )}

        {c.resumed && (
          <div className="item row spread" style={{ background: 'var(--teal-soft)', borderColor: '#99F6E4' }}>
            <span className="small" style={{ color: 'var(--teal-ink)' }}>
              {c.saveResult
                ? 'A pré-daily de hoje já foi encerrada e a ata está gravada.'
                : c.startedAt
                  ? `Retomando a pré-daily de hoje, começada às ${new Date(c.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}: os agentes já preparados não são chamados de novo.`
                  : 'Cartões e agentes de hoje recuperados do disco, sem chamar o GitLab nem os agentes de novo.'}
            </span>
            <button type="button" className="btn" disabled={c.loadingCards} onClick={() => void c.reset()}>Nova pré-daily</button>
          </div>
        )}

        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="section-title">Cerimônias de hoje</h2>
          <div className="ceremonies">
            <div className="ceremony main">
              <div className="row spread">
                <span className="small" style={{ color: '#99F6E4', fontWeight: 500 }}>{c.startedAt ? 'Em andamento' : 'Agora'}</span>
                <span className="mono small" style={{ color: '#9CA3AF' }}>~30 s por atividade</span>
              </div>
              <div>
                <h3 style={{ fontSize: 22, marginBottom: 6 }}>Pré-daily</h3>
                <p className="small" style={{ color: '#D1D5DB', lineHeight: 1.5 }}>
                  {c.cards ? `${cards.length} de ${c.cards.total} atividades, bloqueadas primeiro.` : 'Lendo o GitLab pelo daily-report (~30 s).'}
                </p>
              </div>
              <div className="foot">
                <span className="small" style={{ color: '#9CA3AF' }}>
                  {c.cards ? `Agentes prontos ${ready} de ${cards.length}` : 'Montando cartões…'}
                </span>
                <button type="button" className="btn btn-accent" disabled={!c.cards} onClick={() => go({ name: 'call' })}>
                  <MicIcon /> {c.startedAt ? 'Voltar à call' : 'Entrar na call'}
                </button>
              </div>
            </div>

            <div className="ceremony">
              <div className="row spread">
                <span className="small" style={{ color: '#A16207', fontWeight: 600 }}>{blocked.length} com bloqueio</span>
                <span className="mono small faint">sob demanda</span>
              </div>
              <div>
                <h3 style={{ marginBottom: 6 }}>Desbloqueio</h3>
                <p className="small muted" style={{ lineHeight: 1.5 }}>Uma atividade travada, conversa a fundo com o agente dela.</p>
              </div>
              <div className="foot" style={{ justifyContent: 'flex-start' }}>
                {blocked.slice(0, 3).map((card) => (
                  <button key={card.ref} type="button" className="btn" onClick={() => go({ name: 'deep', ref: card.ref, back: 'today' })}>
                    <span className="mono">#{card.iid}</span>
                  </button>
                ))}
                {!blocked.length && <span className="faint">Nenhuma atividade bloqueada</span>}
              </div>
            </div>

            <div className="ceremony">
              <div className="row spread">
                <span className="small faint" style={{ fontWeight: 500 }}>{forQa.length ? `${forQa.length} pronta(s) para o QA` : 'Quando subir release'}</span>
                <span className="mono small faint">QA</span>
              </div>
              <div>
                <h3 style={{ marginBottom: 6 }}>Passagem para o QA</h3>
                <p className="small muted" style={{ lineHeight: 1.5 }}>O agente explica ao QA o que mudou e o que testar; sai o checklist e o aviso do Teams.</p>
              </div>
              <div className="foot" style={{ justifyContent: 'flex-start' }}>
                {forQa.slice(0, 3).map((card) => (
                  <button key={card.ref} type="button" className="btn" onClick={() => go({ name: 'qa', ref: card.ref, card })}>
                    <span className="mono">#{card.iid}</span>
                  </button>
                ))}
                {!forQa.length && (
                  <select className="text-input" style={{ minWidth: 0, maxWidth: '100%', width: '100%' }} aria-label="Escolher atividade para o QA" value="" onChange={(e) => { const card = cards.find((x) => x.ref === e.target.value); if (card) go({ name: 'qa', ref: card.ref, card }); }}>
                    <option value="">Escolher atividade…</option>
                    {cards.filter((x) => x.spec).map((x) => <option key={x.ref} value={x.ref}>#{x.iid} {x.title.slice(0, 50)}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="ceremony">
              <div className="row spread">
                <span className="small faint" style={{ fontWeight: 500 }}>Semanal</span>
                <span className="mono small faint">retro</span>
              </div>
              <div>
                <h3 style={{ marginBottom: 6 }}>Retro</h3>
                <p className="small muted" style={{ lineHeight: 1.5 }}>Reprovações, bloqueios, conflitos, quizzes errados e retrabalho dos últimos 7 dias.</p>
              </div>
              <div className="foot" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="btn" onClick={() => go({ name: 'retro' })}>Abrir a retro</button>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row spread">
            <h2 className="section-title">Agentes de atividade</h2>
            <div className="filters" role="group" aria-label="Filtro">
              {([
                ['all', `Todas · ${cards.length}`],
                ['blocked', `Com bloqueio · ${blocked.length}`],
                ['ask', `Com pergunta · ${asking.length}`],
              ] as [Filter, string][]).map(([key, label]) => (
                <button key={key} type="button" className={`filter ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="list">
            {!c.cards &&
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="list-row">
                  <div className="skeleton" style={{ width: 40, height: 40 }} />
                  <div className="skeleton" style={{ height: 16, flex: '1 1 300px' }} />
                </div>
              ))}
            {shown.map((card) => {
              const turn = c.turns[card.ref];
              const failed = c.turnErrors[card.ref];
              return (
                <div key={card.ref} className="list-row">
                  <div className="row" style={{ flex: '1 1 380px', minWidth: 0, flexWrap: 'nowrap', gap: 14 }}>
                    <div className="chip" style={{ background: c.colorOf(card.ref) }}>{shortRef(card.ref)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                        <a className="mono small muted" href={card.url} target="_blank" rel="noreferrer">#{card.iid}</a>
                        <span className="title">{card.title}</span>
                      </div>
                      <div className="faint" style={{ marginTop: 3 }}>{card.mrs.join(' · ') || 'sem MR'}</div>
                    </div>
                  </div>
                  <div className="small" style={{ flex: '0 1 220px', color: 'var(--ink-2)' }}>
                    {[card.stage, card.spec?.phase].filter(Boolean).join(' · ') || 'sem estágio'}
                  </div>
                  <div className="row" style={{ flex: '0 1 260px', gap: 8 }}>
                    {card.blockers.length > 0 && <span className="badge badge-block" title={card.blockers.join('\n')}>Bloqueio</span>}
                    {turn?.question && <span className="badge badge-ask">Pergunta para você</span>}
                    {turn && !turn.question && !card.blockers.length && <span className="badge badge-quiet">Só informa</span>}
                  </div>
                  <div className="mono faint" style={{ flex: '0 0 auto' }}>
                    {failed ? <span style={{ color: 'var(--red)' }} title={failed}>agente falhou</span> : turn ? 'agente pronto' : <span className="row" style={{ gap: 6 }}><span className="spinner" />preparando</span>}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <WorktreeBadge iid={card.iid} go={go} />
                    {/* slot: per-activity buttons of feature modules */}
                    <button type="button" className="btn" onClick={() => go({ name: 'quick', ref: card.ref, card })}>GitLab</button>
                    {card.stage === 'Test Fail' && <button type="button" className="btn" onClick={() => go({ name: 'reentry', ref: card.ref, card })}>Retorno do QA</button>}
                    {card.mrPaths.length > 0 && <button type="button" className="btn" onClick={() => go({ name: 'discussions', ref: card.ref, card })}>Discussões</button>}
                    {card.spec && <button type="button" className="btn" onClick={() => go({ name: 'gate', ref: card.ref, card })}>Gate</button>}
                    <button type="button" className="btn" onClick={() => go({ name: 'deep', ref: card.ref, back: 'today' })}>Aprofundar</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row spread">
            <p className="faint">
              Cada agente é montado a cada cerimônia a partir do cartão do GitLab, do spec e do playbook. Nada fica guardado só na cabeça dele.
            </p>
            <span className="row" style={{ gap: 10 }}>
              {c.statusAt && (
                <span className="faint">Status conferido às {new Date(c.statusAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              )}
              <button type="button" className="btn" disabled={c.loadingCards} onClick={() => void c.loadCards()}>
                {c.loadingCards ? <span className="spinner" /> : null} Atualizar do GitLab
              </button>
            </span>
          </div>
        </section>

        {(c.decisions.length > 0 || c.effects.length > 0) && (
          <section className="panel" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '18px 20px' }}>
            <div>
              <div className="faint">Ata em andamento</div>
              <div style={{ fontWeight: 600 }}>{c.decisions.length} decisões · {c.effects.length} efeitos aguardando “sim”</div>
            </div>
            <button type="button" className="btn" onClick={() => go({ name: 'ata' })}>Ver ata</button>
          </section>
        )}
      </div>
    </div>
  );
}
