import { type CSSProperties, useEffect, useState } from 'react';
import { type ConflictHunk, type ConflictStep, type Confidence, type HunkChoice, conflictStep, hunkReady } from '../../../shared/conflict';
import type { ReleaseAction } from '../../../shared/types';
import { AgentActivity } from '../AgentActivity';
import { api, errorText } from '../api';
import { conflictApi } from '../conflictApi';
import { KIND_MARK, type ViewLine, proposalLines, sideLines } from '../conflictView';
import { tNodes, useT } from '../i18n';
import { withJob } from '../jobs';
import '../conflict.css';

const SECTION_STYLE: CSSProperties = { padding: '18px 20px' }; // i18n-ignore: CSS value
const CHOICE_LABEL: Record<HunkChoice, string> = { proposal: 'ui.resolver.choice.proposal', ours: 'ui.resolver.choice.ours', theirs: 'ui.resolver.choice.theirs', edit: 'ui.resolver.choice.edit' };
const CHOSEN_LABEL: Record<HunkChoice, string> = { proposal: 'ui.resolver.chosen.proposal', ours: 'ui.resolver.chosen.ours', theirs: 'ui.resolver.chosen.theirs', edit: 'ui.resolver.chosen.edit' };
const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'ui.resolver.confidence.alta', media: 'ui.resolver.confidence.media', baixa: 'ui.resolver.confidence.baixa' };
const PROGRESS_LABEL: Record<ConflictStep, string> = {
  none: 'ui.resolver.progress.none',
  prepared: 'ui.resolver.progress.prepared',
  proposed: 'ui.resolver.progress.proposed',
  applied: 'ui.resolver.progress.applied',
  'verify-failed': 'ui.resolver.progress.verifyFailed',
  'push-waiting': 'ui.resolver.progress.pushWaiting',
  published: 'ui.resolver.progress.published',
};

const STEPS: { key: string; label: string; done: ConflictStep[] }[] = [
  { key: 'prepare', label: 'ui.resolver.step.prepare', done: ['prepared', 'proposed', 'applied', 'verify-failed', 'push-waiting', 'published'] },
  { key: 'propose', label: 'ui.resolver.step.propose', done: ['proposed', 'applied', 'verify-failed', 'push-waiting', 'published'] },
  { key: 'apply', label: 'ui.resolver.step.apply', done: ['applied', 'push-waiting', 'published'] },
  { key: 'publish', label: 'ui.resolver.step.publish', done: ['published'] },
];

function Code({ lines, empty }: { lines: ViewLine[]; empty: string }) {
  if (!lines.length) return <div className="cr-empty">{empty}</div>;
  return (
    <pre className="cr-code">
      {lines.map((l, i) => (
        <span key={i} className="cr-line" data-kind={l.kind} data-mark={KIND_MARK[l.kind]}>{l.text || ' '}</span>
      ))}
    </pre>
  );
}

function Side({ title, picked, children }: { title: string; picked: boolean; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="cr-side" data-picked={picked}>
      <div className="cr-side-title">{picked ? t('ui.resolver.side.picked', { title }) : title}</div>
      {children}
    </div>
  );
}

