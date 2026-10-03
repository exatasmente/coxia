import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { Language } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import type { Card } from '../src/shared/types';
import { conflictMrs, needsYou } from '../src/renderer/src/dashboard';
import { buildCardReport } from '../src/main/vcs/cards';
import { buildRuntime } from '../src/main/vcs/runtime';
import { TEST_STAGES } from './helpers/config';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';
import { fakeGitlabRuntime } from './helpers/vcs';

// The card source built from a provider writes a localized blocker; what tells the screens that a merge request conflicts is the
// structured flag of the report, whatever the host and the language.

const reportMock = vi.hoisted(() => ({ report: { generated_at: '2026-10-02T09:00:00Z', items: [] as unknown[] } }));
vi.mock('../src/main/report', async (orig) => ({ ...(await orig<typeof import('../src/main/report')>()), readReport: async () => reportMock.report }));

const GL = fixture<Record<string, any>>('gitlab');
const GH = fixture<Record<string, any>>('github');
const NOW = new Date('2026-10-02T12:00:00');
const EMPTY_NEEDS = { turns: {}, answered: {}, actions: [], alerts: [] };

let loadCards: typeof import('../src/main/cards').loadCards;
let host: FakeHost | null = null;

beforeAll(async () => {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  saveConfig(neutralConfig());
  ({ loadCards } = await import('../src/main/cards'));
});

afterEach(async () => {
  await host?.close();
  host = null;
  setLanguage('pt-BR');
});

async function githubCards(conflicts: boolean): Promise<Card[]> {
  const API = '/api/v3';
  const pull7 = { ...GH.pull_7, mergeable: !conflicts, mergeable_state: conflicts ? 'dirty' : 'clean' };
  host = await startFakeHost({
    [`GET ${API}/user`]: { json: GH.user },
    [`GET ${API}/issues`]: { json: GH.issues_assigned },
    [`GET ${API}/search/issues`]: (h) => ({ json: h.query.get('q')?.includes('review-requested:') ? GH.search_prs_reviewer : GH.search_prs_author }),
    [`GET ${API}/repos/acme/app/pulls/7`]: { json: pull7 },
    [`GET ${API}/repos/acme/uploader/pulls/9`]: { json: GH.pull_9 },
    [`GET ${API}/repos/acme/app/commits/aaaa1111bbbb2222cccc3333dddd4444eeee5555/check-runs`]: { json: GH.check_runs_failed },
    [`GET ${API}/repos/acme/app/commits/aaaa1111bbbb2222cccc3333dddd4444eeee5555/status`]: { json: GH.combined_empty },
    [`GET ${API}/repos/acme/uploader/commits/ffff6666ffff6666/check-runs`]: { json: GH.check_runs_running },
    [`GET ${API}/repos/acme/uploader/commits/ffff6666ffff6666/status`]: { json: GH.combined_empty },
    [`GET ${API}/repos/acme/app/pulls/7/reviews`]: { json: GH.reviews },
    [`GET ${API}/repos/acme/uploader/pulls/9/reviews`]: { json: [] },
  });
  const rt = buildRuntime({ id: 'gh', kind: 'github', host: 'ghe.test', apiUrl: `${host.url}${API}`, user: '', secretRef: 'x', cli: null, preference: 'api', repos: [] }, { token: () => 't', env: () => ({}), sleep: noSleep });
  const { report } = await buildCardReport(rt.provider, { issueProject: null, refPrefix: '', stages: [], kind: 'github', state: null, now: () => NOW });
  reportMock.report = { generated_at: report.generated_at, items: report.items };
  return (await loadCards(10)).cards;
}

async function gitlabCards(conflicts: boolean): Promise<Card[]> {
  const author = GL.mr_list_author.map((m: Record<string, unknown>) => ({ ...m, has_conflicts: conflicts }));
  const rt = fakeGitlabRuntime(
    async (endpoint) => {
      if (endpoint === 'user') return GL.user;
      if (endpoint.startsWith('projects/acme%2Fapp/issues?') || endpoint.startsWith('issues?')) return GL.issues_assigned;
      if (endpoint.endsWith('/related_merge_requests')) return [];
      if (endpoint.startsWith('merge_requests?scope=created_by_me')) return author;
      if (endpoint.startsWith('merge_requests?scope=all&reviewer_username')) return GL.mr_list_reviewer;
      if (endpoint === 'projects/acme%2Fapp/merge_requests/7') return { ...GL.mr_7, has_conflicts: conflicts };
      if (endpoint === 'projects/acme%2Fuploader/merge_requests/9') return GL.mr_list_reviewer[0];
      throw new Error(`unexpected ${endpoint}`);
    },
    async () => GL.workitem_status,
  );
  const { report } = await buildCardReport(rt.provider, { issueProject: 'acme/app', refPrefix: 'app#', stages: TEST_STAGES, kind: 'gitlab', state: null, now: () => NOW });
  reportMock.report = { generated_at: report.generated_at, items: report.items };
  return (await loadCards(10)).cards;
}

