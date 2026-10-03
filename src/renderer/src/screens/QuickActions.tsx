import { useCallback, useEffect, useState } from 'react';
import type { QuickContext, QuickMember, QuickMr, QuickRequest, QuickResult, QuickTransition } from '../../../shared/gitlabQuick';
import type { Card } from '../../../shared/types';
import type { Screen } from '../App';
import { errorText } from '../api';
import { useCycle } from '../cycleApi';
import { showIssueStatus } from '../../../shared/cycles/view';
import { useT } from '../i18n';
import { quickApi } from '../gitlabQuickApi';
import { jobs, useJobs } from '../useJobs';
import { BackIcon } from './icons';

function MrBlock({ mr, members, busy, replacesReviewers, onPropose }: { mr: QuickMr; members: QuickMember[] | undefined; busy: boolean; replacesReviewers: boolean; onPropose: (r: QuickRequest) => void }) {
  const t = useT();
  const [reviewer, setReviewer] = useState('');
  const usual = (members ?? []).filter((m) => m.usual > 0);
  const others = (members ?? []).filter((m) => !m.usual);
  const current = mr.reviewers.map((r) => `@${r.username}`).join(', ');

  return (
    <section className="panel" style={{ padding: 18, gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <a className="mono" href={mr.webUrl} target="_blank" rel="noreferrer">{mr.ref}</a>
        {mr.draft && <span className="badge badge-ask">{t('ui.quick.badge.draft')}</span>}
        {mr.hasConflicts && <span className="badge badge-block">{t('ui.quick.badge.conflict')}</span>}
        {mr.pipeline && <span className="badge badge-quiet">{t('ui.quick.badge.pipeline', { status: mr.pipeline })}</span>}
        {!mr.mine && <span className="badge badge-quiet">{t('ui.quick.badge.author', { author: mr.author })}</span>}
      </div>
      <div className="small">{mr.title}</div>
      <div className="small muted">{t('ui.quick.reviewer', { names: current || t('ui.quick.reviewer.none') })}</div>

      {mr.mine ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {mr.draft && (
            <button type="button" className="btn" disabled={busy} onClick={() => onPropose({ kind: 'undraft', projectPath: mr.projectPath, mrIid: mr.iid })}>{t('ui.quick.undraft')}</button>
          )}
          <select className="text-input" style={{ flex: '0 1 280px' }} value={reviewer} disabled={busy || !members} onChange={(e) => setReviewer(e.target.value)} aria-label={t('ui.quick.reviewer.aria', { ref: mr.ref })}>
            <option value="">{members ? t('ui.quick.reviewer.choose') : t('ui.quick.team.loading')}</option>
            {usual.length > 0 && (
              <optgroup label={t('ui.quick.group.usual')}>
                {usual.map((m) => <option key={m.id} value={m.id}>{m.name} (@{m.username})</option>)}
              </optgroup>
            )}
            <optgroup label={t('ui.quick.group.team')}>
              {others.map((m) => <option key={m.id} value={m.id}>{m.name} (@{m.username})</option>)}
            </optgroup>
          </select>
          <button type="button" className="btn" disabled={busy || !reviewer} onClick={() => onPropose({ kind: 'reviewer', projectPath: mr.projectPath, mrIid: mr.iid, userId: /^\d+$/.test(reviewer) ? Number(reviewer) : reviewer })}>
            {t('ui.quick.reviewer.propose')}
          </button>
        </div>
      ) : (
        <p className="small faint">{t('ui.quick.mr.readonly')}</p>
      )}
      {mr.mine && replacesReviewers && mr.reviewers.length > 0 && <p className="small faint">{t('ui.quick.reviewer.replaces')}</p>}

      {mr.mine && mr.manualJobs.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {mr.manualJobs.map((j) => (
            <button key={j.id} type="button" className="btn" disabled={busy} onClick={() => onPropose({ kind: 'play', projectPath: mr.projectPath, jobId: j.id })}>
              {t('ui.quick.job.play', { name: j.name })}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Transition({ transition, status, busy, onPropose }: { transition: QuickTransition; status: string | null; busy: boolean; onPropose: () => void }) {
  const t = useT();
  return (
    <div className="item row spread" style={{ opacity: transition.allowed ? 1 : 0.6 }}>
      <div>
        <div style={{ fontWeight: 600 }}>{status ?? '—'} → {transition.to}</div>
        <div className="small muted">
          {t('ui.quick.label', { labels: `${transition.removeLabels.length ? `${transition.removeLabels.join(', ')} → ` : ''}${transition.addLabel ?? t('ui.quick.label.already')}` })}
        </div>
        {transition.reason && <div className="small faint">{transition.reason}</div>}
      </div>
      {transition.allowed && (
        <button type="button" className="btn" disabled={busy} onClick={onPropose}>{t('ui.quick.label.propose')}</button>
      )}
    </div>
  );
}

export function QuickActions({ card, go }: { card: Card | undefined; go: (s: Screen) => void }) {
  const t = useT();
  const host = useCycle()?.host;
  const [ctx, setCtx] = useState<QuickContext | null>(null);
  const [members, setMembers] = useState<Record<string, QuickMember[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const load = useCallback(() => {
    if (!card) return;
    setError(null);
    jobs.launch(`quick:${card.ref}:context`, { label: t('ui.quick.job.readLabel', { iid: card.iid }), busy: t('ui.quick.job.readBusy'), screen: { name: 'quick', ref: card.ref, card } }, () => quickApi.context(card));
  }, [card]);

  useEffect(() => {
    if (card && !jobs.get(`quick:${card.ref}:context`)) load();
  }, [card, load]);

  const running = useJobs<QuickContext | QuickResult>(card ? `quick:${card.ref}:` : null, {
    done: (value, job) => {
      if (job.key.endsWith(':context')) {
        const c = value as QuickContext;
        setCtx(c);
        for (const path of new Set(c.mrs.filter((m) => m.mine).map((m) => m.projectPath))) {
          quickApi.members(path).then((list) => setMembers((prev) => ({ ...prev, [path]: list }))).catch(() => setMembers((prev) => ({ ...prev, [path]: [] })));
        }
        return;
      }
      const r = value as QuickResult;
      setDone((prev) => [...r.created, ...(r.duplicated ? [t('ui.quick.duplicate')] : []), ...prev]);
      load();
    },
    failed: (message) => setError(message),
  });
  const busy = running.some((j) => j.key.endsWith(':propose'));

  const propose = (req: QuickRequest) => {
    if (!card) return;
    setError(null);
    jobs.launch(`quick:${card.ref}:propose`, { label: t('ui.quick.job.proposeLabel', { iid: card.iid }), busy: t('ui.quick.job.proposeBusy'), screen: { name: 'quick', ref: card.ref, card } }, () =>
      quickApi.propose(req.kind === 'reviewer' || req.kind === 'undraft' ? { ...req, issue: Number(card.iid) || undefined } : req),
    );
  };

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 900, gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.quick.backToday')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <div>
              <div className="faint">{t('ui.quick.kicker')}</div>
              <h1 style={{ fontSize: 24, fontWeight: 700 }}>{card ? `#${card.iid} ${card.title}` : t('ui.quick.notFound')}</h1>
            </div>
          </div>
          <button type="button" className="btn" onClick={() => go({ name: 'actions' })}>{t('ui.quick.seeActions')}</button>
        </header>
        <p className="small muted">{t('ui.quick.intro')}</p>

        {done.length > 0 && (
          <div className="item" style={{ background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
            <div className="small" style={{ color: 'var(--teal-ink)', fontWeight: 600 }}>{t('ui.quick.created')}</div>
            {done.map((d, i) => <div key={i} className="small">{d}</div>)}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {!ctx && !error && <div className="row faint"><span className="spinner" /> {t('ui.quick.job.readBusy')}</div>}
        {ctx?.warnings.map((w) => <div key={w} className="small faint">{w}</div>)}

        {ctx?.issue && host && showIssueStatus(host) && (
          <>
            <h2 className="section-title">{t('ui.quick.status', { status: ctx.issue.status ?? t('ui.quick.status.none') })}</h2>
            <div className="small muted">
              {t('ui.quick.stageLabels', { labels: ctx.issue.stageLabels.join(', ') || t('ui.quick.stageLabels.none') })}
            </div>
            {ctx.issue.transitions.map((tr) => (
              <Transition key={tr.to} transition={tr} status={ctx.issue?.status ?? null} busy={busy} onPropose={() => propose({ kind: 'transition', issue: ctx.issue?.iid ?? 0, to: tr.to })} />
            ))}
            <p className="small faint">{t('ui.quick.statusNote')}</p>
          </>
        )}

        {ctx && <h2 className="section-title">{t('ui.quick.mrs', { count: ctx.mrs.length })}</h2>}
        {ctx && !ctx.mrs.length && <p className="small faint">{t('ui.quick.mrs.none')}</p>}
        {ctx?.mrs.map((m) => <MrBlock key={m.ref} mr={m} members={members[m.projectPath]} busy={busy} replacesReviewers={host?.reviewerReplaces ?? false} onPropose={(r) => propose(r)} />)}
      </div>
    </div>
  );
}
