import { useState } from 'react';
import { conflictProgress } from '../../../shared/conflict';
import { releaseBlockers } from '../../../shared/release';
import { stageText } from '../../../shared/cycles/stages';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { t, tv, useT } from '../i18n';
import { busyText, jobs, useJobs } from '../useJobs';
import { RunProposal, isRunProposal } from './cycle/RunProposal';
import { SuggestionCard, isSuggestion } from './SuggestionCard';
import { BackIcon } from './icons';

const STATE_LABEL: Record<ReleaseAction['state'], string> = {
  pending: 'ui.actions.state.pending',
  running: 'ui.actions.state.running',
  done: 'ui.actions.state.done',
  skipped: 'ui.actions.state.skipped',
  failed: 'ui.actions.state.failed',
};

function title(a: ReleaseAction): string {
  if (a.kind === 'gitlab' || a.kind === 'vcs' || a.kind === 'release-git') return a.summary ?? t('vcs.action.title');
  if (a.kind === 'sync') return t('ui.actions.title.sync', { issue: a.issue });
  if (a.kind === 'qa-comment') return t('ui.actions.title.qaComment', { issue: a.issue });
  if (a.kind === 'conflict-push') return a.summary ?? t('ui.actions.title.conflictPush', { issue: a.issue });
  if (a.kind === 'run-push') return a.summary ?? t('vcs.action.title');
  if (a.kind === 'suggest-agent') return a.summary ?? t('ui.actions.title.suggestAgent');
  return t('ui.actions.title.conflict', { issue: a.issue });
}

function what(a: ReleaseAction): string {
  if (a.kind === 'gitlab' || a.kind === 'vcs') return t('vcs.action.what');
  if (a.kind === 'sync') return t(a.retest ? 'ui.actions.what.sync.retest' : 'ui.actions.what.sync.noRetest', { branches: a.mrs.map((m) => m.branch).join(', ') });
  if (a.kind === 'qa-comment') return a.noteId ? t('ui.actions.what.qaComment.edit', { noteId: a.noteId }) : t('ui.actions.what.qaComment.post');
  if (a.kind === 'conflict-push') return t('ui.actions.what.conflictPush');
  if (a.kind === 'run-push') return t('ui.actions.what.runPush');
  if (a.kind === 'release-git') return t('ui.actions.what.releaseGit');
  if (a.kind === 'suggest-agent') return t('ui.actions.what.suggestAgent');
  return tv('call.explainsConflict');
}

