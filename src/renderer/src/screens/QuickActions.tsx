import { useCallback, useEffect, useState } from 'react';
import type { QuickContext, QuickMember, QuickMr, QuickRequest, QuickTransition } from '../../../shared/gitlabQuick';
import type { Card } from '../../../shared/types';
import type { Screen } from '../App';
import { errorText } from '../api';
import { quickApi } from '../gitlabQuickApi';
import { BackIcon } from './icons';

function MrBlock({ mr, members, busy, onPropose }: { mr: QuickMr; members: QuickMember[] | undefined; busy: boolean; onPropose: (r: QuickRequest) => void }) {
  const [reviewer, setReviewer] = useState('');
  const usual = (members ?? []).filter((m) => m.usual > 0);
  const others = (members ?? []).filter((m) => !m.usual);
  const current = mr.reviewers.map((r) => `@${r.username}`).join(', ');

  return (
    <section className="panel" style={{ padding: 18, gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <a className="mono" href={mr.webUrl} target="_blank" rel="noreferrer">{mr.ref}</a>
        {mr.draft && <span className="badge badge-ask">Draft</span>}
        {mr.hasConflicts && <span className="badge badge-block">Conflito</span>}
        {mr.pipeline && <span className="badge badge-quiet">pipeline {mr.pipeline}</span>}
        {!mr.mine && <span className="badge badge-quiet">de @{mr.author}</span>}
      </div>
      <div className="small">{mr.title}</div>
      <div className="small muted">Reviewer: {current || 'ninguém ainda'}</div>

      {mr.mine ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {mr.draft && (
            <button type="button" className="btn" disabled={busy} onClick={() => onPropose({ kind: 'undraft', projectPath: mr.projectPath, mrIid: mr.iid })}>Tirar o Draft</button>
          )}
          <select className="text-input" style={{ flex: '0 1 280px' }} value={reviewer} disabled={busy || !members} onChange={(e) => setReviewer(e.target.value)} aria-label={`Reviewer de ${mr.ref}`}>
            <option value="">{members ? 'Escolher reviewer…' : 'Carregando equipe…'}</option>
            {usual.length > 0 && (
              <optgroup label="Costumam revisar">
                {usual.map((m) => <option key={m.id} value={m.id}>{m.name} (@{m.username})</option>)}
              </optgroup>
            )}
            <optgroup label="Equipe do projeto">
              {others.map((m) => <option key={m.id} value={m.id}>{m.name} (@{m.username})</option>)}
            </optgroup>
          </select>
          <button type="button" className="btn" disabled={busy || !reviewer} onClick={() => onPropose({ kind: 'reviewer', projectPath: mr.projectPath, mrIid: mr.iid, userId: Number(reviewer) })}>
            Propor reviewer
          </button>
        </div>
      ) : (
        <p className="small faint">MR de outra pessoa: só leitura.</p>
      )}
      {mr.mine && mr.reviewers.length > 0 && <p className="small faint">Escolher outro reviewer substitui os atuais.</p>}

      {mr.mine && mr.manualJobs.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {mr.manualJobs.map((j) => (
            <button key={j.id} type="button" className="btn" disabled={busy} onClick={() => onPropose({ kind: 'play', projectPath: mr.projectPath, jobId: j.id })}>
              Rodar job {j.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Transition({ t, status, busy, onPropose }: { t: QuickTransition; status: string | null; busy: boolean; onPropose: () => void }) {
  return (
    <div className="item row spread" style={{ opacity: t.allowed ? 1 : 0.6 }}>
      <div>
        <div style={{ fontWeight: 600 }}>{status ?? '—'} → {t.to}</div>
        <div className="small muted">
          Label: {t.removeLabels.length ? `${t.removeLabels.join(', ')} → ` : ''}{t.addLabel ?? 'já está certa'}
        </div>
        {t.reason && <div className="small faint">{t.reason}</div>}
      </div>
      {t.allowed && (
        <button type="button" className="btn" disabled={busy} onClick={onPropose}>Propor label</button>
      )}
    </div>
  );
}

export function QuickActions({ card, go }: { card: Card | undefined; go: (s: Screen) => void }) {
  const [ctx, setCtx] = useState<QuickContext | null>(null);
  const [members, setMembers] = useState<Record<string, QuickMember[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!card) return;
    setError(null);
    try {
      const c = await quickApi.context(card);
      setCtx(c);
      for (const path of new Set(c.mrs.filter((m) => m.mine).map((m) => m.projectPath))) {
        quickApi.members(path).then((list) => setMembers((prev) => ({ ...prev, [path]: list }))).catch(() => setMembers((prev) => ({ ...prev, [path]: [] })));
      }
    } catch (e) {
      setError(errorText(e));
    }
  }, [card]);

  useEffect(() => {
    void load();
  }, [load]);

  const propose = async (req: QuickRequest) => {
    setBusy(true);
    setError(null);
    try {
      const r = await quickApi.propose(req.kind === 'reviewer' || req.kind === 'undraft' ? { ...req, issue: card ? Number(card.iid) || undefined : undefined } : req);
      setDone((prev) => [...r.created, ...(r.duplicated ? ['Já existe uma proposta igual aguardando você.'] : []), ...prev]);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 900, gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <div>
              <div className="faint">GitLab · propostas</div>
              <h1 style={{ fontSize: 24, fontWeight: 700 }}>{card ? `#${card.iid} ${card.title}` : 'Atividade não encontrada'}</h1>
            </div>
          </div>
          <button type="button" className="btn" onClick={() => go({ name: 'actions' })}>Ver ações</button>
        </header>
        <p className="small muted">Aqui você só monta propostas. Nada vai ao GitLab antes do “seguir” e da confirmação na tela Ações.</p>

        {done.length > 0 && (
          <div className="item" style={{ background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
            <div className="small" style={{ color: 'var(--teal-ink)', fontWeight: 600 }}>Proposta criada — confirme em Ações.</div>
            {done.map((d, i) => <div key={i} className="small">{d}</div>)}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {!ctx && !error && <div className="row faint"><span className="spinner" /> Lendo o GitLab…</div>}
        {ctx?.warnings.map((w) => <div key={w} className="small faint">{w}</div>)}

        {ctx?.issue && (
          <>
            <h2 className="section-title">Status da issue · {ctx.issue.status ?? 'sem status'}</h2>
            <div className="small muted">
              Labels de etapa: {ctx.issue.stageLabels.join(', ') || 'nenhuma'}. Revisão e QA movem os demais status.
            </div>
            {ctx.issue.transitions.map((t) => (
              <Transition key={t.to} t={t} status={ctx.issue?.status ?? null} busy={busy} onPropose={() => void propose({ kind: 'transition', issue: ctx.issue?.iid ?? 0, to: t.to })} />
            ))}
            <p className="small faint">O app propõe só a label. O status é GraphQL e fica por sua conta: a proposta traz o comando.</p>
          </>
        )}

        {ctx && <h2 className="section-title">Merge requests · {ctx.mrs.length}</h2>}
        {ctx && !ctx.mrs.length && <p className="small faint">Esta atividade não tem MR.</p>}
        {ctx?.mrs.map((m) => <MrBlock key={m.ref} mr={m} members={members[m.projectPath]} busy={busy} onPropose={(r) => void propose(r)} />)}
      </div>
    </div>
  );
}
