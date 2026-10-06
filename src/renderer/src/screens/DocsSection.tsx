import { useCallback, useEffect, useState } from 'react';
import type { DocsConfig } from '../../../shared/config/types';
import { type DocsRepoStatus, type DocsStatus, type UncheckedFile, isClaudeSource } from '../../../shared/harness/status';
import { docsListsOf, withDocsSources } from '../../../shared/harness/sources';
import type { DocsKey } from '../../../shared/wizard';
import type { Screen } from '../App';
import { errorText } from '../api';
import { docsApi } from '../docsApi';
import { useT } from '../i18n';
import { isWeb } from '../platform';
import { DocsSourceLists } from '../wizard/DocsSourceLists';
import { wizardApi } from '../wizard/wizardApi';

// The tables hold catalog keys, written whole so the key checks find them; they are translated at render.
const UNVERIFIED: Record<string, string> = {
  git: 'ui.settings.docs.unverified.git',
  timeout: 'ui.settings.docs.unverified.timeout',
  'outside-history': 'ui.settings.docs.unverified.outside-history',
};
const INVALID: Record<string, string> = {
  'no-header': 'ui.settings.docs.invalid.no-header',
  'bad-commit': 'ui.settings.docs.invalid.bad-commit',
  'bad-date': 'ui.settings.docs.invalid.bad-date',
  'no-evidence': 'ui.settings.docs.invalid.no-evidence',
  'bad-evidence': 'ui.settings.docs.invalid.bad-evidence',
};

type Mode = 'create' | 'update';