const hosts: [string, (conflicts: boolean) => Promise<Card[]>, string, string][] = [
  ['GitHub', githubCards, 'app#12', 'app!7'],
  ['GitLab', gitlabCards, 'app#101', 'app!7'],
];

describe.each(hosts)('%s card source: the conflict button', (_name, build, issueRef, mrRef) => {
  it.each<Language>(['pt-BR', 'en'])('offers the conflicting merge request of the card in %s', async (language) => {
    setLanguage(language);
    const card = (await build(true)).find((c) => c.ref === issueRef)!;
    expect(card.mrConflicts).toEqual([mrRef]);
    expect(card.blockers.some((b) => /^app!7: /.test(b) && !/MR com conflitos/.test(b))).toBe(true);
    expect(conflictMrs(card).map((m) => m.ref)).toEqual([mrRef]);
    const row = needsYou({ cards: [card], ...EMPTY_NEEDS }).find((n) => n.id === `blocked:${card.ref}`);
    expect(row?.conflictCard).toBe(card);
    expect(row?.conflictRef).toBe(mrRef);
  });

  it('offers nothing when the merge request does not conflict', async () => {
    const card = (await build(false)).find((c) => c.ref === issueRef)!;
    expect(card.mrConflicts).toEqual([]);
    expect(conflictMrs(card)).toEqual([]);
    const row = needsYou({ cards: [card], ...EMPTY_NEEDS }).find((n) => n.id === `blocked:${card.ref}`);
    expect(row?.conflictCard).toBeUndefined();
    expect(row?.conflictRef).toBeUndefined();
  });
});

describe('a card source that only writes text', () => {
  it('keeps the button for the command wording, with no structured flag', async () => {
    reportMock.report = {
      generated_at: '2026-10-02T09:00:00Z',
      items: [
        { kind: 'issue', ref: 'app#5', project: 'acme/app', iid: 5, title: 'Five', stage: 'Doing', web_url: 'u', blockers: [], pending: [], changes: [], manual_note: null },
        { kind: 'mr', ref: 'app!50', project: 'acme/app', iid: 50, title: 'MR', stage: null, web_url: 'u', issue_refs: ['5'], blockers: ['MR com conflitos'], pending: [], changes: [], manual_note: null },
        { kind: 'mr', ref: 'app!51', project: 'acme/app', iid: 51, title: 'MR', stage: null, web_url: 'u', issue_refs: ['5'], blockers: ['pipeline falhou'], pending: [], changes: [], manual_note: null },
      ],
    };
    const [card] = (await loadCards(10)).cards;
    expect(card.mrConflicts).toEqual([]);
    expect(conflictMrs(card).map((m) => m.ref)).toEqual(['app!50']);
  });
});

describe('the Today row', () => {
  const mrs = [
    { ref: 'web!1', project: 'acme/web', iid: 1 },
    { ref: 'web!2', project: 'acme/web', iid: 2 },
  ];
  const card = (blockers: string[], mrConflicts: string[]): Card => ({ ref: 'web#9', iid: '9', title: 'T', stage: 'Doing', spec: null, mrs: mrs.map((m) => m.ref), mrPaths: mrs, blockers, pending: [], changes: [], note: null, url: '', mrConflicts });

  it('offers the button when the conflict is not the first blocker of the card', () => {
    const c = card(['web!1: Pipeline falhou', 'web!2: Conflito com a branch de destino'], ['web!2']);
    const [row] = needsYou({ cards: [c], ...EMPTY_NEEDS });
    expect(row.conflictCard).toBe(c);
    expect(row.conflictRef).toBeUndefined();
  });

  it('keeps the button of the first blocker merge request only, while the card still has both', () => {
    const c = card(['web!1: Pipeline falhou', 'web!2: Conflito com a branch de destino'], ['web!1', 'web!2']);
    const [row] = needsYou({ cards: [c], ...EMPTY_NEEDS });
    expect(row.conflictRef).toBe('web!1');
    expect(conflictMrs(c).map((m) => m.ref)).toEqual(['web!1', 'web!2']);
  });

  it('shows only the button of the merge request the row is about', () => {
    const c = card(['web!1: Conflict with the target branch', 'web!2: Conflict with the target branch'], ['web!1', 'web!2']);
    const [row] = needsYou({ cards: [c], ...EMPTY_NEEDS });
    expect(row.conflictRef).toBe('web!1');
  });
});
