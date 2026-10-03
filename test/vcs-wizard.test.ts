import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { normalizeVcsProbe } from '../src/main/wizard-core';
import { type FakeHost, fixture, startFakeHost } from './helpers/fakeHost';

// The wizard's "Testar" button: it finds probeVcs in src/main/vcs/index.ts, calls it with one integration of the config and reads the
// answer with normalizeVcsProbe. This is that path, against a fake GitLab.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-vcs-wizard-'));
process.env.CERIMONIAS_DATA_DIR = DATA;
const GL = fixture<Record<string, any>>('gitlab');

const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { installEnvSecret } = await import('./helpers/config');
const vcs = await import('../src/main/vcs');

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

async function configure(token: string) {
  host = await startFakeHost({
    'GET /api/v4/user': (h) => (h.headers['private-token'] === token ? { json: GL.user } : { status: 401, json: { message: '401 Unauthorized' } }),
    'GET /api/v4/personal_access_tokens/self': { json: GL.pat_self },
    'GET /api/v4/projects/acme%2Fapp/issues': { json: GL.issues_assigned },
    'POST /api/graphql': { json: GL.workitem_status },
    'GET /api/v4/merge_requests': (h) => ({ json: h.query.get('scope') === 'created_by_me' ? GL.mr_list_author : [] }),
    'GET /api/v4/projects/acme%2Fapp': { json: GL.project },
  });
  await installEnvSecret('vcs.gitlab-test', 'COXIA_TEST_GITLAB_TOKEN', token);
  const c = structuredClone(getConfig());
  c.vcs = [{ id: 'gitlab-test', kind: 'gitlab', host: 'gitlab.test', apiUrl: `${host.url}/api/v4`, user: '', secretRef: 'vcs.gitlab-test', cliPreference: 'api', cliCommand: null }];
  c.projects.issues = { vcsId: 'gitlab-test', project: 'acme/app', projectId: null, refPrefix: '', cardScope: 'assigned', cardLabels: [] };
  saveConfig(c);
  return getConfig().vcs[0];
}

describe('probeVcs(integration) as the wizard calls it', () => {
  it('is exported by src/main/vcs/index.ts and answers with what normalizeVcsProbe reads', async () => {
    const integration = await configure('wizard-token-not-real-0001');
    expect(typeof vcs.probeVcs).toBe('function');
    const raw = await vcs.probeVcs(integration);
    const r = normalizeVcsProbe(raw);
    expect(r).toMatchObject({ ok: true, user: 'ana.dev', source: 'vcs', status: null });
    expect(r.message).toBe('Conectado como ana.dev em gitlab.test.');
    expect(r.probe?.issues?.total).toBe(2);
    expect(r.probe?.mrs?.sample[0].ref).toBe('acme/app!7');
    expect(r.probe?.scopes).toMatchObject({ known: true, granted: ['read_api'] });
    expect(r.probe?.checks.map((c) => c.id)).toEqual(['auth', 'scopes', 'issues', 'mrs', 'repo']);
    expect(JSON.stringify(r)).not.toContain('wizard-token-not-real-0001');
  });

  it('reports a refused token with the status the wizard maps to its own messages', async () => {
    const integration = await configure('wizard-token-not-real-0002');
    process.env.COXIA_TEST_GITLAB_TOKEN = 'a-different-token';
    const r = normalizeVcsProbe(await vcs.probeVcs(integration));
    expect(r).toMatchObject({ ok: false, user: null, source: 'vcs', status: 401 });
    expect(r.message).toMatch(/recusou a credencial/);
  });

  it('with no token source it says which secret to set instead of throwing', async () => {
    const integration = await configure('wizard-token-not-real-0003');
    delete process.env.COXIA_TEST_GITLAB_TOKEN;
    const r = normalizeVcsProbe(await vcs.probeVcs(integration));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('vcs.gitlab-test');
  });

  it('tests a token typed in the screen before it is stored', async () => {
    const integration = await configure('wizard-token-not-real-0004');
    delete process.env.COXIA_TEST_GITLAB_TOKEN;
    const r = normalizeVcsProbe(await vcs.probeVcs(integration, { token: 'wizard-token-not-real-0004' }));
    expect(r.ok).toBe(true);
  });
});