// Settings › Documentation, desktop only: what each repository holds of the documentation of the app, what is not checked, the button that starts the run that
// drafts or updates it, and the extra sources the setup wizard edits too.
export function DocsSection({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const web = isWeb();
  const [status, setStatus] = useState<DocsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ repo: string; mode: Mode } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lists, setLists] = useState<Pick<DocsConfig, DocsKey> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const read = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await docsApi.status());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (web) return;
    void read();
    void wizardApi.config().then((view) => setLists(docsListsOf(view.config)), (e) => setError(errorText(e)));
  }, [web, read]);

  if (web) return null;

  const start = async (repo: string, mode: Mode, apply: boolean) => {
    setBusy(repo);
    setError(null);
    try {
      const run = await docsApi.start(repo, mode, apply);
      setAsking(null);
      go({ name: 'run', id: run.id });
    } catch (e) {
      setError(errorText(e));
      await read();
    } finally {
      setBusy(null);
    }
  };
  // The first click adds the agent and the flow to the workspace, so it asks first; once they are there, the click starts the run.
  const click = (repo: string, mode: Mode) => (status?.flow ? void start(repo, mode, false) : setAsking({ repo, mode }));

  const edit = (next: Pick<DocsConfig, DocsKey>) => {
    setLists(next);
    setDirty(true);
    setSaved(false);
  };
  const add = (k: DocsKey, path: string) => {
    const p = path.trim();
    if (p && lists && !lists[k].includes(p)) edit({ ...lists, [k]: [...lists[k], p] });
  };
  const remove = (k: DocsKey, path: string) => lists && edit({ ...lists, [k]: lists[k].filter((x) => x !== path) });
  const save = async () => {
    if (!lists) return;
    setError(null);
    try {
      // The configuration as it is now, not as it was when the screen opened: saving replaces the whole of it, and the team above (or a flow just applied) may have changed.
      const current = (await wizardApi.config()).config;
      await wizardApi.save(withDocsSources(current, lists));
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const reason = (f: UncheckedFile): string => {
    if (f.state === 'stale') return t('ui.settings.docs.stale', { count: f.total, commit: f.commit ?? '', date: f.date ?? '', names: f.changed.join(', ') });
    if (f.state === 'unverified') return t(UNVERIFIED[f.reason] ?? UNVERIFIED.git, { commit: f.commit ?? '', date: f.date ?? '' });
    return t(INVALID[f.reason] ?? INVALID['no-header']);
  };

  const repoBlock = (r: DocsRepoStatus) => (
    <li key={r.repo} className="panel" style={{ padding: 14, gap: 10 }}>
      <div className="row spread">
        <strong className="mono">{r.repo}</strong>
        {r.head ? <span className="small muted">{t('ui.settings.docs.head', { commit: r.head.commit, date: r.head.date })}</span> : <span className="small muted">{t('ui.settings.docs.head.none')}</span>}
      </div>
      {!r.exists ? (
        <p className="small muted">{t('ui.settings.docs.none')}</p>
      ) : (
        <>
          <p className="small">
            <span className={`badge ${r.overview ? 'badge-quiet' : 'badge-block'}`}>{t(r.overview ? 'ui.settings.docs.overview.yes' : 'ui.settings.docs.overview.no')}</span>{' '}
            {t('ui.settings.docs.counts', { rules: r.rules, skills: r.skills, roles: r.roles })}
          </p>
          {r.unchecked.length === 0 ? (
            <p className="small muted">{t('ui.settings.docs.allChecked')}</p>
          ) : (
            <div className="wz-stack">
              <div>
                <strong className="small">{t('ui.settings.docs.unchecked.title')}</strong>
                <p className="small muted">{t('ui.settings.docs.unchecked.hint')}</p>
              </div>
              <ul className="wz-cards">
                {r.unchecked.map((f) => (
                  <li key={f.path} className="wz-card-item">
                    <span className="mono small wz-wrap-anywhere">{`.coxia/${f.path}`}</span>
                    <span className="small muted">{reason(f)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.ignored.length > 0 && <p className="small muted wz-wrap-anywhere">{t('ui.settings.docs.ignored', { names: r.ignored.slice(0, 10).join(', ') })}</p>}
        </>
      )}
      {r.claude && <p className="small muted">{t('ui.settings.docs.claude')}</p>}
      {r.run ? (
        <div className="row" style={{ gap: 10 }}>
          <span className="small">{t('ui.settings.docs.run.going')}</span>
          <button type="button" className="btn" onClick={() => go({ name: 'run', id: (r.run as { id: string }).id })}>{t('ui.settings.docs.run.open')}</button>
        </div>
      ) : (
        (!r.exists || r.unchecked.length > 0) && (
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-dark" disabled={busy !== null} onClick={() => click(r.repo, r.exists ? 'update' : 'create')}>
              {busy === r.repo ? <span className="spinner" aria-hidden="true" /> : null} {t(r.exists ? 'ui.settings.docs.update' : 'ui.settings.docs.create')}
            </button>
          </div>
        )
      )}
      {asking?.repo === r.repo && (
        <div className="wz-stack" role="alertdialog" aria-label={t('ui.settings.docs.confirm.title')}>
          <strong className="small">{t('ui.settings.docs.confirm.title')}</strong>
          <p className="small muted">{t('ui.settings.docs.confirm.text')}</p>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-dark" disabled={busy !== null} onClick={() => void start(asking.repo, asking.mode, true)}>{t('ui.settings.docs.confirm.yes')}</button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => setAsking(null)}>{t('ui.settings.docs.confirm.no')}</button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <section id="docs" className="wz-stack" aria-labelledby="docs-title">
      <div className="row spread">
        <h2 id="docs-title" className="wz-section-title" style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.settings.docs.title')}</h2>
        <button type="button" className="btn" disabled={loading} onClick={() => void read()}>{loading ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.settings.docs.reread')}</button>
      </div>
      <p className="small muted">{t('ui.settings.docs.intro')}</p>
      <p className="small muted">{t('ui.settings.docs.checkout')}</p>
      {status && <p className="small muted">{t('ui.settings.docs.budget', { chars: status.budget })}</p>}
      {error && <div className="error" role="alert">{error}</div>}
      {status && status.repos.length === 0 && <p className="small muted">{t('ui.settings.docs.noRepos')}</p>}
      {status && status.repos.length > 0 && <ul className="wz-cards">{status.repos.map(repoBlock)}</ul>}
      <p className="small muted">{t('ui.settings.docs.note.above')}</p>

      {lists && (
        <div className="panel" style={{ padding: 14, gap: 10 }}>
          <div>
            <h3 className="wz-sub">{t('ui.settings.docs.sources.title')}</h3>
            <p className="small muted">{t('ui.settings.docs.sources.hint')}</p>
          </div>
          <DocsSourceLists docs={lists} onAdd={add} onRemove={remove} badge={(k, p) => (isClaudeSource(k, p) ? t('ui.settings.docs.sources.badge') : null)} onError={setError} />
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-dark" disabled={!dirty} onClick={() => void save()}>{t('ui.settings.docs.sources.save')}</button>
            {saved && <span className="small" style={{ color: 'var(--teal-ink)' }}>{t('ui.settings.docs.sources.saved')}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
