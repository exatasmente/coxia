import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { VcsProbeRequest } from '../src/shared/vcs';
import { VcsError } from '../src/main/vcs/errors';
import { SCOPES, probeIntegration as probeVcs } from '../src/main/vcs/probe';
import type { CliRun } from '../src/main/vcs/transport';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';

const TOKEN = 'TESTTOKEN-probe-not-real-0001';
const GL = fixture<Record<string, any>>('gitlab');
const GH = fixture<Record<string, any>>('github');
const BB = fixture<Record<string, any>>('bitbucket');

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
  setLanguage('pt-BR');
});

const deps = (token = TOKEN) => ({ token: () => token, env: () => ({}), sleep: noSleep });
const request = (kind: 'gitlab' | 'github' | 'bitbucket', apiUrl: string, over: Partial<VcsProbeRequest> = {}): VcsProbeRequest => ({
  integration: { id: kind, kind, host: `${kind}.test`, apiUrl, user: '', secretRef: `${kind}.token`, cliPreference: 'api', cliCommand: null },
  ...over,
});

describe('GitLab', () => {
  async function gitlab(scopes: string[]) {
    host = await startFakeHost({
      'GET /api/v4/user': { json: GL.user },
      'GET /api/v4/personal_access_tokens/self': { json: { ...GL.pat_self, scopes }, headers: { 'ratelimit-limit': '2000', 'ratelimit-remaining': '1990', 'ratelimit-reset': '1790000000' } },
      'GET /api/v4/projects/acme%2Fapp/issues': { json: GL.issues_assigned },
      'POST /api/graphql': { json: GL.workitem_status },
      'GET /api/v4/merge_requests': (h) => ({ json: h.query.get('scope') === 'created_by_me' ? GL.mr_list_author : GL.mr_list_reviewer }),
      'GET /api/v4/projects/acme%2Fapp': { json: GL.project },
    });
    return probeVcs(request('gitlab', `${host.url}/api/v4`, { issueProject: 'acme/app' }), deps());
  }

  it('says who I am, what the token may do, and shows a sample of my issues and MRs', async () => {
    const r = await gitlab(['read_api']);
    expect(r).toMatchObject({ ok: true, kind: 'gitlab', transport: 'api', user: { username: 'ana.dev', name: 'Ana Dev' } });
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([['auth', true], ['scopes', true], ['issues', true], ['mrs', true], ['repo', true]]);
    expect(r.scopes).toEqual({ known: true, granted: ['read_api'], missing: [], forWrites: ['api'], expiresAt: '2027-01-31' });
    expect(r.issues?.total).toBe(2);
    expect(r.issues?.sample[0]).toEqual({ ref: 'acme/app#101', title: 'Export fails with accents', status: 'In development', url: 'https://gitlab.test/acme/app/-/issues/101' });
    expect(r.mrs?.total).toBe(2);
    expect(r.mrs?.sample.map((s) => s.ref)).toEqual(['acme/app!7', 'acme/uploader!9']);
    expect(r.rateLimit).toEqual({ limit: 2000, remaining: 1990, resetAt: new Date(1790000000 * 1000).toISOString() });
    expect(r.warnings.join(' ')).toContain('token também precisa de: api');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('a token with api needs nothing more; a token with only another scope is told what is missing', async () => {
    const full = await gitlab(['api']);
    expect(full.scopes).toMatchObject({ missing: [], forWrites: [] });
    expect(full.warnings).toEqual([]);
    await host?.close();
    const wrong = await gitlab(['read_repository']);
    expect(wrong.scopes?.missing).toEqual(['read_api']);
    expect(wrong.checks.find((c) => c.id === 'scopes')).toMatchObject({ ok: false, detail: 'Faltam permissões de leitura no token: read_api.' });
  });

  it('an OAuth or job token has no record: the scopes are unknown, not wrong', async () => {
    host = await startFakeHost({ 'GET /api/v4/user': { json: GL.user }, 'GET /api/v4/personal_access_tokens/self': { status: 404, json: { message: '404 Not Found' } }, 'GET /api/v4/issues': { json: [] }, 'GET /api/v4/merge_requests': { json: [] } });
    const r = await probeVcs(request('gitlab', `${host.url}/api/v4`), deps());
    expect(r.ok).toBe(true);
    expect(r.scopes).toMatchObject({ known: false, missing: [] });
    expect(r.checks.find((c) => c.id === 'scopes')?.ok).toBe(true);
  });

  it('a rejected token stops at the first check with a message that names the host, in either language', async () => {
    host = await startFakeHost({ 'GET /api/v4/user': { status: 401, json: { message: `401 Unauthorized ${TOKEN}` } } });
    const r = await probeVcs(request('gitlab', `${host.url}/api/v4`), deps());
    expect(r.ok).toBe(false);
    expect(r.user).toBeNull();
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]).toMatchObject({ id: 'auth', ok: false });
    expect(r.checks[0].detail).toMatch(/recusou a credencial/);
    setLanguage('en');
    const en = await probeVcs(request('gitlab', `${host.url}/api/v4`), deps());
    expect(en.checks[0].detail).toMatch(/rejected the credential/);
  });

  it('a failing sample does not hide the rest', async () => {
    host = await startFakeHost({ 'GET /api/v4/user': { json: GL.user }, 'GET /api/v4/personal_access_tokens/self': { json: GL.pat_self }, 'GET /api/v4/issues': { status: 403, json: { message: 'insufficient_scope' } }, 'GET /api/v4/merge_requests': { json: GL.mr_list_author } });
    const r = await probeVcs(request('gitlab', `${host.url}/api/v4`), deps());
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.id === 'issues')).toMatchObject({ ok: false });
    expect(r.checks.find((c) => c.id === 'mrs')?.ok).toBe(true);
  });
});

