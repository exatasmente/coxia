import { useState } from 'react';
import type { Screen } from '../App';
import { shortRef } from '../api';
import type { Ceremony } from '../ceremony';
import { useCycle } from '../cycleApi';
import { intlLocale, useT } from '../i18n';
import { type AgoraPlan, type NeedItem, type NeedTarget, mrLabel, stageLabel } from '../dashboard';
import { returnedFromQa } from '../../../shared/cycles/stages';
import { showQuickActions } from '../../../shared/cycles/view';
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
  const t = useT();
  return (
    <section className="dash-agora" aria-labelledby="agora-h">
      <div className="row spread" style={{ gap: 8 }}>
        <h2 id="agora-h" className="dash-agora-label">{t('ui.today.now')}</h2>
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
  const t = useT();
  const tile = (n: number, label: string, tone: 'warn' | 'info', onClick: () => void, aria: string) => (
    <button type="button" className={`tile ${n > 0 ? `tile-${tone}` : ''}`} aria-label={aria} onClick={onClick}>
      <span className="tile-n">{n}</span>
      <span className="tile-l">{label}</span>
    </button>
  );
  return (
    <div className="tiles" role="group" aria-label={t('ui.today.tiles.label')}>
      {tile(blocked, t('ui.today.tiles.blockers'), 'warn', onBlocked, t('ui.today.tiles.blockersAria', { count: blocked }))}
      {tile(asking, t('ui.today.tiles.questions'), 'info', onAsking, t('ui.today.tiles.questionsAria', { count: asking }))}
      {tile(actions, t('ui.today.tiles.actions'), 'warn', onActions, t('ui.today.tiles.actionsAria', { count: actions }))}
    </div>
  );
}

const NEEDS_SHOWN = 5;

export function NeedsList({ items, go, dismiss }: { items: NeedItem[]; go: (s: Screen) => void; dismiss: (id: string) => void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, NEEDS_SHOWN);
  return (
    <section className="dash-sec" aria-labelledby="needs-h">
      <h2 id="needs-h" className="section-title">{items.length ? t('ui.today.needs.titleCount', { count: items.length }) : t('ui.today.needs.title')}</h2>
      {!items.length && <p className="dash-calm">{t('ui.today.needs.empty')}</p>}
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
                  <button type="button" className="need-main" aria-label={n.cta ? t('ui.today.needs.ariaCta', { title: n.title, cta: n.cta }) : n.title} onClick={() => go(needTargetToScreen(n.to!))}>{body}</button>
                ) : (
                  <div className="need-main">{body}</div>
                )}
                {n.alertId && (
                  <button type="button" className="btn need-dismiss" aria-label={t('ui.today.needs.dismissAria', { title: n.title })} onClick={() => dismiss(n.alertId!)}>{t('ui.today.needs.dismiss')}</button>
                )}
                {n.conflictCard && (
                  <div className="need-extra">
                    <ResolveConflict card={n.conflictCard} go={go} place="need" only={n.conflictRef} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > NEEDS_SHOWN && (
        <button type="button" className="btn dash-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? t('ui.today.needs.showLess') : t('ui.today.needs.showMore', { count: items.length - NEEDS_SHOWN })}
        </button>
      )}
    </section>
  );
}

