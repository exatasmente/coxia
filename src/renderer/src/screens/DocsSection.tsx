import { useCallback, useEffect, useState } from 'react';
import type { DocsConfig } from '../../../shared/config/types';
import { type DocsRepoStatus, type DocsStatus, isClaudeSource } from '../../../shared/harness/status';
import { docsListsOf, withDocsSources, withRoadmapFile } from '../../../shared/harness/sources';
import type { DocsKey } from '../../../shared/wizard';
import type { Screen } from '../App';
import { errorText } from '../api';
import { docsApi } from '../docsApi';
import { useT } from '../i18n';
import { isWeb } from '../platform';
import { DocsSourceLists } from '../wizard/DocsSourceLists';
import { wizardApi } from '../wizard/wizardApi';

type Mode = 'create' | 'update';

// Settings › Documentation, desktop only: root AGENTS.md status, the documentation run, and extra sources.
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
  // The roadmap pointer is saved on its own: `null` until the configuration is read, then the text typed (blank = none).
  const [roadmap, setRoadmap] = useState<string | null>(null);
  const [roadmapStored, setRoadmapStored] = useState('');
  const [roadmapSaved, setRoadmapSaved] = useState(false);

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
    void wizardApi.config().then((view) => {
      setLists(docsListsOf(view.config));
      setRoadmap(view.config.docs.roadmapFile ?? '');
      setRoadmapStored(view.config.docs.roadmapFile ?? '');
    }, (e) => setError(errorText(e)));
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

  const saveRoadmap = async () => {
    if (roadmap === null) return;
    setError(null);
    try {
      // Same reason as `save`: the configuration as it is now, since saving replaces the whole of it.
      const current = (await wizardApi.config()).config;
      await wizardApi.save(withRoadmapFile(current, roadmap));
      setRoadmapStored(roadmap.trim());
      setRoadmap(roadmap.trim());
      setRoadmapSaved(true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const repoBlock = (r: DocsRepoStatus) => (
    <li key={r.repo} className="panel" style={{ padding: 14, gap: 10 }}>
      <div className="row spread">
        <strong className="mono">{r.repo}</strong>
        {r.head ? <span className="small muted">{t('ui.settings.docs.head', { commit: r.head.commit, date: r.head.date })}</span> : <span className="small muted">{t('ui.settings.docs.head.none')}</span>}
      </div>
      {!r.ready ? (
        <>
        <p className="small muted">{t('ui.settings.docs.none')}</p>
          {r.exists && <p className="small muted">{t('ui.settings.docs.blocked')}</p>}
          {r.ignored.length > 0 && <p className="small muted wz-wrap-anywhere">{t('ui.settings.docs.ignored', { names: r.ignored.slice(0, 10).join(', ') })}</p>}
        </>
      ) : (
        <p className="small">
          <span className="badge badge-quiet">{t('ui.settings.docs.present')}</span>
        </p>
      )}
      {r.claude && <p className="small muted">{t('ui.settings.docs.claude')}</p>}
      {r.run ? (
        <div className="row" style={{ gap: 10 }}>
          <span className="small">{t('ui.settings.docs.run.going')}</span>
          <button type="button" className="btn" onClick={() => go({ name: 'run', id: (r.run as { id: string }).id })}>{t('ui.settings.docs.run.open')}</button>
        </div>
      ) : (
        (!r.exists || r.ready) && (
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

      {roadmap !== null && (
        <div className="panel" style={{ padding: 14, gap: 10 }}>
          <div>
            <h3 className="wz-sub">{t('ui.settings.docs.roadmap.title')}</h3>
            <p className="small muted">{t('ui.settings.docs.roadmap.hint')}</p>
          </div>
          <input
            className="text-input mono"
            spellCheck={false}
            maxLength={4000}
            aria-label={t('ui.settings.docs.roadmap.title')}
            placeholder={t('ui.settings.docs.roadmap.placeholder')}
            value={roadmap}
            onChange={(e) => { setRoadmap(e.target.value); setRoadmapSaved(false); }}
          />
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-dark" disabled={roadmap.trim() === roadmapStored} onClick={() => void saveRoadmap()}>{t('ui.settings.docs.roadmap.save')}</button>
            {roadmapSaved && <span className="small" style={{ color: 'var(--teal-ink)' }}>{t('ui.settings.docs.sources.saved')}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
