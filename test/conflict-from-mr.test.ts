import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_CHANNELS } from '../src/shared/apiChannels';
import { parseMrRef, resolveMr } from '../src/main/conflictFromMr';
import { webAccess, webRefusal } from '../src/main/webPolicy';
import { type Fixture, IDENTITY, cloneSnapshot, git, makeFixture, originSha } from './helpers/conflictRepos';

vi.mock('../src/main/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/agents')>()),
  conflictPropose: vi.fn(),
  conflictAsk: vi.fn(),
  rewriteQaComment: vi.fn(),
}));

// Own data dir: the other conflict suite resets the shared one while files run in parallel.
const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-from-mr-data-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { conflictDiscard, conflictFromMr, conflictHooks, conflictPrepare, listActions } = await import('../src/main/actions');
const { ATAS } = await import('../src/main/env');

let f: Fixture;
let reads: string[];
let mr: Record<string, unknown>;
let me: string;
let defaultBranch: string;

function card(project: string) {
  return { iid: '15526', title: 'Fixture issue', stage: 'STAGE:: Code Review', mrPaths: [{ ref: 'proj!1234', project, iid: 1234 }] };
}

function stubGitlab(): void {
  conflictHooks.gitlabGet = async (endpoint) => {
    reads.push(endpoint);
    if (endpoint === 'user') return { username: me };
    if (endpoint.endsWith('/merge_requests/1234')) return mr;
    if (endpoint.includes('/repository/branches/')) return { commit: { id: originSha(f, 'main') } };
    if (/^projects\/[^/]+$/.test(endpoint)) return { default_branch: defaultBranch };
    throw new Error(`unexpected GET ${endpoint}`);
  };
}

beforeAll(() => {
  Object.assign(process.env, IDENTITY);
});

beforeEach(() => {
  rmSync(ATAS, { recursive: true, force: true });
  f = makeFixture();
  conflictHooks.cloneRoots = f.cloneRoots;
  reads = [];
  me = 'luiz.neto';
  defaultBranch = 'main';
  mr = { state: 'opened', has_conflicts: true, source_branch: f.branch, target_branch: 'main', web_url: 'https://example.test/grp/proj/-/merge_requests/1234', sha: originSha(f, f.branch), author: { username: 'luiz.neto' } };
  stubGitlab();
});