export function ActivityRow({ card, c, go, open, onToggle }: { card: Card; c: Ceremony; go: (s: Screen) => void; open: boolean; onToggle: () => void }) {
  const t = useT();
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
        {card.priority && <span className="badge badge-prio" title={t('ui.today.row.priorityTitle', { label: card.priority.label })}>{card.priority.label}</span>}
        {markText && <span className={`badge ${mark?.kind === 'unchanged' ? 'badge-quiet' : 'badge-ask'}`}>{markText}</span>}
        {blocked && <span className="badge badge-block">{t('ui.today.row.blocker')}</span>}
        {!blocked && asking && <span className="badge badge-ask">{t('ui.today.row.question')}</span>}
        <span className={`chev ${open ? 'open' : ''}`}><ChevronIcon /></span>
      </button>
      {open && (
        <div id={detailId} className="act-detail">
          <p className="act-full">
            <a className="mono" href={card.url} target="_blank" rel="noreferrer">#{card.iid}</a> {card.title}
          </p>
          <dl className="act-facts">
            <dt>{t('ui.today.row.stage')}</dt>
            <dd>{[card.stage, card.spec?.phase].filter(Boolean).join(' · ') || t('today.noStage')}</dd>
            {card.priority && (
              <>
                <dt>{t('ui.today.row.priorityLabel')}</dt>
                <dd>{card.priority.label}</dd>
              </>
            )}
            {card.milestone && (
              <>
                <dt>{t('ui.today.row.milestoneLabel')}</dt>
                <dd>{card.milestone}</dd>
              </>
            )}
            <dt>{t('ui.today.row.crsLabel')}</dt>
            <dd>{card.mrs.join(' · ') || t('ui.today.noMr')}</dd>
            {blocked && (
              <>
                <dt>{t('ui.today.row.blockerLabel')}</dt>
                <dd>{card.blockers.join(' · ')}</dd>
              </>
            )}
            {turn?.question && (
              <>
                <dt>{t('ui.today.row.questionLabel')}</dt>
                <dd>{c.answered[card.ref] ? t('ui.today.row.questionAnswered', { question: turn.question }) : turn.question}</dd>
              </>
            )}
            {turn?.did && (
              <>
                <dt>{t('ui.today.row.today')}</dt>
                <dd>{turn.did}</dd>
              </>
            )}
            {turn?.next && (
              <>
                <dt>{t('ui.today.row.next')}</dt>
                <dd>{turn.next}</dd>
              </>
            )}
            <dt>{t('ui.today.row.agent')}</dt>
            <dd>
              {failed ? <span style={{ color: 'var(--red)' }}>{t('ui.today.row.failed', { error: failed })}</span> : turn ? t('ui.today.row.ready') : <span className="row" style={{ gap: 6 }}><span className="spinner" />{t('ui.today.row.preparing')}</span>}
              {turn && !turn.question && !blocked && <span className="badge badge-quiet" style={{ marginLeft: 8 }}>{t('ui.today.row.infoOnly')}</span>}
              {turn?.reused && (
                <span className="badge badge-quiet" style={{ marginLeft: 8 }} title={t('ui.today.row.reusedHint')}>
                  {t('ui.today.row.reusedSince', { date: new Date(turn.reused.at).toLocaleDateString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' }) })}
                </span>
              )}
            </dd>
          </dl>
          <div className="act-actions">
            <WorktreeBadge iid={card.iid} go={go} />
            {/* slot: per-activity buttons of feature modules */}
            {cycle && showQuickActions(card, cycle.host) && <button type="button" className="btn" onClick={() => go({ name: 'quick', ref: card.ref, card })}>{t('ui.today.row.hostButton')}</button>}
            {cycle && returnedFromQa(cycle, card.stage) && <button type="button" className="btn" onClick={() => go({ name: 'reentry', ref: card.ref, card })}>{t('ui.today.row.qaReturn')}</button>}
            {card.mrPaths.length > 0 && <button type="button" className="btn" onClick={() => go({ name: 'discussions', ref: card.ref, card })}>{t('ui.today.row.discussions')}</button>}
            {card.spec && on?.gate !== false && <button type="button" className="btn" onClick={() => go({ name: 'gate', ref: card.ref, card })}>{t('ui.today.row.gate')}</button>}
            {card.spec && on?.qaHandoff !== false && <button type="button" className="btn" onClick={() => go({ name: 'qa', ref: card.ref, card })} /* i18n-ignore */>QA</button>}
            <ResolveConflict card={card} go={go} place="act" />
            <button type="button" className="btn btn-dark" onClick={() => go({ name: 'deep', ref: card.ref, back: 'today' })}>{t('ui.today.deepen')}</button>
          </div>
        </div>
      )}
    </li>
  );
}
