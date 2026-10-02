import { useState } from 'react';
import type { Screen } from '../App';
import { shortRef } from '../api';
import type { Ceremony } from '../ceremony';
import { useCycle } from '../cycleApi';
import { type AgoraPlan, type NeedItem, type NeedTarget, conflictMrs, mrLabel, stageLabel } from '../dashboard';
import { returnedFromQa } from '../../../shared/cycles/stages';
import type { Card } from '../../../shared/types';
import { getLanguage } from '../../../shared/i18n';
import { clockOf } from '../../../shared/sameDay';
import { t } from '../i18n';
import { ChevronIcon } from './dashIcons';
import { ResolveConflict } from './ResolveConflict';
import { WorktreeBadge } from './radarSlots';

export function needTargetToScreen(t: NeedTarget): Screen {
  switch (t.to) {
    case 'deep':
      return { name: 'deep', ref: t.ref, back: 'today' };
    case 'gate':
      return { name: 'gate', ref: t.ref, card: t.card };
    case 'conflict':
      return { name: 'conflict', id: t.id };
    case 'actions':
      return { name: 'actions' };
  }
}

export function AgoraCard({ plan, onAction }: { plan: AgoraPlan; onAction: (a: AgoraPlan['primary']['action']) => void }) {
  return (
    <section className="dash-agora" aria-labelledby="agora-h">
      <div className="row spread" style={{ gap: 8 }}>
        <h2 id="agora-h" className="dash-agora-label">Agora</h2>
        {plan.progress && (
          <span className="small agora-progress" aria-live="polite">
            {plan.phase === 'loading' && <span className="spinner" aria-hidden="true" />}
            {plan.progress}
          </span>
        )}
      </div>
      <div>
        <p className="agora-title">{plan.title}</p>
        {plan.hint && <p className="small agora-hint">{plan.hint}</p>}
      </div>
      <div className="agora-actions">
        <button type="button" className="btn btn-accent agora-primary" disabled={plan.primary.disabled} onClick={() => onAction(plan.primary.action)}>
          {plan.primary.label}
        </button>
        {plan.secondary.map((b) => (
          <button key={b.action} type="button" className="btn agora-secondary" disabled={b.disabled} onClick={() => onAction(b.action)}>
            {b.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function Tiles({ blocked, asking, actions, onBlocked, onAsking, onActions }: { blocked: number; asking: number; actions: number; onBlocked: () => void; onAsking: () => void; onActions: () => void }) {
  const tile = (n: number, label: string, tone: 'warn' | 'info', onClick: () => void, aria: string) => (
    <button type="button" className={`tile ${n > 0 ? `tile-${tone}` : ''}`} aria-label={`${n} ${aria}`} onClick={onClick}>
      <span className="tile-n">{n}</span>
      <span className="tile-l">{label}</span>
    </button>
  );
  return (
    <div className="tiles" role="group" aria-label="Resumo do dia">
      {tile(blocked, 'Bloqueios', 'warn', onBlocked, blocked === 1 ? 'bloqueio, ver atividades' : 'bloqueios, ver atividades')}
      {tile(asking, 'Perguntas', 'info', onAsking, asking === 1 ? 'pergunta sem resposta, ver atividades' : 'perguntas sem resposta, ver atividades')}
      {tile(actions, 'Ações', 'warn', onActions, actions === 1 ? 'ação aguardando, abrir ações' : 'ações aguardando, abrir ações')}
    </div>
  );
}

const NEEDS_SHOWN = 5;

export function NeedsList({ items, go, dismiss }: { items: NeedItem[]; go: (s: Screen) => void; dismiss: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, NEEDS_SHOWN);
  return (
    <section className="dash-sec" aria-labelledby="needs-h">
      <h2 id="needs-h" className="section-title">Precisa de você{items.length ? ` · ${items.length}` : ''}</h2>
      {!items.length && <p className="dash-calm">Nada esperando por você agora.</p>}
      {items.length > 0 && (
        <ul className="needs">
          {shown.map((n) => {
            const body = (
              <>
                <span className="need-text">
                  <span className="need-title">{n.title}</span>
                  {n.detail && <span className="need-detail">{n.detail}</span>}
                </span>
                {n.cta && <span className="need-cta" aria-hidden="true">{n.cta} ›</span>}
              </>
            );
            return (
              <li key={n.id} className={`need need-${n.tone}`}>
                {n.to ? (
                  <button type="button" className="need-main" aria-label={n.cta ? `${n.title}. ${n.cta}` : n.title} onClick={() => go(needTargetToScreen(n.to!))}>{body}</button>
                ) : (
                  <div className="need-main">{body}</div>
                )}
                {n.alertId && (
                  <button type="button" className="btn need-dismiss" aria-label={`Dispensar: ${n.title}`} onClick={() => dismiss(n.alertId!)}>Dispensar</button>
                )}
                {n.conflictCard && (
                  <div className="need-extra">
                    <ResolveConflict card={n.conflictCard} go={go} place="need" only={conflictMrs(n.conflictCard).find((m) => n.title.startsWith(`${m.ref}:`))?.ref} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > NEEDS_SHOWN && (
        <button type="button" className="btn dash-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Mostrar menos' : `Ver mais ${items.length - NEEDS_SHOWN}`}
        </button>
      )}
    </section>
  );
}

export function ActivityRow({ card, c, go, open, onToggle }: { card: Card; c: Ceremony; go: (s: Screen) => void; open: boolean; onToggle: () => void }) {
  const cycle = useCycle();
  const on = cycle?.ceremonies;
  const turn = c.turns[card.ref];
  const failed = c.turnErrors[card.ref];
  const blocked = card.blockers.length > 0;
  const asking = !!turn?.question && !c.answered[card.ref];
  const mark = c.marks[card.ref];
  const markText = mark?.since && mark.kind !== 'new' ? t(mark.kind === 'unchanged' ? 'sameDay.mark.unchanged' : 'sameDay.mark.changed', { time: clockOf(mark.since, getLanguage()) }) : null;
  const detailId = `act-${shortRef(card.ref)}-${card.iid}`;
  return (
    <li className={`act ${open ? 'open' : ''}`}>
      <button type="button" className="act-head" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <span className="chip chip-sm" style={{ background: c.colorOf(card.ref) }} aria-hidden="true">{shortRef(card.ref)}</span>
        <span className="act-main">
          <span className="act-title">{card.title}</span>
          <span className="act-sub">{stageLabel(card)} · {mrLabel(card.mrs.length)}</span>
        </span>
        {markText && <span className={`badge ${mark?.kind === 'unchanged' ? 'badge-quiet' : 'badge-ask'}`}>{markText}</span>}
        {blocked && <span className="badge badge-block">bloqueio</span>}
        {!blocked && asking && <span className="badge badge-ask">pergunta</span>}
        <span className={`chev ${open ? 'open' : ''}`}><ChevronIcon /></span>
      </button>
      {open && (
        <div id={detailId} className="act-detail">
          <p className="act-full">
            <a className="mono" href={card.url} target="_blank" rel="noreferrer">#{card.iid}</a> {card.title}
          </p>
          <dl className="act-facts">
            <dt>Estágio</dt>
            <dd>{[card.stage, card.spec?.phase].filter(Boolean).join(' · ') || 'sem estágio'}</dd>
            <dt>MRs</dt>
            <dd>{card.mrs.join(' · ') || 'sem MR'}</dd>
            {blocked && (
              <>
                <dt>Bloqueio</dt>
                <dd>{card.blockers.join(' · ')}</dd>
              </>
            )}
            {turn?.question && (
              <>
                <dt>Pergunta</dt>
                <dd>{turn.question}{c.answered[card.ref] ? ' (respondida)' : ''}</dd>
              </>
            )}
            {turn?.did && (
              <>
                <dt>Hoje</dt>
                <dd>{turn.did}</dd>
              </>
            )}
            {turn?.next && (
              <>
                <dt>Próximo</dt>
                <dd>{turn.next}</dd>
              </>
            )}
            <dt>Agente</dt>
            <dd>
              {failed ? <span style={{ color: 'var(--red)' }}>falhou: {failed}</span> : turn ? 'pronto' : <span className="row" style={{ gap: 6 }}><span className="spinner" />preparando</span>}
              {turn && !turn.question && !blocked && <span className="badge badge-quiet" style={{ marginLeft: 8 }}>Só informa</span>}
              {turn?.reused && (
                <span className="badge badge-quiet" style={{ marginLeft: 8 }} title="Falei isto antes e o cartão não mudou.">
                  Sem mudança desde {new Date(turn.reused.at).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                </span>
              )}
            </dd>
          </dl>
          <div className="act-actions">
            <WorktreeBadge iid={card.iid} go={go} />
            {/* slot: per-activity buttons of feature modules */}
            <button type="button" className="btn" onClick={() => go({ name: 'quick', ref: card.ref, card })}>GitLab</button>
            {cycle && returnedFromQa(cycle, card.stage) && <button type="button" className="btn" onClick={() => go({ name: 'reentry', ref: card.ref, card })}>Retorno do QA</button>}
            {card.mrPaths.length > 0 && <button type="button" className="btn" onClick={() => go({ name: 'discussions', ref: card.ref, card })}>Discussões</button>}
            {card.spec && on?.gate !== false && <button type="button" className="btn" onClick={() => go({ name: 'gate', ref: card.ref, card })}>Gate</button>}
            {card.spec && on?.qaHandoff !== false && <button type="button" className="btn" onClick={() => go({ name: 'qa', ref: card.ref, card })}>QA</button>}
            <ResolveConflict card={card} go={go} place="act" />
            <button type="button" className="btn btn-dark" onClick={() => go({ name: 'deep', ref: card.ref, back: 'today' })}>Aprofundar</button>
          </div>
        </div>
      )}
    </li>
  );
}