afterEach(() => {
  rmSync(f.root, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(DATA, { recursive: true, force: true });
});

describe('MR reference parsing', () => {
  it('reads the full path and the short form', () => {
    expect(parseMrRef('broker-whatsapp/hub-whatsapp!797')).toEqual({ project: 'broker-whatsapp/hub-whatsapp', full: true, iid: 797 });
    expect(parseMrRef(' sz4/sub/proj!5 ')).toEqual({ project: 'sz4/sub/proj', full: true, iid: 5 });
    expect(parseMrRef('hub-whatsapp!797')).toEqual({ project: 'hub-whatsapp', full: false, iid: 797 });
  });

  it('refuses malformed refs', () => {
    for (const bad of ['', '!797', 'hub-whatsapp', 'hub-whatsapp!0', 'a b!1', 'x/../y!1', 'x!1;rm', 'x!99999999999999999999']) {
      expect(() => parseMrRef(bad), bad).toThrow(/inválid/);
    }
  });

  it('resolves the short form only through the MRs of the card', () => {
    const known = [
      { ref: 'sz4!9302', project: 'sz4/sz4', iid: 9302 },
      { ref: 'hub-whatsapp!797', project: 'broker-whatsapp/hub-whatsapp', iid: 797 },
    ];
    expect(resolveMr('hub-whatsapp!797', known)).toEqual({ project: 'broker-whatsapp/hub-whatsapp', iid: 797 });
    expect(resolveMr('other/proj!3', known)).toEqual({ project: 'other/proj', iid: 3 });
    expect(() => resolveMr('hub-whatsapp!798', known)).toThrow(/não é um MR desta atividade/);
    expect(() => resolveMr('nope!797', known)).toThrow(/não é um MR desta atividade/);
  });
});

describe('conflict:fromMr', () => {
  it('builds the conflict action with the fields Preparar needs and only reads GitLab', async () => {
    const a = await conflictFromMr(card(f.project), 'proj!1234');
    expect(a).toMatchObject({
      kind: 'conflict',
      state: 'pending',
      issue: 15526,
      issueTitle: 'Fixture issue',
      stage: 'STAGE:: Code Review',
      release: 'MR em conflito com a main',
      files: [],
      key: `conflict:${f.project}!1234:${originSha(f, 'main')}`,
      mrs: [{ ref: `${f.project}!1234`, url: mr.web_url, branch: f.branch, behind: 0 }],
      resolve: null,
    });
    expect(a.unit).toMatchObject({ project_path: f.project, mr_iid: 1234, mr_ref: `${f.project}!1234`, source_branch: f.branch, target_branch: 'main', tgt_sha: originSha(f, 'main'), src_sha: originSha(f, f.branch), status: 'CONFLITO' });
    expect(listActions()).toHaveLength(1);
    expect(reads.sort()).toEqual([`projects/${encodeURIComponent(f.project)}`, `projects/${encodeURIComponent(f.project)}/merge_requests/1234`, `projects/${encodeURIComponent(f.project)}/repository/branches/main`, 'user']);
  });

  it('reuses the open action for the same MR and target sha', async () => {
    const first = await conflictFromMr(card(f.project), 'proj!1234');
    const again = await conflictFromMr(card(f.project), `${f.project}!1234`);
    expect(again.id).toBe(first.id);
    expect(listActions()).toHaveLength(1);
  });

  it('keeps reusing a prepared resolution after the main moved', async () => {
    const first = await conflictFromMr(card(f.project), 'proj!1234');
    await conflictPrepare(first.id);
    git(f.seed, 'checkout', '-q', 'main');
    git(f.seed, 'commit', '-q', '--allow-empty', '-m', 'main moved');
    git(f.seed, 'push', '-q', 'origin', 'main');
    const again = await conflictFromMr(card(f.project), 'proj!1234');
    expect(again.id).toBe(first.id);
    expect(again.resolve).not.toBeNull();
    expect(listActions()).toHaveLength(1);
  });

  it('reuses the action after its worktree was discarded, since it stays pending', async () => {
    const first = await conflictFromMr(card(f.project), 'proj!1234');
    await conflictPrepare(first.id);
    await conflictDiscard(first.id);
    const again = await conflictFromMr(card(f.project), 'proj!1234');
    expect(again.id).toBe(first.id);
  });

  it('does not trust a stale has_conflicts: the local merge decides', async () => {
    mr = { ...mr, has_conflicts: false };
    const a = await conflictFromMr(card(f.project), 'proj!1234');
    expect(a.kind).toBe('conflict');
  });

  it('refuses MRs the app does not resolve, with a clear message and nothing stored', async () => {
    mr = { ...mr, target_branch: 'develop' };
    await expect(conflictFromMr(card(f.project), 'proj!1234')).rejects.toThrow(/aponta para develop, não para a main/);
    mr = { ...mr, target_branch: 'main', state: 'merged' };
    await expect(conflictFromMr(card(f.project), 'proj!1234')).rejects.toThrow(/não está aberto/);
    mr = { ...mr, state: 'opened', author: { username: 'colleague' } };
    await expect(conflictFromMr(card(f.project), 'proj!1234')).rejects.toThrow(/é de @colleague/);
    mr = { ...mr, author: { username: me } };
    await expect(conflictFromMr(card(f.project), 'other!1')).rejects.toThrow(/não é um MR desta atividade/);
    await expect(conflictFromMr({ ...card(f.project), iid: 'abc' }, 'proj!1234')).rejects.toThrow(/sem número de issue/);
    expect(listActions()).toHaveLength(0);
  });

  it('accepts a default branch other than main when the MR targets it', async () => {
    defaultBranch = 'develop';
    mr = { ...mr, target_branch: 'develop' };
    const a = await conflictFromMr(card(f.project), 'proj!1234');
    expect((a.unit as { target_branch: string }).target_branch).toBe('develop');
  });
});

describe('Preparar on an action from conflict:fromMr (no mirror)', () => {
  it('builds the worktree from the local clone and leaves it untouched', async () => {
    const a = await conflictFromMr(card(f.project), 'proj!1234');
    expect((a.unit as { repo: string }).repo).toBe('');
    const before = cloneSnapshot(f);
    const prepared = await conflictPrepare(a.id);
    const r = prepared.resolve;
    expect(r?.clone).toBe(f.clone);
    expect(r?.branch).toBe(f.branch);
    expect(r?.target).toBe('main');
    expect(r?.syncBranch).toBe('sync/1234');
    expect(r?.originSha).toBe(originSha(f, f.branch));
    expect(r?.mainSha).toBe(originSha(f, 'main'));
    expect(r?.files.map((x) => x.path).sort()).toEqual(['app.js', 'old.txt']);
    expect(r?.worktree).toBe(join(ATAS, 'conflicts', 'proj-1234'));
    expect(existsSync(r?.worktree as string)).toBe(true);
    expect(git(r?.worktree as string, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toBeTruthy();
    expect(cloneSnapshot(f)).toEqual(before);
    await conflictDiscard(a.id);
  });
});

describe('web policy', () => {
  it('conflict:fromMr is a channel, local plus a GitLab read, and open to the browser', () => {
    expect(Object.values(API_CHANNELS)).toContain('conflict:fromMr');
    expect(webAccess('conflict:fromMr')).toBe('allow');
    expect(webRefusal('conflict:fromMr', false)).toBeNull();
  });
});
