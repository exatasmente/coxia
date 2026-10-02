import { useEffect, useRef, useState } from 'react';
import type { RepoConfig, VcsIntegration, VcsKind, WorkspaceConfig } from '../../../../shared/config/types';
import type { ScannedRepo } from '../../../../shared/wizard';
import { uniqueId } from '../../../../shared/wizard';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { Field, Notice } from '../ui';
import { wizardApi } from '../wizardApi';

const REPO_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

const hostSlug = (host: string): string => host.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

export function newIntegration(kind: VcsKind, host: string, taken: string[]): VcsIntegration {
  return { id: uniqueId(hostSlug(host) || kind, taken), kind, host, apiUrl: '', user: '', secretRef: null, cliPreference: 'auto', cliCommand: null };
}

interface Row extends ScannedRepo {
  included: boolean;
}

export function ProjectsStep({ cfg, setCfg }: StepProps) {
  const t = useT();
  const [found, setFound] = useState<ScannedRepo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  const rescan = async (roots: string[]) => {
    if (!roots.length) {
      setFound([]);
      return;
    }
    setScanning(true);
    try {
      setFound(await wizardApi.scanProjects(roots));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      void rescan(cfg.projects.roots);
    }
  }, []);

  const addRoot = (path: string) => {
    const p = path.trim();
    if (!p || cfg.projects.roots.includes(p)) return;
    setCfg((c) => ({ ...c, projects: { ...c.projects, roots: [...c.projects.roots, p] } }));
    void rescan([...cfg.projects.roots, p]);
  };

  const removeRoot = (path: string) => {
    const roots = cfg.projects.roots.filter((r) => r !== path);
    setCfg((c) => ({ ...c, projects: { ...c.projects, roots } }));
    void rescan(roots);
  };

  const pick = async () => {
    setError(null);
    try {
      const picked = await wizardApi.pickPath('dir', t('wizard.projects.pickTitle'));
      if (!picked) return;
      if (picked.isRepo) {
        const [repo] = await wizardApi.scanProjects([picked.path]);
        if (repo) {
          setFound((all) => (all.some((r) => r.path === repo.path) ? all : [...all, repo]));
          include(repo);
        }
      } else addRoot(picked.path);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const addTyped = async () => {
    setError(null);
    const p = typed.trim();
    if (!p) return;
    try {
      const [exists] = await wizardApi.pathsExist([p]);
      if (!exists) {
        setError(t('wizard.projects.missing', { path: p }));
        return;
      }
      addRoot(p);
      setTyped('');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const vcsFor = (c: WorkspaceConfig, host: string | null): string | null => (host ? (c.vcs.find((v) => v.host.toLowerCase() === host)?.id ?? null) : null);

  const include = (r: ScannedRepo) =>
    setCfg((c) => {
      if (c.projects.repos.some((x) => x.path === r.path)) return c;
      const id = uniqueId(r.id, c.projects.repos.map((x) => x.id));
      const repo: RepoConfig = { id, path: r.path, remoteUrl: r.remoteUrl, vcsId: vcsFor(c, r.host), projectPath: r.projectPath };
      return { ...c, projects: { ...c.projects, repos: [...c.projects.repos, repo] } };
    });

  const exclude = (path: string) => setCfg((c) => ({ ...c, projects: { ...c.projects, repos: c.projects.repos.filter((x) => x.path !== path) } }));

  const patchRepo = (path: string, patch: Partial<RepoConfig>) =>
    setCfg((c) => ({ ...c, projects: { ...c.projects, repos: c.projects.repos.map((x) => (x.path === path ? { ...x, ...patch } : x)) } }));

  const rows: Row[] = [
    ...found.map((r) => {
      const own = cfg.projects.repos.find((x) => x.path === r.path);
      return { ...r, id: own?.id ?? r.id, included: !!own };
    }),
    ...cfg.projects.repos
      .filter((x) => !found.some((r) => r.path === x.path))
      .map((x) => ({ id: x.id, path: x.path, remoteUrl: x.remoteUrl, host: null, projectPath: x.projectPath, kind: null, included: true })),
  ];
  const hostOf = (r: Row): string | null => r.host ?? (cfg.vcs.find((v) => v.id === cfg.projects.repos.find((x) => x.path === r.path)?.vcsId)?.host ?? null);

  // Included repos whose host has no integration yet: one button per host creates it and maps them.
  const unmapped = new Map<string, { kind: VcsKind; count: number }>();
  for (const r of rows) {
    const own = cfg.projects.repos.find((x) => x.path === r.path);
    if (r.included && own && !own.vcsId && r.host && r.kind) unmapped.set(r.host, { kind: r.kind, count: (unmapped.get(r.host)?.count ?? 0) + 1 });
  }

  const createIntegration = (host: string, kind: VcsKind) =>
    setCfg((c) => {
      const integration = newIntegration(kind, host, c.vcs.map((v) => v.id));
      const repos = c.projects.repos.map((x) => {
        const row = rows.find((r) => r.path === x.path);
        return !x.vcsId && row?.host === host ? { ...x, vcsId: integration.id } : x;
      });
      return { ...c, vcs: [...c.vcs, integration], projects: { ...c.projects, repos } };
    });

  const allIncluded = rows.length > 0 && rows.every((r) => r.included);

  return (
    <div className="wz-stack">
      <section className="wz-stack" aria-labelledby="wz-roots">
        <h3 id="wz-roots" className="wz-sub">{t('wizard.projects.roots')}</h3>
        <p className="small muted">{t('wizard.projects.rootsHint')}</p>
        {cfg.projects.roots.length > 0 && (
          <ul className="wz-cards">
            {cfg.projects.roots.map((r, i) => (
              <li key={r} className="wz-card-item wz-row-between">
                <span className="mono wz-wrap-anywhere">{r}{i === 0 && <span className="badge badge-quiet" style={{ marginLeft: 8 }}>{t('wizard.projects.primary')}</span>}</span>
                <button type="button" className="btn" aria-label={t('wizard.projects.removeRoot', { path: r })} onClick={() => removeRoot(r)}>{t('wizard.models.remove')}</button>
              </li>
            ))}
          </ul>
        )}
        <div className="wz-actions">
          <button type="button" className="btn" onClick={() => void pick()}>{t('wizard.projects.pick')}</button>
        </div>
        <form className="wz-inline" onSubmit={(e) => { e.preventDefault(); void addTyped(); }}>
          <Field label={t('wizard.projects.typed')} htmlFor="wz-typed-root">
            <input id="wz-typed-root" className="text-input mono" placeholder="~/projects" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <button type="submit" className="btn" disabled={!typed.trim()}>{t('wizard.projects.add')}</button>
        </form>
        <label className="check-row">
          <input type="checkbox" checked={cfg.projects.autoDiscover} onChange={(e) => setCfg((c) => ({ ...c, projects: { ...c.projects, autoDiscover: e.target.checked } }))} />
          <span><span style={{ fontWeight: 600, display: 'block' }}>{t('wizard.projects.autoDiscover')}</span><span className="small muted">{t('wizard.projects.autoDiscoverHint')}</span></span>
        </label>
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      <section className="wz-stack" aria-labelledby="wz-repos">
        <div className="wz-roles-head">
          <h3 id="wz-repos" className="wz-sub">{t('wizard.projects.repos')}</h3>
          <div className="wz-actions">
            {cfg.projects.roots.length > 0 && <button type="button" className="btn" disabled={scanning} onClick={() => void rescan(cfg.projects.roots)}>{scanning ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.projects.rescan')}</button>}
            {rows.length > 1 && <button type="button" className="btn" onClick={() => rows.forEach((r) => (allIncluded ? exclude(r.path) : include(r)))}>{t(allIncluded ? 'wizard.projects.none' : 'wizard.projects.all')}</button>}
          </div>
        </div>
        {scanning && <p className="small muted" role="status">{t('wizard.projects.scanning')}</p>}
        {!scanning && rows.length === 0 && <p className="muted">{t(cfg.projects.roots.length ? 'wizard.projects.noneFound' : 'wizard.projects.empty')}</p>}
        <ul className="wz-cards">
          {rows.map((r) => {
            const own = cfg.projects.repos.find((x) => x.path === r.path);
            const idBad = !!own && !REPO_ID.test(own.id);
            return (
              <li key={r.path} className={`wz-card-item ${r.included ? 'wz-on' : ''}`}>
                <label className="wz-radio">
                  <input type="checkbox" checked={r.included} onChange={(e) => (e.target.checked ? include(r) : exclude(r.path))} />
                  <span className="mono wz-wrap-anywhere">{r.path}</span>
                </label>
                <div className="small muted wz-wrap-anywhere">{r.remoteUrl ? <span className="mono">{r.remoteUrl}</span> : t('wizard.projects.noRemote')}</div>
                {r.included && own && (
                  <div className="wz-two">
                    <Field label={t('wizard.projects.repoId')} htmlFor={`rid-${r.path}`} hint={idBad ? t('wizard.problem.repoId') : t('wizard.projects.repoIdHint')}>
                      <input id={`rid-${r.path}`} className="text-input mono" aria-invalid={idBad} value={own.id} onChange={(e) => patchRepo(r.path, { id: e.target.value.trim().toLowerCase() })} />
                    </Field>
                    <Field label={t('wizard.projects.integration')} htmlFor={`rv-${r.path}`}>
                      <select id={`rv-${r.path}`} className="text-input" value={own.vcsId ?? ''} onChange={(e) => patchRepo(r.path, { vcsId: e.target.value || null })}>
                        <option value="">{t('wizard.projects.noIntegration')}</option>
                        {cfg.vcs.map((v) => <option key={v.id} value={v.id}>{v.id} ({v.host})</option>)}
                      </select>
                    </Field>
                  </div>
                )}
                {r.included && hostOf(r) === null && r.remoteUrl && <p className="small muted">{t('wizard.projects.hostUnknown')}</p>}
              </li>
            );
          })}
        </ul>
        {[...unmapped.entries()].map(([host, info]) => (
          <Notice key={host} tone="info">
            <div>{t('wizard.projects.unmapped', { host, count: info.count })}</div>
            <div className="wz-actions"><button type="button" className="btn" onClick={() => createIntegration(host, info.kind)}>{t('wizard.projects.createIntegration', { host, kind: t(`wizard.vcs.${info.kind}`) })}</button></div>
          </Notice>
        ))}
      </section>
    </div>
  );
}
