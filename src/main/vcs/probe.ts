import type { VcsKind } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import type { VcsProbeCheck, VcsProbeRequest, VcsProbeResult, VcsProbeSample, VcsProbeScopes } from '../../shared/vcs';
import { VcsError } from './errors';
import { type RuntimeDeps, type VcsRuntime, type VcsSettings, buildRuntime } from './runtime';
import type { VcsIssue, VcsMr } from './types';

// "Does this integration work?" for the setup wizard: the credential, who it is, what it may do, and a sample of my issues and merge
// requests, so the screen can say "connected as X, 3 issues, 2 MRs" or name what is missing. Reads only, a handful of calls.

const SAMPLE = 5;

/** What the app's reads need, and what its writes (always proposed first, then confirmed) need on top, per host. */
export const SCOPES: Record<VcsKind, { read: string[]; write: string[] }> = {
  gitlab: { read: ['read_api'], write: ['api'] },
  github: { read: ['repo'], write: [] },
  bitbucket: { read: ['account', 'repository', 'pullrequest', 'issue'], write: ['pullrequest:write', 'issue:write'] },
};

// A scope that covers another one (GitLab "api" includes "read_api"; GitHub "repo" includes the narrower repo scopes).
const COVERS: Record<string, string[]> = { api: ['read_api'], 'pullrequest:write': ['pullrequest'], 'issue:write': ['issue'], 'repository:write': ['repository'] };

function missingOf(required: string[], granted: string[]): string[] {
  const have = new Set(granted.flatMap((g) => [g, ...(COVERS[g] ?? [])]));
  return required.filter((r) => !have.has(r));
}

export function settingsOfRequest(r: VcsProbeRequest, cliCommand: string | null): VcsSettings {
  const i = r.integration;
  return {
    id: i.id,
    kind: i.kind,
    host: i.host,
    apiUrl: i.apiUrl,
    user: i.user,
    secretRef: i.secretRef,
    cli: i.cliPreference === 'api' || i.kind === 'bitbucket' ? null : (i.cliCommand ?? cliCommand),
    preference: i.cliPreference,
    repos: [...new Set([...(r.repos ?? []), ...(r.issueProject ? [r.issueProject] : [])])],
  };
}

const issueSample = (i: VcsIssue): VcsProbeSample => ({ ref: `${i.project}#${i.iid}`, title: i.title, status: i.status ?? i.state, url: i.webUrl });
const mrSample = (m: VcsMr): VcsProbeSample => ({ ref: `${m.project}!${m.iid}`, title: m.title, status: m.ci?.status ?? m.state, url: m.webUrl });

interface Inspect {
  granted: string[] | null;
  expiresAt: string | null;
  rate: VcsProbeResult['rateLimit'];
}

/** Scopes and rate limit as the host reports them on an API call. Null granted: the host does not say. */
async function inspectApi(rt: VcsRuntime): Promise<Inspect> {
  const api = rt.api;
  const out: Inspect = { granted: null, expiresAt: null, rate: null };
  if (!api) return out;
  const kind = rt.settings.kind;
  const rate = (h: Headers): VcsProbeResult['rateLimit'] => {
    const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const limit = num(h.get('x-ratelimit-limit') ?? h.get('ratelimit-limit'));
    const remaining = num(h.get('x-ratelimit-remaining') ?? h.get('ratelimit-remaining'));
    const reset = num(h.get('x-ratelimit-reset') ?? h.get('ratelimit-reset'));
    return limit === null && remaining === null ? null : { limit, remaining, resetAt: reset ? new Date(reset * 1000).toISOString() : null };
  };
  if (kind === 'gitlab') {
    // GitLab 15.5+: the token describes itself. An OAuth or job token has no such record (404): the scopes stay unknown.
    try {
      const res = await api.request('GET', 'personal_access_tokens/self');
      const b = res.body as { scopes?: string[]; expires_at?: string | null };
      out.granted = Array.isArray(b.scopes) ? b.scopes : null;
      out.expiresAt = b.expires_at ?? null;
      out.rate = rate(res.headers);
    } catch (e) {
      if (!(e instanceof VcsError) || !['not_found', 'forbidden'].includes(e.code)) throw e;
    }
    return out;
  }
  const res = await api.request('GET', 'user');
  const header = res.headers.get('x-oauth-scopes');
  // Classic GitHub tokens and Bitbucket OAuth tokens send the list (possibly empty); fine-grained tokens and app passwords send none.
  out.granted = header === null ? null : header.split(',').map((s) => s.trim()).filter(Boolean);
  out.rate = rate(res.headers);
  return out;
}