describe('GitHub', () => {
  async function github(headers: Record<string, string>) {
    host = await startFakeHost({
      'GET /api/v3/user': { json: GH.user, headers },
      'GET /api/v3/issues': { json: GH.issues_assigned },
      'GET /api/v3/search/issues': { json: { items: [] } },
    });
    return probeVcs(request('github', `${host.url}/api/v3`), deps());
  }

  it('reads the scopes of a classic token and the rate limit', async () => {
    const r = await github({ 'x-oauth-scopes': 'repo, read:org', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1790000000' });
    expect(r.scopes).toMatchObject({ known: true, granted: ['repo', 'read:org'], missing: [] });
    expect(r.rateLimit).toMatchObject({ limit: 5000, remaining: 4999 });
    expect(r.issues?.sample[0].ref).toBe('acme/app#12');
    expect(r.kind).toBe('github');
  });

  it('a classic token without repo lacks what the reads need', async () => {
    const r = await github({ 'x-oauth-scopes': 'read:user' });
    expect(r.scopes?.missing).toEqual(['repo']);
    expect(r.checks.find((c) => c.id === 'scopes')?.ok).toBe(false);
  });

  it('a fine-grained token sends no list: unknown, and the sample shows what it reaches', async () => {
    const r = await github({});
    expect(r.scopes).toMatchObject({ known: false });
    expect(r.checks.find((c) => c.id === 'issues')?.ok).toBe(true);
  });
});

describe('Bitbucket', () => {
  it('reads the OAuth scopes header and asks for the repositories when none were given', async () => {
    host = await startFakeHost({
      'GET /2.0/user': { json: BB.user, headers: { 'x-oauth-scopes': 'account, repository, pullrequest' } },
      [`GET /2.0/pullrequests/%7B11111111-2222-3333-4444-555555555555%7D`]: { json: BB.prs_author },
    });
    const r = await probeVcs(request('bitbucket', `${host.url}/2.0`), deps('ana-dev:APPPASSWORD-not-real'));
    expect(r.scopes).toMatchObject({ known: true, missing: ['issue'] });
    expect(r.warnings.join(' ')).toMatch(/nenhum foi informado/);
    expect(r.mrs?.total).toBe(1);
    expect(r.user?.username).toBe('ana-dev');
    expect(SCOPES.bitbucket.write).toContain('pullrequest:write');
  });
});

describe('the CLI integration', () => {
  it('asks the CLI for the user and says the permissions are those of its login', async () => {
    const run: CliRun = async (_f, args) => JSON.stringify(args[1] === 'user' ? GL.user : []);
    const r = await probeVcs(request('gitlab', '', { integration: { ...request('gitlab', '').integration, cliPreference: 'cli' } }), { ...deps(), run });
    expect(r).toMatchObject({ ok: true, transport: 'cli', scopes: null });
    expect(r.warnings[0]).toContain('glab');
  });

  it('a missing CLI is reported as such', async () => {
    const run: CliRun = async () => {
      throw Object.assign(new Error('spawn glab ENOENT'), { code: 'ENOENT' });
    };
    const r = await probeVcs(request('gitlab', '', { integration: { ...request('gitlab', '').integration, cliPreference: 'cli' } }), { ...deps(), run });
    expect(r.ok).toBe(false);
    expect(r.checks[0].detail).toMatch(/glab/);
  });
});

describe('secrets', () => {
  it('tests a token typed in the screen without storing or echoing it', async () => {
    host = await startFakeHost({ 'GET /api/v4/user': (h) => ({ status: 401, json: { message: `bad credentials ${h.headers['private-token']}` } }) });
    const stored = () => {
      throw new VcsError('no_token', { id: 'gitlab', ref: 'gitlab.token' });
    };
    const typed = 'TYPED-token-never-stored-0001';
    const r = await probeVcs(request('gitlab', `${host.url}/api/v4`, { token: typed }), { token: stored, env: () => ({}), sleep: noSleep });
    expect(host.hits[0].headers['private-token']).toBe(typed);
    expect(JSON.stringify(r)).not.toContain(typed);
  });

  it('with no token anywhere it says which secret to set', async () => {
    host = await startFakeHost();
    const r = await probeVcs(request('gitlab', `${host.url}/api/v4`), {
      token: () => {
        throw new VcsError('no_token', { id: 'gitlab', ref: 'gitlab.token' });
      },
      env: () => ({}),
    });
    expect(r.ok).toBe(false);
    expect(r.checks[0].detail).toContain('gitlab.token');
    expect(host.hits).toHaveLength(0);
  });
});
