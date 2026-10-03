import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { crRef } from '../src/shared/vcs';
import { VCS_CAPS } from '../src/shared/vcsCaps';
import { parseMrRef, resolveMr } from '../src/main/conflictFromMr';
import { buildCardReport } from '../src/main/vcs/cards';
import type { VcsIssue, VcsMr, VcsProvider } from '../src/main/vcs/types';
import { hostConfig } from './helpers/config';

// The ref of a change request is written the way the host writes it: "app!7" on GitLab, "app#7" on GitHub and Bitbucket.

const reportMock = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../src/main/report', async (orig) => ({
  ...(await orig<typeof import('../src/main/report')>()),
  readReport: async () => ({ generated_at: '2026-10-02T09:00:00Z', items: reportMock.items }),
}));

describe('crRef', () => {
  it('marks a GitLab merge request with ! and the other hosts with #', () => {
    expect(crRef('gitlab', 'acme/web', 7)).toBe('web!7');
    expect(crRef('github', 'acme/web', 7)).toBe('web#7');
    expect(crRef('bitbucket', 'acme/web', 7)).toBe('web#7');
    expect(crRef(null, 'acme/web', 7)).toBe('web!7');
  });

  it('keeps the whole project path when asked, and the number as a string too', () => {
    expect(crRef('gitlab', 'group/sub/web', 7, { full: true })).toBe('group/sub/web!7');
    expect(crRef('github', 'acme/web', '7', { full: true })).toBe('acme/web#7');
    expect(crRef('github', 'web', 7)).toBe('web#7');
  });
});

describe('reading a ref', () => {
  it('accepts both marks, short or with the project path, and refuses a bare number', () => {
    expect(parseMrRef('web!7')).toEqual({ project: 'web', full: false, iid: 7 });
    expect(parseMrRef('web#7')).toEqual({ project: 'web', full: false, iid: 7 });
    expect(parseMrRef('acme/web#7')).toEqual({ project: 'acme/web', full: true, iid: 7 });
    expect(parseMrRef(' group/sub/web!42 ')).toMatchObject({ project: 'group/sub/web', iid: 42 });
    expect(() => parseMrRef('#7')).toThrow();
    expect(() => parseMrRef('!7')).toThrow();
    expect(() => parseMrRef('web#0')).toThrow();
  });

  it('resolves the short form against the merge requests of the card', () => {
    const known = [{ ref: 'web#7', project: 'acme/web', iid: 7 }];
    expect(resolveMr('web#7', known)).toEqual({ project: 'acme/web', iid: 7 });
  });
});

const issue = (over: Partial<VcsIssue> = {}): VcsIssue => ({ project: 'acme/app', iid: 5, title: 'Fix the filter', state: 'open', status: null, labels: [], milestone: null, assignees: [], author: null, createdAt: null, updatedAt: null, closedAt: null, webUrl: 'u', ...over });
const mr = (over: Partial<VcsMr> = {}): VcsMr => ({
  project: 'acme/app', iid: 7, title: 'Fix it', state: 'open', draft: false, sourceBranch: 'b', targetBranch: 'main', sha: 's', webUrl: 'u', author: 'me', reviewers: [], approvals: null, ci: { status: 'failed', webUrl: null, raw: 'failure', runId: 1 },
  hasConflicts: true, behind: null, createdAt: null, updatedAt: null, mergedAt: null, description: '', roles: ['author'], issueRefs: [5], ...over,
}) as VcsMr;
const provider = (kind: 'github' | 'bitbucket', issues: VcsIssue[], mrs: VcsMr[]): VcsProvider =>
  ({ caps: VCS_CAPS[kind], listMyIssues: async () => issues, listMyMrs: async () => mrs, linkedMrs: async () => [] }) as unknown as VcsProvider;
const opts = (kind: 'github' | 'bitbucket') => ({ issueProject: 'acme/app', refPrefix: 'app#', stages: [], kind, state: null, now: () => new Date('2026-10-02T12:00:00') });

describe('the cards of a host that marks a pull request with #', () => {
  let loadCards: typeof import('../src/main/cards').loadCards;

  beforeAll(async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    saveConfig(hostConfig('github', { language: 'en' }));
    setLanguage('en');
    ({ loadCards } = await import('../src/main/cards'));
  });

  it('names the pull request app#7 in the list, the paths, the blockers and the pending items', async () => {
    const { report } = await buildCardReport(provider('github', [issue()], [mr()]), opts('github'));
    reportMock.items = report.items;
    const { cards } = await loadCards(10);
    expect(cards).toHaveLength(1);
    expect(cards[0].ref).toBe('app#5');
    expect(cards[0].mrs).toEqual(['app#7']);
    expect(cards[0].mrPaths).toEqual([{ ref: 'app#7', project: 'acme/app', iid: 7 }]);
    expect(cards[0].blockers).toEqual(expect.arrayContaining(['app#7: Checks failed']));
    expect(cards[0].blockers.every((b) => !b.includes('!'))).toBe(true);
  });

  it('keeps an issue and a pull request of the same number apart (Bitbucket numbers them separately)', async () => {
    const { report } = await buildCardReport(provider('bitbucket', [issue({ iid: 7 })], [mr({ issueRefs: [] })]), opts('bitbucket'));
    const refs = report.items.map((i) => i.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(report.items.find((i) => i.kind === 'issue')?.ref).toBe('app#7');
    expect(report.items.find((i) => i.kind === 'mr')?.ref).toBe('acme/app#7');
  });

  it('on GitHub the pull request and the issue of a project never get the same ref', async () => {
    const { report } = await buildCardReport(provider('github', [issue({ iid: 5 })], [mr({ iid: 7 })]), opts('github'));
    expect(report.items.map((i) => i.ref)).toEqual(['app#5', 'app#7']);
  });

  it('a ref of a GitLab merge request keeps the !', async () => {
    const { report } = await buildCardReport({ ...provider('github', [issue()], [mr()]), caps: VCS_CAPS.gitlab } as unknown as VcsProvider, { ...opts('github'), kind: 'gitlab' });
    expect(report.items.find((i) => i.kind === 'mr')?.ref).toBe('app!7');
  });
});
