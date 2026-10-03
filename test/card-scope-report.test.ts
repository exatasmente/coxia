import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type FakeHost, fixture, startFakeHost } from './helpers/fakeHost';

// From the saved setting to the cards the screens read: the configuration, the integration, the provider over a fake GitHub, the report
// and its cache. Nothing here reaches a network or a model.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-card-scope-'));
process.env.CERIMONIAS_DATA_DIR = DATA;
const GH = fixture<Record<string, any>>('github');
const API = '/api/v3';

const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { installEnvSecret } = await import('./helpers/config');
const { readReport } = await import('../src/main/report');

let host: FakeHost | null = null;
afterAll(async () => {
  await host?.close();
  rmSync(DATA, { recursive: true, force: true });
});

const other = { ...GH.issues_assigned[0], number: 13, title: 'Not mine', assignees: [], labels: [{ name: 'ready' }] };

async function setUp() {
  host = await startFakeHost({
    [`GET ${API}/user`]: { json: GH.user },
    [`GET ${API}/repos/acme/app/issues`]: { json: GH.issues_assigned },
    [`GET ${API}/issues`]: { json: GH.issues_assigned },
    [`GET ${API}/search/issues`]: (h) => ({ json: { items: h.query.get('q')?.startsWith('is:issue') ? [GH.issues_assigned[0], other] : [] } }),
  });
  await installEnvSecret('vcs.gh-test', 'COXIA_TEST_GITHUB_TOKEN', 'scope-token-not-real-0001');
  const c = structuredClone(getConfig());
  c.vcs = [{ id: 'gh-test', kind: 'github', host: 'ghe.test', apiUrl: `${host.url}${API}`, user: '', secretRef: 'vcs.gh-test', cliPreference: 'api', cliCommand: null }];
  c.projects.issues = { vcsId: 'gh-test', project: 'acme/app', projectId: null, refPrefix: 'app#', cardScope: 'assigned', cardLabels: [] };
  saveConfig(c);
}

const setScope = (cardScope: 'assigned' | 'all' | 'labels', cardLabels: string[] = [], project: string | null = 'acme/app') => {
  const c = structuredClone(getConfig());
  c.projects.issues = { ...c.projects.issues, project, cardScope, cardLabels };
  saveConfig(c);
};
const issueRefs = async () => (await readReport()).items.filter((i) => i.kind === 'issue').map((i) => i.ref);
const searches = () => host?.log().filter((l) => l.includes('/search/issues?q=is%3Aissue')).length ?? 0;

describe('the card scope, from the saved setting to the report', () => {
  it('follows the setting at once, without waiting for the cache to expire, and reuses the cache while it is unchanged', async () => {
    await setUp();
    expect(await issueRefs()).toEqual(['app#12']);
    expect(searches()).toBe(0);

    setScope('all');
    expect(await issueRefs()).toEqual(['app#12', 'app#13']);
    expect(searches()).toBe(1);
    expect(await issueRefs()).toEqual(['app#12', 'app#13']);
    expect(searches()).toBe(1);

    setScope('labels', ['ready']);
    await issueRefs();
    expect(searches()).toBe(2);
    expect(host?.log().some((l) => l.includes('label%3A%22ready%22'))).toBe(true);

    setScope('assigned');
    expect(await issueRefs()).toEqual(['app#12']);
  });

  it('shows the assigned issues, with no search, when the scope cannot be honoured', async () => {
    setScope('all', [], null);
    const before = searches();
    expect(await issueRefs()).toEqual(['app#12']);
    expect(searches()).toBe(before);
    setScope('labels', []);
    expect(await issueRefs()).toEqual(['app#12']);
    expect(searches()).toBe(before);
  });
});
