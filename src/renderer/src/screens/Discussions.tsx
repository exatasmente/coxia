import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../../shared/types';
import type { DiscussionView, DiscussionsResult, MrPath, ProposalView } from '../../../shared/feedback';
import type { Screen } from '../App';
import { errorText } from '../api';
import type { usePlayer } from '../audio';
import type { Ceremony } from '../ceremony';
import { feedbackApi } from '../feedbackApi';
import { ReplayButton } from './Bubble';
import { ContinueInClaude } from './ContinueInClaude';
import { RichText } from './Diagram';
import { BackIcon } from './icons';
import { Presence } from './Avatar';

const STATE_LABEL: Record<ProposalView['state'], string> = {
  pending: 'aguardando o seu “seguir” em Ações',
  running: 'executando',
  done: 'enviada ao GitLab',
  skipped: 'dispensada em Ações',
  failed: 'falhou; veja em Ações',
  unknown: 'proposta registrada',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Discussions({
  card,
  initialMr,
  ceremony: c,
  player,
  go,
}: { card: Card | undefined; initialMr: string | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const mrs = card?.mrPaths ?? [];
  const [mr, setMr] = useState<MrPath | null>(mrs.find((m) => m.ref === initialMr) ?? mrs[0] ?? null);
  const [result, setResult] = useState<DiscussionsResult | null>(null);
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(new Set<string>());
  const spoken = useRef(new Set<string>());
  const voice = c.voices?.agents[4] ?? c.voices?.agents[0] ?? null;

  const load = useCallback(async (target: MrPath) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await feedbackApi.listDiscussions(target));
      setIdx(0);
    } catch (e) {
      setError(errorText(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (mr) void load(mr);
  }, [mr, load]);

  const list = result?.discussions ?? [];
  const current: DiscussionView | undefined = list[Math.min(idx, list.length - 1)];

  const patch = (id: string, change: (d: DiscussionView) => DiscussionView) =>
    setResult((r) => (r ? { ...r, discussions: r.discussions.map((d) => (d.id === id ? change(d) : d)) } : r));

  const explain = useCallback(
    async (d: DiscussionView) => {
      if (!card || !mr) return;
      setExplaining(d.id);
      setError(null);
      try {
        const next = await feedbackApi.explainDiscussion(card, mr, d.id);
        patch(d.id, () => next);
        setDrafts((x) => {
          const { [d.id]: _gone, ...rest } = x;
          return rest;
        });
      } catch (e) {
        setError(errorText(e));
      }
      setExplaining(null);
    },
    [card, mr],
  );

  // One discussion at a time: the one on screen is explained by itself, once per visit to this MR.
  useEffect(() => {
    if (!current || current.explanation || explaining || tried.current.has(current.id)) return;
    tried.current.add(current.id);
    void explain(current);
  }, [current, explaining, explain]);

  useEffect(() => {
    const e = current?.explanation;
    if (!current || !e || !voice || spoken.current.has(`${current.id}|${e.at}`)) return;
    spoken.current.add(`${current.id}|${e.at}`);
    void player.say(e.speech, voice, 'discussão', { item: e }).catch(() => undefined);
  }, [current, voice, player]);

  const propose = async (label: string, d: DiscussionView, fn: () => Promise<ProposalView>) => {
    setBusy(label);
    setError(null);
    try {
      const p = await fn();
      patch(d.id, (x) => ({ ...x, proposals: [...x.proposals, p] }));
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  if (!card) {
    return <div className="page"><div className="wrap"><div className="error">Atividade não encontrada.</div><div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>Voltar</button></div></div></div>;
  }

  const body = current ? (drafts[current.id] ?? current.explanation?.draft ?? '') : '';
  const replied = current?.proposals.filter((p) => p.kind === 'reply') ?? [];
  const resolveProposal = current?.proposals.find((p) => p.kind === 'resolve');

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 940, gap: 18 }}>
        <header className="panel-dark hero" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label="Voltar" onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-violet)', fontWeight: 600 }}>Discussões · {mr?.ref ?? 'sem MR'} · #{card.iid}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={false} thinking={!!busy || loading} on={!!player.speaking} color="var(--night-violet)" small />
          <button type="button" className="btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={loading || !mr} onClick={() => mr && void load(mr)}>
            {loading ? <span className="spinner" /> : null} Atualizar
          </button>
        </header>

        {mrs.length > 1 && (
          <div className="row" style={{ gap: 8 }}>
            {mrs.map((m) => (
              <button key={m.ref} type="button" className={`btn ${m.ref === mr?.ref ? 'btn-on' : ''}`} onClick={() => setMr(m)}>{m.ref}</button>
            ))}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {loading && !result && <div className="row faint"><span className="spinner" /> Lendo as discussões no GitLab…</div>}
        {result && !list.length && <div className="panel" style={{ padding: 20 }}>Nenhuma discussão aberta no {result.mr.ref}.</div>}

        {current && (
          <>
            <div className="row spread">
              <span className="faint">Discussão {Math.min(idx, list.length - 1) + 1} de {list.length}</span>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="btn" disabled={idx <= 0} onClick={() => setIdx(idx - 1)}>Anterior</button>
                <button type="button" className="btn" disabled={idx >= list.length - 1} onClick={() => setIdx(idx + 1)}>Próxima</button>
              </span>
            </div>

            <section className="panel" style={{ padding: 20, gap: 10 }}>
              <h2 className="section-title">O que o revisor escreveu</h2>
              {current.path && <div className="mono small muted" style={{ wordBreak: 'break-all' }}>{current.path}{current.line ? `:${current.line}` : ''}</div>}
              {current.notes.map((n) => (
                <div key={`${n.author}${n.at}`} className="item">
                  <span className="mono faint">{n.author} · {when(n.at)}</span>
                  <span className="small" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</span>
                </div>
              ))}
            </section>

            <section className="panel" style={{ padding: 20, gap: 10 }}>
              <div className="row spread">
                <h2 className="section-title">O ponto, segundo o agente</h2>
                {current.explanation && (
                  <span className="row" style={{ gap: 10 }}>
                    <span className={`badge ${current.explanation.needsCode ? 'badge-block' : 'badge-quiet'}`}>{current.explanation.needsCode ? 'Pede mudança de código' : 'Só resposta'}</span>
                    {voice && (
                      <ReplayButton
                        playing={player.speaking === 'discussão' && player.current === current.explanation}
                        label="Ouvir esta explicação"
                        onPlay={() => void player.say(current.explanation?.speech ?? '', voice, 'discussão', { force: true, item: current.explanation }).catch(() => undefined)}
                        onStop={() => player.stop()}
                      />
                    )}
                  </span>
                )}
              </div>
              {explaining === current.id && <div className="row faint"><span className="spinner" /> O agente está lendo o trecho e a discussão…</div>}
              {current.explanation && (
                <>
                  <p style={{ fontWeight: 600, lineHeight: 1.5 }}>{current.explanation.point}</p>
                  <div className="small" style={{ lineHeight: 1.55 }}><RichText text={current.explanation.text || current.explanation.speech} /></div>
                  {current.stale && <p className="small" style={{ color: 'var(--amber-ink)' }}>A discussão teve respostas novas depois desta explicação.</p>}
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" disabled={!!explaining} onClick={() => void explain(current)}>Explicar de novo</button>
                    <ContinueInClaude sessionId={current.explanation.sessionId} />
                  </div>
                </>
              )}
              {!current.explanation && !explaining && <button type="button" className="btn btn-dark" onClick={() => void explain(current)}>Explicar com o agente</button>}
            </section>

            {current.explanation && (
              <section className="panel composer-panel" style={{ padding: 20, gap: 10 }}>
                <h2 className="section-title">Sua resposta</h2>
                <textarea
                  aria-label="Rascunho da resposta"
                  value={body}
                  onChange={(e) => setDrafts((x) => ({ ...x, [current.id]: e.target.value }))}
                  rows={6}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--field-line)', font: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
                />
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-dark" disabled={!!busy || !body.trim()} onClick={() => mr && void propose('reply', current, () => feedbackApi.replyDiscussion(card, mr, current.id, body))}>Responder</button>
                  <button type="button" className="btn" disabled={!!busy || resolveProposal?.state === 'pending' || resolveProposal?.state === 'done'} onClick={() => mr && void propose('resolve', current, () => feedbackApi.resolveDiscussion(card, mr, current.id))}>Marcar como resolvida</button>
                  {busy && <span className="spinner" />}
                </div>
                <p className="faint">Cada botão só cria uma proposta. Nada vai ao GitLab antes do “seguir” e da confirmação na tela Ações.</p>
                {[...replied, ...(resolveProposal ? [resolveProposal] : [])].map((p) => (
                  <div key={p.key} className="item row spread" style={{ flexDirection: 'row', background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
                    <span className="small">{p.kind === 'reply' ? 'Resposta' : 'Resolver'}: {STATE_LABEL[p.state]}</span>
                    <button type="button" className="btn" style={{ minHeight: 34 }} onClick={() => go({ name: 'actions' })}>Ver em Ações</button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