function Hunk({ h, index, total, locked, onChoose }: { h: ConflictHunk; index: number; total: number; locked: boolean; onChoose: (id: string, choice: HunkChoice, edited?: string) => Promise<void> }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const choose = async (choice: HunkChoice, edited?: string) => {
    setError(null);
    try {
      await onChoose(h.id, choice, edited);
      if (choice !== 'edit') setEditing(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const startEdit = () => {
    setDraft(h.edited ?? h.proposal ?? h.ours);
    setEditing(true);
  };

  const proposal = h.choice === 'edit' && h.edited !== null ? h.edited : h.proposal;
  const proposalLabel = h.choice === 'edit' && h.edited !== null ? t('ui.resolver.side.edited') : t('ui.resolver.side.proposal');
  const noMain = h.whole && h.theirsGone;
  const noBranch = h.whole && h.oursGone;

  return (
    <div className="cr-hunk" data-chosen={hunkReady(h)}>
      <div className="row spread" style={{ gap: 8 }}>
        <span className="small muted">{h.whole ? t('ui.resolver.hunk.whole') : t('ui.resolver.hunk.title', { n: index + 1, total })}</span>
        <span className="row" style={{ gap: 6 }}>
          {h.confidence && <span className={`badge ${h.confidence === 'alta' ? 'badge-now' : h.confidence === 'media' ? 'badge-ask' : 'badge-block'}`}>{t(CONFIDENCE_LABEL[h.confidence])}</span>}
          {hunkReady(h) && <span className="badge badge-quiet">{t(CHOSEN_LABEL[h.choice as HunkChoice])}</span>}
        </span>
      </div>

      <div className="cr-sides">
        <Side title={t('ui.resolver.side.branch')} picked={h.choice === 'ours'}>
          <Code lines={sideLines(h.ours, h.base, 'ours')} empty={noBranch ? t('ui.resolver.empty.branchRemoved') : t('ui.resolver.empty.branchAdded')} />
        </Side>
        <Side title={t('ui.resolver.side.main')} picked={h.choice === 'theirs'}>
          <Code lines={sideLines(h.theirs, h.base, 'theirs')} empty={noMain ? t('ui.resolver.empty.mainRemoved') : t('ui.resolver.empty.mainAdded')} />
        </Side>
        <Side title={proposalLabel} picked={h.choice === 'proposal' || h.choice === 'edit'}>
          {proposal !== null ? (
            <Code lines={proposalLines(proposal, h)} empty={t('ui.resolver.empty.proposal')} />
          ) : (
            <div className="cr-empty">{h.sensitive ? t('ui.resolver.empty.sensitive') : t('ui.resolver.empty.noProposal')}</div>
          )}
        </Side>
      </div>

      {h.partial && <p className="cr-note" style={{ color: 'var(--amber-ink)' }}>{t('ui.resolver.partialHint')}</p>}
      {h.explanation && <p className="cr-note">{h.explanation}</p>}
      {h.test && <p className="cr-note muted"><strong>{t('ui.resolver.test')}</strong> {h.test}</p>}

      {editing && (
        <>
          <textarea className="cr-edit" aria-label={t('ui.resolver.edit.aria')} spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="cr-picks">
            <button type="button" className="btn btn-dark" disabled={locked} onClick={() => void choose('edit', draft)}>{t('ui.resolver.edit.use')}</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>{t('ui.resolver.cancel')}</button>
          </div>
        </>
      )}

      <div className="cr-picks" role="group" aria-label={t('ui.resolver.hunk.group')}>
        {h.proposal !== null && <button type="button" className={`btn ${h.choice === 'proposal' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'proposal'} disabled={locked} onClick={() => void choose('proposal')}>{t(CHOICE_LABEL.proposal)}</button>}
        <button type="button" className={`btn ${h.choice === 'ours' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'ours'} disabled={locked} onClick={() => void choose('ours')}>{t(CHOICE_LABEL.ours)}</button>
        <button type="button" className={`btn ${h.choice === 'theirs' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'theirs'} disabled={locked} onClick={() => void choose('theirs')}>{t(CHOICE_LABEL.theirs)}</button>
        <button type="button" className={`btn ${h.choice === 'edit' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'edit'} disabled={locked} onClick={startEdit}>{t(CHOICE_LABEL.edit)}</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// The in-app resolution of a release conflict: prepare → propose → review → apply and verify → publish.
export function ConflictResolver({ action }: { action: ReleaseAction }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [busySince, setBusySince] = useState<number>();
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null | undefined>(undefined);
  const [skipTests, setSkipTests] = useState(false);
  const [confirm, setConfirm] = useState<'commit' | 'push' | 'discard' | null>(null);
  const [push, setPush] = useState<ReleaseAction | null>(null);

  const r = action.resolve ?? null;
  const step = conflictStep(action);
  const project = String((action.unit ?? {}).project_path ?? '');
  const files = r?.files ?? [];
  const hunks = files.flatMap((f) => f.hunks);
  const undecided = hunks.filter((h) => !hunkReady(h)).length;
  const proposals = hunks.filter((h) => h.proposal !== null && !hunkReady(h)).length;
  const reviewing = step === 'prepared' || step === 'proposed';
  const working = !!busy || !!r?.busy;
  const pushId = r?.pushId ?? null;
  const progress = r?.busy ? r.busy : step === 'applied' && r?.verify?.skipped ? t('ui.resolver.progress.appliedNoTests') : t(PROGRESS_LABEL[step]);
  const L = {
    prepare: t('ui.resolver.busy.prepare'),
    propose: t('ui.resolver.busy.propose'),
    applyVerify: t('ui.resolver.busy.applyVerify'),
    apply: t('ui.resolver.busy.apply'),
    commit: t('ui.resolver.busy.commit'),
    reopen: t('ui.resolver.busy.reopen'),
    push: t('ui.resolver.busy.push'),
    discard: t('ui.resolver.busy.discard'),
  };

  useEffect(() => {
    let live = true;
    conflictApi.verifyConfig().then((c) => live && setCommand(c.commands[project] ?? null)).catch(() => live && setCommand(null));
    return () => {
      live = false;
    };
  }, [project, step]);

  useEffect(() => {
    if (!pushId) {
      setPush(null);
      return;
    }
    let live = true;
    api.listActions().then((all) => live && setPush(all.find((a) => a.id === pushId) ?? null)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pushId, action]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setBusySince(Date.now());
    setError(null);
    try {
      await withJob(`resolve:${action.id}`, fn);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
    setConfirm(null);
  };

  const choose = async (hunkId: string, choice: HunkChoice, edited?: string) => {
    await api.conflictChoose(action.id, hunkId, choice, edited);
  };

  if (action.state === 'skipped') return null;

  return (
    <section className="panel cr" style={SECTION_STYLE} aria-label={t('ui.resolver.aria')}>
      <div className="row spread">
        <h2 className="section-title">{t('ui.resolver.title')}</h2>
        <span className="badge badge-ask">{progress}</span>
      </div>
      <div className="cr-steps">
        {STEPS.map((s) => {
          const done = s.done.includes(step);
          const now = !done && (STEPS.find((x) => !x.done.includes(step))?.key === s.key);
          return <span key={s.key} className="cr-step" data-state={done ? 'done' : now ? 'now' : 'todo'}>{done ? '✓ ' : ''}{t(s.label)}</span>;
        })}
      </div>

      {step === 'none' && (
        <>
          <p className="cr-note">
            {t('ui.resolver.none.intro')}
          </p>
          <div className="row">
            <button type="button" className="btn btn-amber" disabled={working} onClick={() => void run(L.prepare, () => api.conflictPrepare(action.id))}>
              {busy ? <span className="spinner" /> : null} {t('ui.resolver.none.prepare')}
            </button>
          </div>
        </>
      )}

      {r && reviewing && (
        <>
          <p className="cr-note muted mono" style={{ wordBreak: 'break-all' }}>{r.worktree}</p>
          {r.proposalSummary && <p className="cr-note">{r.proposalSummary}</p>}
          {hunks.length === 0 && <p className="cr-note">{t('ui.resolver.noHunks')}</p>}
          <div className="row" hidden={hunks.length === 0}>
            <button type="button" className="btn btn-dark" disabled={working} onClick={() => void run(L.propose, () => api.conflictPropose(action.id))}>
              {busy === L.propose ? <span className="spinner" /> : null} {step === 'proposed' ? t('ui.resolver.propose.again') : t('ui.resolver.propose.ask')}
            </button>
            {proposals > 0 && (
              <button type="button" className="btn" disabled={working} onClick={() => void run('', () => choose('*', 'proposal'))}>{t('ui.resolver.useProposal', { count: proposals })}</button>
            )}
          </div>
          {files.map((f) => (
            <div key={f.path} className="cr-file">
              <div className="cr-file-name">{f.path}</div>
              {f.hunks.map((h, i) => (
                <Hunk key={h.id} h={h} index={i} total={f.hunks.length} locked={working} onChoose={choose} />
              ))}
            </div>
          ))}

          <div className="cr-file">
            <h3 className="section-title">{t('ui.resolver.apply.title')}</h3>
            {command ? (
              <p className="cr-note">{tNodes('ui.resolver.verifyCommand', { command: <code className="mono">{command}</code> }, { project })}</p>
            ) : (
              <>
                <p className="cr-note">{t('ui.resolver.noCommand', { project: project || t('ui.resolver.thisProject') })}</p>
                <label className="check-row">
                  <input type="checkbox" checked={skipTests} onChange={() => setSkipTests(!skipTests)} />
                  <span><span style={{ fontWeight: 600, display: 'block' }}>{t('ui.resolver.skipTests.label')}</span><span className="small muted">{t('ui.resolver.skipTests.hint')}</span></span>
                </label>
              </>
            )}
            <div className="row">
              <button type="button" className="btn btn-dark" disabled={working || undecided > 0 || (!command && !skipTests)} onClick={() => void run(command ? L.applyVerify : L.apply, () => api.conflictApply(action.id, { skipTests: !command && skipTests }))}>
                {busy === L.applyVerify || busy === L.apply ? <span className="spinner" /> : null} {t('ui.resolver.apply.button')}
              </button>
              {undecided > 0 && <span className="small muted">{t('ui.resolver.undecided', { count: undecided })}</span>}
            </div>
          </div>
        </>
      )}

      {r && (step === 'verify-failed' || step === 'applied') && (
        <div className="cr-file">
          {r.verify?.skipped ? (
            <p className="cr-note">{t('ui.resolver.verify.skipped')}</p>
          ) : (
            <>
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${r.verify?.exitCode === 0 ? 'badge-now' : 'badge-block'}`}>{r.verify?.exitCode === 0 ? t('ui.resolver.verify.passed') : t('ui.resolver.verify.failed', { code: String(r.verify?.exitCode) })}</span>
                <code className="small mono" style={{ overflowWrap: 'anywhere' }}>{r.verify?.command}</code>
              </div>
              <pre className="cr-log">{r.verify?.tail || t('ui.resolver.verify.noOutput')}</pre>
              {r.verify?.log && <p className="small faint mono" style={{ wordBreak: 'break-all' }}>{t('ui.resolver.verify.log', { log: r.verify.log })}</p>}
            </>
          )}
          {step === 'verify-failed' && <p className="cr-note">{t('ui.resolver.verify.judge')}</p>}
          <div className="row">
            {confirm === 'commit' ? (
              <button type="button" className="btn btn-red" disabled={working} onClick={() => void run(L.commit, () => api.conflictCommit(action.id))}>{t('ui.resolver.commit.confirm')}</button>
            ) : (
              <button type="button" className="btn btn-dark" disabled={working} onClick={() => (step === 'verify-failed' ? setConfirm('commit') : void run(L.commit, () => api.conflictCommit(action.id)))}>
                {step === 'verify-failed' ? t('ui.resolver.commit.anyway') : t('ui.resolver.commit.merge')}
              </button>
            )}
            <button type="button" className="btn" disabled={working} onClick={() => void run(L.reopen, () => api.conflictReopen(action.id))}>{t('ui.resolver.reopen')}</button>
          </div>
        </div>
      )}

      {r && step === 'push-waiting' && (
        <div className="cr-file">
          <h3 className="section-title">{t('ui.resolver.publish.title')}</h3>
          <p className="cr-note">
            {tNodes(
              'ui.resolver.publish.intro',
              { commit: <span className="mono">{r.commit?.slice(0, 9)}</span>, push: <span className="mono">git push origin HEAD:refs/heads/{r.branch}</span> }, // i18n-ignore: shell command
              { branch: r.branch, target: r.target },
            )}
          </p>
          {push?.state === 'failed' && <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{t('ui.resolver.publish.failed', { output: push.output ?? '' })}</div>}
          <div className="row">
            {confirm === 'push' ? (
              <button type="button" className="btn btn-red" disabled={working || !pushId} onClick={() => void run(L.push, () => api.approveAction(pushId as string))}>
                {busy === L.push ? <span className="spinner" /> : null} {t('ui.resolver.publish.confirm', { branch: r.branch })}
              </button>
            ) : (
              <button type="button" className="btn btn-dark" disabled={working || !pushId} onClick={() => setConfirm('push')}>{t('ui.resolver.publish.go')}</button>
            )}
            {confirm === 'push' && <button type="button" className="btn" onClick={() => setConfirm(null)}>{t('ui.resolver.cancel')}</button>}
          </div>
        </div>
      )}

      {r && step === 'published' && (
        <p className="cr-note">{t('ui.resolver.published', { branch: r.branch })}</p>
      )}

      {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
      {busy && <AgentActivity jobId={`resolve:${action.id}`} since={busySince} />}
      {!busy && r?.busy && <div className="row faint"><span className="spinner" /> {r.busy}</div>}
      {error && <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {r && step !== 'published' && (
        <div className="row">
          {confirm === 'discard' ? (
            <button type="button" className="btn btn-red" disabled={working} onClick={() => void run(L.discard, () => api.conflictDiscard(action.id))}>{t('ui.resolver.discard.confirm')}</button>
          ) : (
            <button type="button" className="btn" disabled={working} onClick={() => setConfirm('discard')}>{t('ui.resolver.discard.button')}</button>
          )}
          {confirm === 'discard' && <button type="button" className="btn" onClick={() => setConfirm(null)}>{t('ui.resolver.cancel')}</button>}
        </div>
      )}
    </section>
  );
}
