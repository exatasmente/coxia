import { useState } from 'react';
import type { VcsIntegration, VcsKind } from '../../../../shared/config/types';
import { VCS_KINDS } from '../../../../shared/config/types';
import type { VcsProbeResult } from '../../../../shared/vcs';
import { type SecretDraft, type VcsTestResult, emptySecretDraft, secretInputFrom, vcsSecretRef } from '../../../../shared/wizard';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { ExternalLink, Field, Notice, SecretFields, secretProblemKey } from '../ui';
import { wizardApi } from '../wizardApi';
import { newIntegration } from './ProjectsStep';

const DEFAULT_HOST: Record<VcsKind, string> = { gitlab: '', github: 'github.com', bitbucket: 'bitbucket.org' };

/** Where the user creates a token for this host. */
export function tokenUrl(v: Pick<VcsIntegration, 'kind' | 'host'>): string {
  const host = v.host.trim();
  if (v.kind === 'github') return host && host !== 'github.com' ? `https://${host}/settings/tokens` : 'https://github.com/settings/personal-access-tokens/new';
  if (v.kind === 'bitbucket') return 'https://id.atlassian.com/manage-profile/security/api-tokens';
  return `https://${host || 'gitlab.com'}/-/user_settings/personal_access_tokens`;
}

function testMessageKey(r: VcsTestResult): string {
  if (r.ok) return 'wizard.vcs.test.ok';
  const m = r.message;
  if (m === 'no-token') return 'wizard.vcs.test.noToken';
  if (m === 'timeout') return 'wizard.vcs.test.timeout';
  const http = /^http-(\d+)$/.exec(m)?.[1];
  if (http === '401') return 'wizard.vcs.test.401';
  if (http === '403') return 'wizard.vcs.test.403';
  if (http === '404') return 'wizard.vcs.test.404';
  return '';
}