/** `waitsFor`: the steps of the same stage this release step needs first (a push before its cut): until they are done it cannot be approved. */
function ActionCard({ a, go, waitsFor = [] }: { a: ReleaseAction; go: (s: Screen) => void; waitsFor?: ReleaseAction[] }) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const open = a.state === 'pending' || a.state === 'failed';

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  // The release action itself is told to the app by main (actions event); the jobs keep the busy state and the preview text.
  const running = useJobs<string>(`action:${a.id}:`, {
    done: (text, job) => {
      if (job.key.endsWith(':preview')) setPreview(text);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running, localBusy);
  const previewing = running[0]?.key.endsWith(':preview') ?? false;
  const executing = running[0]?.key.endsWith(':approve') ?? false;
  const start = (op: 'preview' | 'approve', label: string, fn: () => Promise<string | unknown>) => {
    setError(null);
    jobs.launch(`action:${a.id}:${op}`, { label: `${label}: ${title(a)}`, busy: op === 'preview' ? t('ui.actions.busy.preview') : t('ui.actions.busy.run'), screen: { name: 'actions' } }, async () => {
      const r = await fn();
      return typeof r === 'string' ? r : '';
    });
  };

  return (
    <section className="panel" style={{ padding: 20, gap: 12, borderColor: a.kind === 'conflict' && open ? 'var(--amber-line)' : undefined }}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title(a)}</h2>
            {a.release && <span className="badge badge-quiet">{t('ui.actions.badge.release', { release: a.release })}</span>}
            <span className={`badge ${a.state === 'done' && a.nothingSent ? 'badge-ask' : a.state === 'done' ? 'badge-now' : a.state === 'failed' ? 'badge-block' : a.state === 'pending' ? 'badge-ask' : 'badge-quiet'}`}>
              {a.kind === 'conflict' && a.state === 'skipped' ? t('ui.actions.badge.handledElsewhere') : a.state === 'done' && a.nothingSent ? t('ui.actions.badge.nothingSent') : t(STATE_LABEL[a.state])}
            </span>
            {a.kind === 'conflict' && open && a.resolve && <span className="badge badge-ask">{conflictProgress(a)}</span>}
            {a.kind === 'conflict' && a.state === 'done' && a.resolve?.publishedAt && <span className="badge badge-quiet">{t('ui.actions.badge.published')}</span>}
          </div>
          {(a.issueTitle || a.stage) && <div className="small muted" style={{ marginTop: 4 }}>{a.issueTitle} · {stageText(a.stage)}</div>}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        {a.mrs.map((m) => (
          <a key={m.ref} className="badge badge-quiet mono" href={m.url} target="_blank" rel="noreferrer">
            {t('ui.actions.mr.behind', { ref: m.ref, behind: m.behind })}
          </a>
        ))}
      </div>
      <p className="small" style={{ lineHeight: 1.5 }}>{what(a)}</p>
      <RunProposal a={a} go={go} />

      {a.files.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            {t(a.kind === 'conflict' ? 'ui.actions.files.conflict' : a.kind === 'conflict-push' ? 'ui.actions.files.resolved' : 'ui.actions.files.release', { count: a.files.length })}
          </summary>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{a.files.join('\n')}</pre>
        </details>
      )}

      {a.kind === 'qa-comment' && a.currentBody && a.proposedBody && (
        <div
          className="quad"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }} // i18n-ignore: CSS grid
        >
          <div style={{ background: 'var(--surface-2)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>{t('ui.actions.diff.current')}</div>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--mono)' }}>{a.currentBody}</pre>
          </div>
          <div style={{ background: 'var(--teal-soft)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>{t('ui.actions.diff.proposed')}</div>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--mono)' }}>{a.proposedBody}</pre>
          </div>
        </div>
      )}
      {a.output && !isRunProposal(a) && <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 220, overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{a.output}</pre>}
      {isSuggestion(a) && <SuggestionCard a={a} go={go} />}
      {preview && <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 320, overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{preview}</pre>}
      {error && <div className="error">{error}</div>}
      {open && waitsFor.length > 0 && <p className="small muted">{t('ui.actions.waitsFor', { steps: waitsFor.map((b) => title(b)).join('; ') })}</p>}

      {open && !isSuggestion(a) && (
        <div className="row">
          {a.kind === 'conflict' ? (
            <button type="button" className="btn btn-amber" onClick={() => go({ name: 'conflict', id: a.id })}>{a.resolve ? t('ui.actions.resolution.continue') : tv('call.openAndResolve')}</button>
          ) : (
            <>
              {!(a.kind === 'qa-comment' && a.proposedBody) && (
                <button type="button" className="btn" disabled={!!busy} onClick={() => start('preview', t('ui.actions.job.preview'), () => api.previewAction(a.id))}>
                  {previewing ? <span className="spinner" /> : null} {t(a.kind === 'sync' ? 'ui.actions.view.preview' : a.kind === 'gitlab' || a.kind === 'vcs' || a.kind === 'conflict-push' || a.kind === 'run-push' || a.kind === 'release-git' ? 'ui.actions.view.push' : 'ui.actions.view.comment')}
                </button>
              )}
              {confirming ? (
                <button type="button" className="btn btn-red" disabled={!!busy} onClick={() => { setConfirming(false); start('approve', t('ui.actions.job.run'), () => api.approveAction(a.id)); }}>
                  {executing ? <span className="spinner" /> : null}{' '}
                  {a.kind === 'sync'
                    ? t('ui.actions.confirm.sync')
                    : a.kind === 'conflict-push'
                      ? t('ui.actions.confirm.conflictPush')
                      : a.kind === 'run-push'
                        ? t('ui.actions.confirm.runPush')
                        : a.kind === 'release-git'
                          ? t('ui.actions.confirm.releaseGit')
                          : a.kind === 'gitlab' || a.kind === 'vcs'
                            ? t('ui.actions.confirm.vcs', { action: t('vcs.action.confirm') })
                            : t('ui.actions.confirm.post')}
                </button>
              ) : (
                <button type="button" className="btn btn-dark" disabled={!!busy || waitsFor.length > 0} onClick={() => setConfirming(true)}>{t('ui.actions.go')}</button>
              )}
            </>
          )}
          {confirming ? (
            <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirming(false)}>{t('ui.actions.cancel')}</button>
          ) : (
            a.kind === 'conflict-push' ? (
              <button type="button" className="btn" onClick={() => go({ name: 'conflict', id: String((a.unit ?? {}).conflictId ?? '') })}>{t('ui.actions.openConflict')}</button>
            ) : (
              <button type="button" className="btn" disabled={!!busy} onClick={() => void run('', () => api.skipAction(a.id))}>{a.kind === 'conflict' ? t('ui.actions.handledOutside') : t('ui.actions.notNow')}</button>
            )
          )}
        </div>
      )}
      {a.state === 'running' && <div className="row faint"><span className="spinner" /> {t('ui.actions.busy.run')}</div>}
    </section>
  );
}

export function Actions({ actions, go }: { actions: ReleaseAction[]; go: (s: Screen) => void }) {
  const t = useT();
  const [checking, setChecking] = useState<string | null>(null);
  const pending = actions.filter((a) => a.state === 'pending' || a.state === 'running' || a.state === 'failed');
  const past = actions.filter((a) => !pending.includes(a));

  const running = useJobs<string>('release:', {
    done: (text) => setChecking(text),
    failed: (message) => setChecking(t('ui.actions.failed', { message })),
  });
  const detecting = running.length > 0;

  const detect = () => jobs.launch('release:detect', { label: t('ui.actions.job.detectLabel'), busy: t('ui.actions.job.detectBusy'), screen: { name: 'actions' } }, () => api.detectRelease());

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1100, gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.actions.backToday')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.actions.title')}</h1>
          </div>
          <div className="row">
            {detecting ? <span className="small muted">{t('ui.actions.job.detectBusy')}</span> : checking && <span className="small muted">{checking}</span>}
            <button type="button" className="btn" disabled={detecting} onClick={() => detect()}>{t('ui.actions.detect')}</button>
          </div>
        </header>
        <p className="small muted">
          {t('ui.actions.intro')}
        </p>
        <h2 className="section-title">{t('ui.actions.waiting', { count: pending.length })}</h2>
        {!pending.length && <p className="small faint">{t('ui.actions.none')}</p>}
        {pending.map((a) => <ActionCard key={a.id} a={a} go={go} waitsFor={releaseBlockers(a, actions)} />)}
        {past.length > 0 && <h2 className="section-title" style={{ marginTop: 12 }}>{t('ui.actions.history', { count: past.length })}</h2>}
        {past.map((a) => <ActionCard key={a.id} a={a} go={go} />)}
      </div>
    </div>
  );
}