export async function probeWithRuntime(rt: VcsRuntime, o: { issueProject: string | null; now?: () => number }): Promise<VcsProbeResult> {
  const now = o.now ?? Date.now;
  const started = now();
  const { provider, settings } = rt;
  const result: VcsProbeResult = {
    ok: false,
    kind: settings.kind,
    host: settings.host,
    transport: provider.transport,
    user: null,
    scopes: null,
    checks: [],
    issues: null,
    mrs: null,
    rateLimit: null,
    warnings: [],
    message: '',
    status: null,
    durationMs: 0,
  };
  const check = (id: VcsProbeCheck['id'], ok: boolean, detail: string) => result.checks.push({ id, ok, detail });
  const message = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0] : String(e));

  try {
    const me = await provider.currentUser();
    result.user = { username: me.username, name: me.name };
    result.ok = true;
    result.message = t('vcs.probe.auth', { user: me.username, host: settings.host });
    check('auth', true, result.message);
  } catch (e) {
    result.message = message(e);
    result.status = e instanceof VcsError ? e.status : null;
    check('auth', false, result.message);
    result.durationMs = now() - started;
    return result;
  }

  if (provider.transport === 'api') {
    try {
      const info = await inspectApi(rt);
      result.rateLimit = info.rate;
      const known = info.granted !== null;
      const granted = info.granted ?? [];
      const need = SCOPES[settings.kind];
      const scopes: VcsProbeScopes = { known, granted, missing: known ? missingOf(need.read, granted) : [], forWrites: known ? missingOf(need.write, granted) : need.write, expiresAt: info.expiresAt };
      result.scopes = scopes;
      if (!known) check('scopes', true, t('vcs.probe.scopesUnknown'));
      else if (scopes.missing.length) check('scopes', false, t('vcs.probe.scopesMissing', { missing: scopes.missing.join(', ') }));
      else check('scopes', true, t('vcs.probe.scopesOk', { granted: granted.join(', ') || '-' }));
      if (scopes.known && scopes.forWrites.length) result.warnings.push(t('vcs.probe.writesNeed', { scopes: scopes.forWrites.join(', ') }));
    } catch (e) {
      check('scopes', false, message(e));
    }
  } else {
    result.warnings.push(t('vcs.probe.cliLogin', { command: settings.cli ?? '' }));
  }

  if (provider.caps.issues) {
    try {
      const issues = await provider.listMyIssues({ project: o.issueProject, limit: 30 });
      result.issues = { total: issues.length, sample: issues.slice(0, SAMPLE).map(issueSample) };
      check('issues', true, t('vcs.probe.issues', { count: issues.length }));
      if (settings.kind === 'bitbucket' && !settings.repos.length) result.warnings.push(t('vcs.probe.bitbucketRepos'));
    } catch (e) {
      check('issues', false, message(e));
    }
  }

  try {
    const mrs = await provider.listMyMrs({ roles: ['author', 'reviewer'], limit: 30 });
    result.mrs = { total: mrs.length, sample: mrs.slice(0, SAMPLE).map(mrSample) };
    check('mrs', true, t('vcs.probe.mrs', { count: mrs.length }));
  } catch (e) {
    check('mrs', false, message(e));
  }

  if (o.issueProject) {
    try {
      const repo = await provider.getRepo(o.issueProject);
      check('repo', true, t('vcs.probe.repo', { project: o.issueProject, branch: repo.defaultBranch }));
    } catch (e) {
      check('repo', false, t('vcs.probe.repoFail', { project: o.issueProject, error: message(e) }));
    }
  }

  result.durationMs = now() - started;
  return result;
}

/** Probes an integration as the wizard describes it. `deps.token` supplies the credential; a typed token overrides the stored one for this call only. */
export async function probeIntegration(request: VcsProbeRequest, deps: RuntimeDeps, cliDefault: (kind: VcsKind) => string | null = (k) => (k === 'gitlab' ? 'glab' : k === 'github' ? 'gh' : null)): Promise<VcsProbeResult> {
  const settings = settingsOfRequest(request, cliDefault(request.integration.kind));
  const typed = request.token?.trim();
  const rt = buildRuntime(settings, typed ? { ...deps, token: () => typed } : deps);
  const result = await probeWithRuntime(rt, { issueProject: request.issueProject ?? null, now: deps.now });
  // The typed token is never part of an answer; if a message echoed it, it is scrubbed.
  return typed ? JSON.parse(JSON.stringify(result).split(typed).join('[removed]')) : result;
}
