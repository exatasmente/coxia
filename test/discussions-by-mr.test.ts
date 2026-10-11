// The discussions of a merge request that is not a card of the day: named by project and number, read only inside the workspace's projects (the strict rule of a team
// agent), refused with the reason otherwise, and explained without a card in the prompt.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/shared/i18n';
import type { VcsThread } from '../src/main/vcs/types';

const state = vi.hoisted(() => ({ projects: [] as string[], prompts: [] as string[], mrs: new Set<string>(), reads: [] as string[] }));
const thread = (id: string, resolved: boolean): VcsThread => ({ id, resolved, path: 'src/a.ts', line: 3, notes: [{ author: 'reviewer', createdAt: '2026-01-01T00:00:00Z', body: `note ${id}`, system: false }] }) as unknown as VcsThread;
const fake = {
  kind: 'gitlab',
  async getMr(project: string, iid: number) {
    state.reads.push(`mr ${project}!${iid}`);
    if (!state.mrs.has(`${project}!${iid}`)) throw new Error('404 Not Found');
    return {};
  },
  async listMrThreads(project: string, iid: number) {
    state.reads.push(`threads ${project}!${iid}`);
    return [thread('aa11', false), thread('bb22', true)];
  },
  async getMrThread(project: string, iid: number, id: string) {
    state.reads.push(`thread ${project}!${iid} ${id}`);
    return thread(id, false);
  },
};

vi.mock('../src/main/vcs', async (orig) => ({ ...(await orig<typeof import('../src/main/vcs')>()), vcsProvider: () => fake, vcsReady: () => true }));
vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  workspaceProjects: () => state.projects,
  askAgent: async (_role: string, prompt: string) => {
    state.prompts.push(prompt);
    return { data: { fala: 'speech', texto: 'text', ponto: 'point', precisa_codigo: false, rascunho: 'draft' }, sessionId: 's1' };
  },
}));

const { openDiscussions, explainDiscussion } = await import('../src/main/feedback');
const { mrOutOfReach } = await import('../src/main/vcs/readTool');

beforeEach(() => {
  state.projects = ['group/app'];
  state.prompts = [];
  state.reads = [];
  state.mrs = new Set(['group/app!7']);
});

describe('mrOutOfReach', () => {
  it('lets a merge request of a workspace project through, whatever the case of the project', () => {
    expect(mrOutOfReach('group/app', 7, ['group/app'])).toBeNull();
    expect(mrOutOfReach('Group/App', 7, ['group/app'])).toBeNull();
  });

  it('refuses a project outside the workspace, a workspace with no project and a bad name, each with its own reason', () => {
    expect(mrOutOfReach('other/app', 7, ['group/app'])).toBe(t('main.feedback.projectNotAllowed', { project: 'other/app', allowed: 'group/app' }));
    expect(mrOutOfReach('group/app', 7, [])).toBe(t('main.feedback.noProjects'));
    expect(mrOutOfReach('app', 7, ['group/app'])).toBe(t('main.feedback.badMrTarget', { project: 'app', number: '7' }));
    expect(mrOutOfReach('group/app', 0, ['group/app'])).toBe(t('main.feedback.badMrTarget', { project: 'group/app', number: '0' }));
    expect(mrOutOfReach('group/app', '7', ['group/app'])).not.toBeNull();
  });
});

describe('openDiscussions', () => {
  it('lists the unresolved threads of a merge request that is not a card of the day', async () => {
    const r = await openDiscussions('group/app', 7);
    expect(r.mr).toMatchObject({ project: 'group/app', iid: 7 });
    expect(r.discussions.map((d) => d.id)).toEqual(['aa11']);
  });

  it('reads the list again every time it is asked, not once', async () => {
    await openDiscussions('group/app', 7);
    await openDiscussions('group/app', 7);
    expect(state.reads.filter((x) => x.startsWith('threads'))).toHaveLength(2);
  });

  it('refuses a project outside the workspace before reading anything from the host', async () => {
    await expect(openDiscussions('other/app', 7)).rejects.toThrow(t('main.feedback.projectNotAllowed', { project: 'other/app', allowed: 'group/app' }));
    state.projects = [];
    await expect(openDiscussions('group/app', 7)).rejects.toThrow(t('main.feedback.noProjects'));
    expect(state.reads).toEqual([]);
  });

  it('refuses a number the host does not give as a merge request, with the reason and without saying what else it is', async () => {
    const err = await openDiscussions('group/app', 9).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('404 Not Found');
    expect((err as Error).message).not.toMatch(/issue/i);
    expect(state.reads.some((x) => x.startsWith('threads'))).toBe(false);
  });
});

describe('explainDiscussion without a card', () => {
  const mr = { ref: 'group/app!7', project: 'group/app', iid: 7 };

  it('explains the thread with a prompt that names the merge request and no issue, title or spec', async () => {
    const view = await explainDiscussion(null, mr, 'aa11');
    expect(view.explanation?.draft).toBe('draft');
    const [prompt] = state.prompts;
    expect(prompt).toContain('group/app!7');
    expect(prompt).not.toMatch(/\(issue /);
  });

  it('refuses a merge request outside the workspace without asking the model', async () => {
    await expect(explainDiscussion(null, { ref: 'other/app!7', project: 'other/app', iid: 7 }, 'aa11')).rejects.toThrow();
    expect(state.prompts).toEqual([]);
    expect(state.reads).toEqual([]);
  });
});