/** What the probe found beyond "connected": the checks, the permissions warnings and a few of my issues and merge requests. */
function ProbeDetails({ probe }: { probe: VcsProbeResult }) {
  const t = useT();
  const samples = [
    { id: 'issues', title: t('vcs.probe.sampleIssues'), list: probe.issues?.sample ?? [] },
    { id: 'mrs', title: t('vcs.probe.sampleMrs'), list: probe.mrs?.sample ?? [] },
  ];
  return (
    <div className="wz-stack small" data-testid="vcs-probe-details">
      <ul>
        {probe.checks.filter((c) => c.id !== 'auth').map((c) => <li key={c.id} style={{ color: c.ok ? undefined : 'var(--red)' }}>{c.ok ? '✓' : '✗'} {c.detail}</li>)}
        {probe.warnings.map((w) => <li key={w} className="muted">{w}</li>)}
      </ul>
      {samples.filter((s) => s.list.length > 0).map((s) => (
        <div key={s.id}>
          <div className="wz-label">{s.title}</div>
          <ul>{s.list.map((x) => <li key={x.ref}><span className="mono">{x.ref}</span> {x.title}{x.status ? <span className="muted"> · {x.status}</span> : null}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

export function IntegrationsStep({ cfg, setCfg, view, refreshView }: StepProps) {
  const t = useT();
  const [tests, setTests] = useState<Record<string, VcsTestResult | 'running'>>({});
  const [drafts, setDrafts] = useState<Record<string, SecretDraft>>({});
  const [addKind, setAddKind] = useState<VcsKind>('gitlab');
  const [addHost, setAddHost] = useState('');
  const [error, setError] = useState<string | null>(null);

  const acceptInsecure = () => void wizardApi.acceptInsecure().then(refreshView, (e) => setError(errorText(e)));
  const patch = (id: string, change: Partial<VcsIntegration>) => setCfg((c) => ({ ...c, vcs: c.vcs.map((v) => (v.id === id ? { ...v, ...change } : v)) }));
  const tokenOf = (v: VcsIntegration) => (v.secretRef ? view.secrets.find((s) => s.ref === v.secretRef) : undefined);

  const add = () => {
    setError(null);
    const host = (addHost.trim() || DEFAULT_HOST[addKind]).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) {
      setError(t('wizard.problem.vcsHost'));
      return;
    }
    setCfg((c) => ({ ...c, vcs: [...c.vcs, newIntegration(addKind, host, c.vcs.map((v) => v.id))] }));
    setAddHost('');
  };

  const remove = (v: VcsIntegration) => {
    setCfg((c) => ({
      ...c,
      vcs: c.vcs.filter((x) => x.id !== v.id),
      projects: { ...c.projects, repos: c.projects.repos.map((r) => (r.vcsId === v.id ? { ...r, vcsId: null } : r)), issues: c.projects.issues.vcsId === v.id ? { ...c.projects.issues, vcsId: null } : c.projects.issues },
    }));
    if (v.secretRef === vcsSecretRef(v.id)) void wizardApi.secretRemove(v.secretRef).then(refreshView, () => undefined);
  };

  const saveToken = async (v: VcsIntegration): Promise<boolean> => {
    const draft = drafts[v.id] ?? emptySecretDraft();
    const ref = vcsSecretRef(v.id);
    const r = secretInputFrom(ref, draft);
    if ('problem' in r) {
      if (r.problem !== 'empty') setError(t(secretProblemKey(r.problem)));
      return false;
    }
    await wizardApi.secretSet(r.input);
    patch(v.id, { secretRef: ref });
    setDrafts((all) => ({ ...all, [v.id]: emptySecretDraft() }));
    await refreshView();
    return true;
  };

  const test = async (v: VcsIntegration) => {
    setError(null);
    setTests((all) => ({ ...all, [v.id]: 'running' }));
    try {
      // a token typed but not yet stored is stored first, and the config is saved so the main process sees the integration
      const draft = drafts[v.id];
      let config = cfg;
      if (draft && (draft.value || draft.envName || draft.command)) {
        if (await saveToken(v)) config = { ...cfg, vcs: cfg.vcs.map((x) => (x.id === v.id ? { ...x, secretRef: vcsSecretRef(v.id) } : x)) };
      }
      await wizardApi.save(config);
      const result = await wizardApi.testVcs(v.id);
      setTests((all) => ({ ...all, [v.id]: result }));
    } catch (e) {
      setTests((all) => ({ ...all, [v.id]: { ok: false, user: null, source: 'fallback', status: null, message: errorText(e) } }));
    }
  };

  const issues = cfg.projects.issues;

  return (
    <div className="wz-stack">
      <Notice tone="info">{t('wizard.vcs.intro')}</Notice>
      {error && <div className="error" role="alert">{error}</div>}

      {cfg.vcs.length === 0 && <p className="muted">{t('wizard.vcs.none')}</p>}
      <ul className="wz-cards">
        {cfg.vcs.map((v) => {
          const token = tokenOf(v);
          const state = tests[v.id];
          const key = state && state !== 'running' ? testMessageKey(state) : '';
          return (
            <li key={v.id} className="wz-card-item wz-stack">
              <div className="wz-card-head">
                <div className="wz-card-title">{t(`wizard.vcs.${v.kind}`)} <span className="small muted mono">{v.id}</span></div>
                <button type="button" className="btn" onClick={() => remove(v)}>{t('wizard.models.remove')}</button>
              </div>
              <div className="wz-two">
                <Field label={t('wizard.vcs.host')} htmlFor={`vh-${v.id}`} hint={v.kind === 'github' ? t('wizard.vcs.hostGithub') : undefined}>
                  <input id={`vh-${v.id}`} className="text-input mono" spellCheck={false} value={v.host} onChange={(e) => patch(v.id, { host: e.target.value.trim().replace(/^https?:\/\//, '') })} />
                </Field>
                <Field label={t('wizard.vcs.user')} htmlFor={`vu-${v.id}`} hint={v.kind === 'bitbucket' ? t('wizard.vcs.userBitbucket') : t('wizard.vcs.userHint')}>
                  <input id={`vu-${v.id}`} className="text-input" autoComplete="off" value={v.user} onChange={(e) => patch(v.id, { user: e.target.value })} />
                </Field>
              </div>

              <Field label={t('wizard.vcs.apiUrl')} htmlFor={`va-${v.id}`} hint={t('wizard.vcs.apiUrlHint')}>
                <input id={`va-${v.id}`} className="text-input mono" spellCheck={false} inputMode="url" placeholder={v.kind === 'gitlab' ? `https://${v.host || 'gitlab.example.com'}/api/v4` : ''} value={v.apiUrl} onChange={(e) => patch(v.id, { apiUrl: e.target.value.trim() })} />
              </Field>

              <div className="wz-stack">
                <div className="wz-label">{t('wizard.vcs.token')}</div>
                {token?.available && <p className="small" style={{ color: 'var(--teal-ink)' }}>✓ {t('wizard.models.keyOk', { source: t(`wizard.secret.source.${token.source}`) })}</p>}
                <SecretFields noun={t('wizard.noun.token')} draft={drafts[v.id] ?? emptySecretDraft()} onChange={(d) => setDrafts((all) => ({ ...all, [v.id]: d }))} storage={view.storage} onAcceptInsecure={acceptInsecure} envHint={v.kind === 'github' ? 'GITHUB_TOKEN' : v.kind === 'gitlab' ? 'GITLAB_TOKEN' : 'BITBUCKET_TOKEN'} />
                <p className="small"><ExternalLink href={tokenUrl(v)}>{t('wizard.vcs.createToken')}</ExternalLink></p>
              </div>

              <details className="wz-details" open={!token?.available}>
                <summary>{t('wizard.vcs.scopes')}</summary>
                <p className="small">{t(`wizard.vcs.scopes.${v.kind}`)}</p>
                <p className="small muted">{t('wizard.vcs.scopesNote')}</p>
              </details>

              <div className="wz-actions">
                <button type="button" className="btn" onClick={() => void saveToken(v).catch((e) => setError(errorText(e)))}>{t('wizard.secret.save')}</button>
                <button type="button" className="btn" disabled={state === 'running'} onClick={() => void test(v)}>{state === 'running' ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.vcs.test')}</button>
                {typeof state === 'object' && (
                  <span role="status" className="small" style={{ color: state.ok ? 'var(--teal-ink)' : 'var(--red)' }}>
                    {key ? t(key, { user: state.user ?? '' }) : state.message}
                  </span>
                )}
              </div>
              {typeof state === 'object' && state.source === 'fallback' && <p className="small muted">{t('wizard.vcs.fallbackNote')}</p>}
              {typeof state === 'object' && state.probe && <ProbeDetails probe={state.probe} />}
            </li>
          );
        })}
      </ul>

      <form className="wz-card-item wz-stack" onSubmit={(e) => { e.preventDefault(); add(); }} aria-label={t('wizard.vcs.add')}>
        <h3 className="wz-sub">{t('wizard.vcs.add')}</h3>
        <div className="wz-two">
          <Field label={t('wizard.vcs.kind')} htmlFor="wz-vcs-kind">
            <select id="wz-vcs-kind" className="text-input" value={addKind} onChange={(e) => setAddKind(e.target.value as VcsKind)}>
              {VCS_KINDS.map((k) => <option key={k} value={k}>{t(`wizard.vcs.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('wizard.vcs.host')} htmlFor="wz-vcs-host">
            <input id="wz-vcs-host" className="text-input mono" spellCheck={false} placeholder={DEFAULT_HOST[addKind] || 'gitlab.example.com'} value={addHost} onChange={(e) => setAddHost(e.target.value)} />
          </Field>
        </div>
        <div className="wz-actions"><button type="submit" className="btn">{t('wizard.vcs.addSubmit')}</button></div>
      </form>

      {cfg.vcs.length > 0 && (
        <section className="wz-stack" aria-labelledby="wz-issues">
          <h3 id="wz-issues" className="wz-sub">{t('wizard.vcs.issues')}</h3>
          <p className="small muted">{t('wizard.vcs.issuesHint')}</p>
          <div className="wz-two">
            <Field label={t('wizard.vcs.issuesIntegration')} htmlFor="wz-issues-vcs">
              <select id="wz-issues-vcs" className="text-input" value={issues.vcsId ?? ''} onChange={(e) => setCfg((c) => ({ ...c, projects: { ...c.projects, issues: { ...c.projects.issues, vcsId: e.target.value || null } } }))}>
                <option value="">{t('wizard.vcs.issuesNone')}</option>
                {cfg.vcs.map((v) => <option key={v.id} value={v.id}>{v.id} ({v.host})</option>)}
              </select>
            </Field>
            <Field label={t('wizard.vcs.issuesProject')} htmlFor="wz-issues-project" hint={t('wizard.vcs.issuesProjectHint')}>
              <input id="wz-issues-project" className="text-input mono" spellCheck={false} placeholder="group/project" disabled={!issues.vcsId} value={issues.project ?? ''} onChange={(e) => setCfg((c) => ({ ...c, projects: { ...c.projects, issues: { ...c.projects.issues, project: e.target.value.trim() || null } } }))} />
            </Field>
          </div>
          <Field label={t('wizard.vcs.issuesPrefix')} htmlFor="wz-issues-prefix" hint={t('wizard.vcs.issuesPrefixHint')}>
            <input id="wz-issues-prefix" className="text-input mono" style={{ maxWidth: 200 }} spellCheck={false} disabled={!issues.vcsId} value={issues.refPrefix} onChange={(e) => setCfg((c) => ({ ...c, projects: { ...c.projects, issues: { ...c.projects.issues, refPrefix: e.target.value.trim() } } }))} />
          </Field>
        </section>
      )}
    </div>
  );
}
