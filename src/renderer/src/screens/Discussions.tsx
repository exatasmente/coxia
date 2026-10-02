import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../../shared/types';
import type { DiscussionView, DiscussionsResult, MrPath, ProposalView } from '../../../shared/feedback';
import type { Screen } from '../App';
import { errorText } from '../api';
import type { usePlayer } from '../audio';
import type { Ceremony } from '../ceremony';
import { jobs, useJobs } from '../useJobs';
import { feedbackApi } from '../feedbackApi';
import { intlLocale, useT } from '../i18n';
import { ReplayButton } from './Bubble';
import { ContinueInClaude } from './ContinueInClaude';
import { RichText } from './Diagram';
import { BackIcon } from './icons';
import { Presence } from './Avatar';

const HEADER_STYLE: CSSProperties = { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }; // i18n-ignore: CSS value
const SPEAKER = 'discussão'; // i18n-ignore: speaker id

const STATE_LABEL: Record<ProposalView['state'], string> = {
  pending: 'ui.discussions.state.pending',
  running: 'ui.discussions.state.running',
  done: 'ui.discussions.state.done',
  skipped: 'ui.discussions.state.skipped',
  failed: 'ui.discussions.state.failed',
  unknown: 'ui.discussions.state.unknown',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Discussions({
  card,
  initialMr,
  ceremony: c,
  player,
  go,
}: { card: Card | undefined; initialMr: string | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const t = useT();
  const mrs = card?.mrPaths ?? [];
  const [mr, setMr] = useState<MrPath | null>(mrs.find((m) => m.ref === initialMr) ?? mrs[0] ?? null);
  const [result, setResult] = useState<DiscussionsResult | null>(null);
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(new Set<string>());
  const spoken = useRef(new Set<string>());
  const voice = c.voices?.agents[4] ?? c.voices?.agents[0] ?? null;

  const listKey = (target: MrPath) => `discussions:${card?.ref}:${target.ref}:list`;
  const explainKey = (target: MrPath, id: string) => `discussions:${card?.ref}:${target.ref}:explain:${id}`;
  // Explanations that came back before the list did; main keeps them too, so the list read afterwards already has them.
  const explained = useRef(new Map<string, DiscussionView>());

  const load = useCallback(
    (target: MrPath) => {
      if (!card) return;
      setError(null);
      jobs.launch(listKey(target), { label: t('ui.discussions.job.list', { ref: target.ref }), busy: t('ui.discussions.reading'), screen: { name: 'discussions', ref: card.ref, mr: target.ref, card } }, () => feedbackApi.listDiscussions(target));
    },
    [card],
  );

  // A list read that finished while this screen was closed is shown as it was; otherwise the list is read again.
  useEffect(() => {
    if (mr && !jobs.get(listKey(mr))) load(mr);
  }, [mr, load]);

  const patch = (id: string, change: (d: DiscussionView) => DiscussionView) =>
    setResult((r) => (r ? { ...r, discussions: r.discussions.map((d) => (d.id === id ? change(d) : d)) } : r));

  const clearDraft = (id: string) =>
    setDrafts((x) => {
      const { [id]: _gone, ...rest } = x;
      return rest;
    });

  const running = useJobs<DiscussionsResult | DiscussionView>(card ? `discussions:${card.ref}:` : null, {
    done: (value, job) => {
      if (!mr || !job.key.includes(`:${mr.ref}:`)) return;
      if (job.key.endsWith(':list')) {
        const r = value as DiscussionsResult;
        setResult({ ...r, discussions: r.discussions.map((d) => { const o = explained.current.get(d.id); return o && (o.explanation?.at ?? '') > (d.explanation?.at ?? '') ? o : d; }) });
        setIdx(0);
        return;
      }
      const view = value as DiscussionView;
      explained.current.set(view.id, view);
      patch(view.id, () => view);
      clearDraft(view.id);
    },
    failed: (message) => setError(message),
  });
  const loading = !!mr && running.some((j) => j.key === listKey(mr));
  const explaining = mr ? (running.find((j) => j.key.startsWith(explainKey(mr, '')))?.key.slice(explainKey(mr, '').length) ?? null) : null;

  const list = result?.discussions ?? [];
  const current: DiscussionView | undefined = list[Math.min(idx, list.length - 1)];

  const explain = useCallback(
    (d: DiscussionView) => {
      if (!card || !mr) return;
      setError(null);
      jobs.launch(explainKey(mr, d.id), { label: t('ui.discussions.job.explain', { ref: mr.ref }), busy: t('ui.discussions.explaining'), screen: { name: 'discussions', ref: card.ref, mr: mr.ref, card } }, () => feedbackApi.explainDiscussion(card, mr, d.id));
    },
    [card, mr],
  );

  // One discussion at a time: the one on screen is explained by itself, once per visit to this MR.
  useEffect(() => {
    if (!current || current.explanation || explaining || tried.current.has(current.id)) return;
    tried.current.add(current.id);
    explain(current);
  }, [current, explaining, explain]);

  useEffect(() => {
    const e = current?.explanation;
    if (!current || !e || !voice || spoken.current.has(`${current.id}|${e.at}`)) return;
    spoken.current.add(`${current.id}|${e.at}`);
    void player.say(e.speech, voice, SPEAKER, { item: e }).catch(() => undefined);
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
    return <div className="page"><div className="wrap"><div className="error">{t('ui.discussions.notFound')}</div><div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>{t('ui.discussions.back')}</button></div></div></div>;
  }

  const body = current ? (drafts[current.id] ?? current.explanation?.draft ?? '') : '';
  const replied = current?.proposals.filter((p) => p.kind === 'reply') ?? [];
  const resolveProposal = current?.proposals.find((p) => p.kind === 'resolve');

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 940, gap: 18 }}>
        <header className="panel-dark hero" style={HEADER_STYLE}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.discussions.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-violet)', fontWeight: 600 }}>{t('ui.discussions.header', { mr: mr?.ref ?? t('ui.discussions.noMr'), iid: card.iid })}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={false} thinking={!!busy || loading} on={!!player.speaking} color="var(--night-violet)" small />
          <button type="button" className="btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={loading || !mr} onClick={() => mr && load(mr)}>
            {loading ? <span className="spinner" /> : null} {t('ui.discussions.refresh')}
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
        {loading && !result && <div className="row faint"><span className="spinner" /> {t('ui.discussions.reading')}</div>}
        {result && !list.length && <div className="panel" style={{ padding: 20 }}>{t('ui.discussions.none', { ref: result.mr.ref })}</div>}

        {current && (
          <>
            <div className="row spread">
              <span className="faint">{t('ui.discussions.position', { n: Math.min(idx, list.length - 1) + 1, total: list.length })}</span>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="btn" disabled={idx <= 0} onClick={() => setIdx(idx - 1)}>{t('ui.discussions.previous')}</button>
                <button type="button" className="btn" disabled={idx >= list.length - 1} onClick={() => setIdx(idx + 1)}>{t('ui.discussions.next')}</button>
              </span>
            </div>

            <section className="panel" style={{ padding: 20, gap: 10 }}>
              <h2 className="section-title">{t('ui.discussions.reviewer')}</h2>
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
                <h2 className="section-title">{t('ui.discussions.point')}</h2>
                {current.explanation && (
                  <span className="row" style={{ gap: 10 }}>
                    <span className={`badge ${current.explanation.needsCode ? 'badge-block' : 'badge-quiet'}`}>{current.explanation.needsCode ? t('ui.discussions.needsCode') : t('ui.discussions.replyOnly')}</span>
                    {voice && (
                      <ReplayButton
                        playing={player.speaking === SPEAKER && player.current === current.explanation}
                        label={t('ui.discussions.listen')}
                        onPlay={() => void player.say(current.explanation?.speech ?? '', voice, SPEAKER, { force: true, item: current.explanation }).catch(() => undefined)}
                        onStop={() => player.stop()}
                      />
                    )}
                  </span>
                )}
              </div>
              {explaining === current.id && <div className="row faint"><span className="spinner" /> {t('ui.discussions.explaining')}</div>}
              {current.explanation && (
                <>
                  <p style={{ fontWeight: 600, lineHeight: 1.5 }}>{current.explanation.point}</p>
                  <div className="small" style={{ lineHeight: 1.55 }}><RichText text={current.explanation.text || current.explanation.speech} /></div>
                  {current.explanation.partial && <p className="small" style={{ color: 'var(--amber-ink)' }}>{t('ui.discussions.partialHint')}</p>}
                  {current.stale && <p className="small" style={{ color: 'var(--amber-ink)' }}>{t('ui.discussions.stale')}</p>}
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" disabled={!!explaining} onClick={() => explain(current)}>{t('ui.discussions.explainAgain')}</button>
                    <ContinueInClaude sessionId={current.explanation.sessionId} />
                  </div>
                </>
              )}
              {!current.explanation && !explaining && <button type="button" className="btn btn-dark" onClick={() => explain(current)}>{t('ui.discussions.explain')}</button>}
            </section>

            {current.explanation && (
              <section className="panel composer-panel" style={{ padding: 20, gap: 10 }}>
                <h2 className="section-title">{t('ui.discussions.yourReply')}</h2>
                <textarea
                  aria-label={t('ui.discussions.draft.aria')}
                  value={body}
                  onChange={(e) => setDrafts((x) => ({ ...x, [current.id]: e.target.value }))}
                  rows={6}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--field-line)', font: 'inherit', lineHeight: 1.5, resize: 'vertical' }} // i18n-ignore: CSS value
                />
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-dark" disabled={!!busy || !body.trim()} onClick={() => mr && void propose('reply', current, () => feedbackApi.replyDiscussion(card, mr, current.id, body))}>{t('ui.discussions.reply')}</button>
                  <button type="button" className="btn" disabled={!!busy || resolveProposal?.state === 'pending' || resolveProposal?.state === 'done'} onClick={() => mr && void propose('resolve', current, () => feedbackApi.resolveDiscussion(card, mr, current.id))}>{t('ui.discussions.resolve')}</button>
                  {busy && <span className="spinner" />}
                </div>
                <p className="faint">{t('ui.discussions.proposalNote')}</p>
                {[...replied, ...(resolveProposal ? [resolveProposal] : [])].map((p) => (
                  <div key={p.key} className="item row spread" style={{ flexDirection: 'row', background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
                    <span className="small">{p.kind === 'reply' ? t('ui.discussions.proposal.reply', { state: t(STATE_LABEL[p.state]) }) : t('ui.discussions.proposal.resolve', { state: t(STATE_LABEL[p.state]) })}</span>
                    <button type="button" className="btn" style={{ minHeight: 34 }} onClick={() => go({ name: 'actions' })}>{t('ui.discussions.viewActions')}</button>
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
