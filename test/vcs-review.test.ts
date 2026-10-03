// What a review round, a note edited in place and a pull request look like on each of the three hosts: the commands planned (against fake hosts that
// answer the reads the plan needs), and what each provider's closed list of writes accepts and refuses.
import { afterEach, describe, expect, it } from 'vitest';
import { VcsError } from '../src/main/vcs/errors';
import { covers, indexPatch, parsePatch } from '../src/main/vcs/diffLines';
import { validateBitbucketCommand } from '../src/main/vcs/bitbucket';
import { validateGitHubCommand } from '../src/main/vcs/github';
import { GITLAB_FILE_COMMENTS_SINCE, positionFields, validateGitLabCommand, versionAtLeast } from '../src/main/vcs/gitlab';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import type { ReviewComment, VcsCommand } from '../src/main/vcs/types';
import { type FakeHost, noSleep, startFakeHost } from './helpers/fakeHost';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

const PATCH = '@@ -10,4 +10,5 @@\n a\n-b\n+B\n+C\n d\n e\n';
const SHA = 'abc1234def5678';
const line = (over: Partial<ReviewComment>): ReviewComment => ({ path: 'src/a.ts', line: 11, startLine: null, side: 'new', body: 'Body.', ...over });

describe('which lines of a diff a comment can stand on', () => {
  it('numbers the lines of both files and tells what each one is', () => {
    expect(parsePatch(PATCH)).toEqual([
      { kind: 'ctx', old: 10, new: 10 },
      { kind: 'del', old: 11, new: null },
      { kind: 'add', old: null, new: 11 },
      { kind: 'add', old: null, new: 12 },
      { kind: 'ctx', old: 12, new: 13 },
      { kind: 'ctx', old: 13, new: 14 },
    ]);
  });

  it('indexes by side, finds the first line the change touches, and says whether a range is all in the diff', () => {
    const i = indexPatch(PATCH);
    expect([...i.new.keys()]).toEqual([10, 11, 12, 13, 14]);
    expect([...i.old.keys()]).toEqual([10, 11, 12, 13]);
    expect(i.first).toEqual({ kind: 'del', old: 11, new: null });
    expect(covers(i, 'new', 11, 13)).toBe(true);
    expect(covers(i, 'new', 13, 16)).toBe(false);
    expect(covers(i, 'old', 11, 11)).toBe(true);
  });

  it('keeps hunks apart: a range across the gap between two hunks is not covered', () => {
    const i = indexPatch('@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -20,1 +20,1 @@\n z\n');
    expect(covers(i, 'new', 1, 2)).toBe(true);
    expect(covers(i, 'new', 2, 20)).toBe(false);
  });

  it('has nothing for a file the host left without a patch, ignores "no newline" marks and reads a trimmed empty context line', () => {
    expect(indexPatch('').first).toBeNull();
    expect(parsePatch('@@ -1,2 +1,2 @@\n-a\n+b\n\\ No newline at end of file\n\n').map((l) => l.kind)).toEqual(['del', 'add', 'ctx']);
  });
});

// ---------------------------------------------------------------------------------------------------------------- GitHub

describe('GitHub', () => {
  const runtime = async (routes: Parameters<typeof startFakeHost>[0] = {}): Promise<VcsRuntime> => {
    host = await startFakeHost(routes);
    const s: VcsSettings = { id: 'gh', kind: 'github', host: 'ghe.test', apiUrl: `${host.url}/api/v3`, user: '', secretRef: 'x', cli: 'gh', preference: 'api', repos: [] };
    return buildRuntime(s, { token: () => 't', env: () => ({}), sleep: noSleep });
  };
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'github', via: 'api', method: 'POST', endpoint: '', fields: {}, ...over });

  it('plans one review with the comments on lines, and one comment of its own for each file', async () => {
    const rt = await runtime();
    const out = await rt.provider.planWrite({
      op: 'submitReview',
      project: 'acme/app',
      iid: 7,
      event: 'request_changes',
      body: 'General.',
      commitSha: SHA,
      comments: [line({}), line({ line: 12, startLine: 11, body: 'Range.' }), line({ side: 'old', line: 11, body: 'Removed.' }), line({ path: 'docs/a.md', line: null, body: 'About the file.' })],
    });
    expect(out).toEqual([
      cmd({
        endpoint: 'repos/acme/app/pulls/7/reviews',
        json: JSON.stringify({
          event: 'REQUEST_CHANGES',
          body: 'General.',
          commit_id: SHA,
          comments: [
            { path: 'src/a.ts', body: 'Body.', line: 11, side: 'RIGHT' },
            { path: 'src/a.ts', body: 'Range.', line: 12, side: 'RIGHT', start_line: 11, start_side: 'RIGHT' },
            { path: 'src/a.ts', body: 'Removed.', line: 11, side: 'LEFT' },
          ],
        }),
      }),
      cmd({ endpoint: 'repos/acme/app/pulls/7/comments', json: JSON.stringify({ body: 'About the file.', commit_id: SHA, path: 'docs/a.md', subject_type: 'file' }) }),
    ]);
    for (const c of out) expect(() => validateGitHubCommand(c)).not.toThrow();
    expect(host?.hits).toHaveLength(0);
  });

  it('asks for changes only when told to, and a review with nothing but a body is still a review', async () => {
    const rt = await runtime();
    const [review] = await rt.provider.planWrite({ op: 'submitReview', project: 'acme/app', iid: 7, event: 'comment', body: 'Fine.', commitSha: SHA, comments: [] });
    expect(JSON.parse(review.json as string)).toEqual({ event: 'COMMENT', body: 'Fine.', commit_id: SHA, comments: [] });
    expect(() => validateGitHubCommand(review)).not.toThrow();
  });

  it('plans the edit of a conversation comment of a PR, and a pull request from a branch', async () => {
    const rt = await runtime();
    expect(await rt.provider.planWrite({ op: 'editMrNote', project: 'acme/app', iid: 7, noteId: 55, body: 'New.' })).toEqual([cmd({ method: 'PATCH', endpoint: 'repos/acme/app/issues/comments/55', json: '{"body":"New."}' })]);
    const [pr] = await rt.provider.planWrite({ op: 'createMr', project: 'acme/app', title: 'Do it', body: 'Closes #1', sourceBranch: 'cycle/1-do-it', targetBranch: 'main' });
    expect(pr).toEqual(cmd({ endpoint: 'repos/acme/app/pulls', json: JSON.stringify({ title: 'Do it', head: 'cycle/1-do-it', base: 'main', body: 'Closes #1' }) }));
    expect(() => validateGitHubCommand(pr)).not.toThrow();
  });

  it('refuses what is not a commit, a branch or a repository path', async () => {
    const rt = await runtime();
    await expect(rt.provider.planWrite({ op: 'submitReview', project: 'acme/app', iid: 7, event: 'comment', body: 'x', commitSha: 'main; rm', comments: [] })).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.planWrite({ op: 'createMr', project: 'acme/app', title: 't', body: '', sourceBranch: '../x', targetBranch: 'main' })).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.planWrite({ op: 'createMr', project: 'acme/app', title: 't', body: '', sourceBranch: 'a', targetBranch: 'b.lock' })).rejects.toBeInstanceOf(VcsError);
  });

  describe('the closed list', () => {
    const base = (json: unknown, endpoint = 'repos/acme/app/pulls/7/reviews'): VcsCommand => cmd({ endpoint, json: JSON.stringify(json) });
    const review = { event: 'COMMENT', body: 'x', commit_id: SHA, comments: [{ path: 'a', body: 'b', line: 3, side: 'RIGHT' }] };

    it('accepts a review, a file comment and a pull request', () => {
      expect(() => validateGitHubCommand(base(review))).not.toThrow();
      expect(() => validateGitHubCommand(base({ ...review, event: 'REQUEST_CHANGES' }))).not.toThrow();
      expect(() => validateGitHubCommand(base({ body: 'b', commit_id: SHA, path: 'a', subject_type: 'file' }, 'repos/acme/app/pulls/7/comments'))).not.toThrow();
      expect(() => validateGitHubCommand(base({ title: 't', head: 'a/b', base: 'main', body: '' }, 'repos/acme/app/pulls'))).not.toThrow();
    });

    const refused: [string, unknown, string?][] = [
      ['approving', { ...review, event: 'APPROVE' }],
      ['a pending review with no event', { body: 'x', commit_id: SHA, comments: [] }],
      ['a key that is not in the review', { ...review, draft: true }],
      ['a comment with a position that is not a line', { ...review, comments: [{ path: 'a', body: 'b', line: 0, side: 'RIGHT' }] }],
      ['a comment on a side that is not one', { ...review, comments: [{ path: 'a', body: 'b', line: 3, side: 'UP' }] }],
      ['a range that ends before it starts', { ...review, comments: [{ path: 'a', body: 'b', line: 3, side: 'RIGHT', start_line: 3, start_side: 'RIGHT' }] }],
      ['a range that starts on the other side', { ...review, comments: [{ path: 'a', body: 'b', line: 3, side: 'RIGHT', start_line: 1, start_side: 'LEFT' }] }],
      ['a comment key that is not allowed', { ...review, comments: [{ path: 'a', body: 'b', line: 3, side: 'RIGHT', position: 4 }] }],
      ['a commit that is not a hash', { ...review, commit_id: 'main' }],
      ['a file comment that is not about a file', { body: 'b', commit_id: SHA, path: 'a', subject_type: 'line' }, 'repos/acme/app/pulls/7/comments'],
      ['a pull request key that is not allowed', { title: 't', head: 'a', base: 'b', body: '', maintainer_can_modify: true }, 'repos/acme/app/pulls'],
      ['a pull request with a head that is not a branch', { title: 't', head: 'a b', base: 'main', body: '' }, 'repos/acme/app/pulls'],
      ['too many comments in one review', { ...review, comments: Array.from({ length: 101 }, () => ({ path: 'a', body: 'b', line: 3, side: 'RIGHT' })) }],
    ];
    it.each(refused)('refuses %s', (_name, body, endpoint) => {
      expect(() => validateGitHubCommand(base(body, endpoint))).toThrow();
    });

    it('still refuses merging, closing and the other pull request endpoints', () => {
      expect(() => validateGitHubCommand(cmd({ method: 'PUT', endpoint: 'repos/acme/app/pulls/7/merge', json: '{}' }))).toThrow();
      expect(() => validateGitHubCommand(cmd({ method: 'POST', endpoint: 'repos/acme/app/pulls/7/reviews/9/events', json: '{"event":"APPROVE"}' }))).toThrow();
      expect(() => validateGitHubCommand(cmd({ method: 'PATCH', endpoint: 'repos/acme/app/pulls/7', json: '{"state":"closed"}' }))).toThrow();
    });
  });

  it('hands the id of what it made back to the caller', async () => {
    const rt = await runtime({ 'POST /api/v3/repos/acme/app/issues/12/comments': { status: 201, json: { id: 9, html_url: 'https://ghe.test/acme/app/issues/12#issuecomment-9' } } });
    const meta: { code?: number; response?: unknown } = {};
    await rt.exec.run(cmd({ endpoint: 'repos/acme/app/issues/12/comments', json: '{"body":"x"}' }), meta);
    expect(meta.response).toEqual({ id: 9, html_url: 'https://ghe.test/acme/app/issues/12#issuecomment-9' });
  });
});

// ---------------------------------------------------------------------------------------------------------------- GitLab

describe('GitLab', () => {
  const REFS = { base_sha: 'b'.repeat(40), start_sha: '5'.repeat(40), head_sha: SHA.padEnd(40, '0') };
  const runtime = async (version: string | null, mr: unknown = { iid: 7, diff_refs: REFS }): Promise<VcsRuntime> => {
    host = await startFakeHost({
      'GET /api/v4/projects/acme%2Fapp/merge_requests/7': { json: mr },
      'GET /api/v4/projects/acme%2Fapp/merge_requests/7/changes': { json: { changes: [{ old_path: 'src/old.ts', new_path: 'src/a.ts', diff: PATCH }, { old_path: 'docs/a.md', new_path: 'docs/a.md', diff: '@@ -1,1 +1,2 @@\n x\n+y\n' }] } },
      'GET /api/v4/version': version ? { json: { version } } : { status: 404, json: {} },
    });
    const s: VcsSettings = { id: 'gl', kind: 'gitlab', host: 'gitlab.test', apiUrl: `${host.url}/api/v4`, user: '', secretRef: 'x', cli: 'glab', preference: 'api', repos: [] };
    return buildRuntime(s, { token: () => 't', env: () => ({}), sleep: noSleep });
  };
  const op = (comments: ReviewComment[], over: Record<string, unknown> = {}) => ({ op: 'submitReview' as const, project: 'acme/app', iid: 7, event: 'request_changes' as const, body: 'General.', commitSha: SHA, comments, ...over });
  const discussion = (fields: Record<string, string>): VcsCommand => ({ vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fapp/merge_requests/7/discussions', fields });
  const at = { 'position[base_sha]': REFS.base_sha, 'position[start_sha]': REFS.start_sha, 'position[head_sha]': REFS.head_sha, 'position[new_path]': 'src/a.ts', 'position[old_path]': 'src/old.ts' };

  it('plans a discussion for each comment, anchored to the three commits of the diff and the line numbers of its side, and the general note last', async () => {
    const rt = await runtime('17.1.0');
    const out = await rt.provider.planWrite(op([line({ line: 11 }), line({ line: 10 }), line({ side: 'old', line: 11, body: 'Removed.' })]));
    expect(out).toEqual([
      // an added line has a new number only
      discussion({ body: 'Body.', ...at, 'position[position_type]': 'text', 'position[new_line]': '11' }),
      // a line that did not change has both
      discussion({ body: 'Body.', ...at, 'position[position_type]': 'text', 'position[new_line]': '10', 'position[old_line]': '10' }),
      // a removed line has an old number only
      discussion({ body: 'Removed.', ...at, 'position[position_type]': 'text', 'position[old_line]': '11' }),
      { vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fapp/merge_requests/7/notes', fields: { body: 'General.' } },
    ]);
    for (const c of out) expect(() => validateGitLabCommand(c)).not.toThrow();
  });

  it('puts a comment on a whole file on the file where the host can, and on the first line the change touches (saying so) where it cannot', async () => {
    const withFiles = await runtime('17.0.2');
    const [file] = await withFiles.provider.planWrite(op([line({ path: 'docs/a.md', line: null, body: 'About it.' })]));
    expect(file.fields).toMatchObject({ body: 'About it.', 'position[position_type]': 'file', 'position[new_path]': 'docs/a.md' });
    expect(file.fields['position[new_line]']).toBeUndefined();
    await host?.close();
    for (const version of ['16.2.0', null]) {
      const without = await runtime(version);
      const [fallback] = await without.provider.planWrite(op([line({ path: 'docs/a.md', line: null, body: 'About it.' })]));
      expect(fallback.fields).toMatchObject({ 'position[position_type]': 'text', 'position[new_line]': '2' });
      expect(fallback.fields.body).toBe('Este comentário é sobre o arquivo inteiro.\n\nAbout it.');
      expect(() => validateGitLabCommand(fallback)).not.toThrow();
      await host?.close();
    }
  });

  it('knows the version that answers a comment on a file', () => {
    expect(GITLAB_FILE_COMMENTS_SINCE).toEqual([16, 10]);
    expect(versionAtLeast('16.10.0-ee', GITLAB_FILE_COMMENTS_SINCE)).toBe(true);
    expect(versionAtLeast('17.0.1', GITLAB_FILE_COMMENTS_SINCE)).toBe(true);
    expect(versionAtLeast('16.9.9', GITLAB_FILE_COMMENTS_SINCE)).toBe(false);
    expect(versionAtLeast('', GITLAB_FILE_COMMENTS_SINCE)).toBe(false);
  });

  it('refuses to place a review on a head that moved, on a diff that does not exist, and on a file or line that is not in it', async () => {
    const rt = await runtime('17.1.0');
    await expect(rt.provider.planWrite(op([line({})], { commitSha: 'ffff000' }))).rejects.toMatchObject({ code: 'invalid' });
    await host?.close();
    const empty = await runtime('17.1.0', { iid: 7, diff_refs: null });
    await expect(empty.provider.planWrite(op([line({})]))).rejects.toMatchObject({ code: 'unsupported' });
    await host?.close();
    const rt2 = await runtime('17.1.0');
    await expect(rt2.provider.planWrite(op([line({ path: 'src/gone.ts' })]))).rejects.toMatchObject({ code: 'invalid' });
    await expect(rt2.provider.planWrite(op([line({ line: 99 })]))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('builds the position of a line by itself', () => {
    const file = { old_path: 'a', new_path: 'a', diff: PATCH };
    expect(positionFields(REFS, file, { path: 'a', line: 13, side: 'new' }, true)).toMatchObject({ 'position[new_line]': '13', 'position[old_line]': '12' });
  });

  it('plans the edit of a note of the MR and the MR itself', async () => {
    const rt = await runtime('17.1.0');
    expect(await rt.provider.planWrite({ op: 'editMrNote', project: 'acme/app', iid: 7, noteId: 55, body: 'New.' })).toEqual([{ vcs: 'gitlab', via: 'api', method: 'PUT', endpoint: 'projects/acme%2Fapp/merge_requests/7/notes/55', fields: { body: 'New.' } }]);
    const [mr] = await rt.provider.planWrite({ op: 'createMr', project: 'acme/app', title: 'Do it', body: 'Closes #1', sourceBranch: 'cycle/1-do-it', targetBranch: 'main' });
    expect(mr).toEqual({ vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fapp/merge_requests', fields: { source_branch: 'cycle/1-do-it', target_branch: 'main', title: 'Do it', description: 'Closes #1' } });
    expect(() => validateGitLabCommand(mr)).not.toThrow();
  });

  describe('the closed list', () => {
    const post = (fields: Record<string, string>, endpoint = 'projects/acme%2Fapp/merge_requests/7/discussions', over: Partial<VcsCommand> = {}): VcsCommand => ({ vcs: 'gitlab', via: 'glab', method: 'POST', endpoint, fields, ...over });
    const pos = { body: 'x', 'position[position_type]': 'text', 'position[new_path]': 'a', 'position[old_path]': 'a', 'position[head_sha]': SHA, 'position[new_line]': '4' };

    it('accepts a discussion with a position, a note edit and a merge request', () => {
      expect(() => validateGitLabCommand(post(pos))).not.toThrow();
      expect(() => validateGitLabCommand(post({ body: 'x' }))).not.toThrow();
      expect(() => validateGitLabCommand(post({ body: 'x' }, 'projects/acme%2Fapp/merge_requests/7/notes/9', { method: 'PUT' }))).not.toThrow();
      expect(() => validateGitLabCommand(post({ source_branch: 'a', target_branch: 'b', title: 't' }, 'projects/acme%2Fapp/merge_requests'))).not.toThrow();
    });

    const refused: [string, Record<string, string>, string?][] = [
      ['a field that is not a position field', { ...pos, 'position[x_offset]': '3' }],
      ['a discussion with no body', { 'position[position_type]': 'text' }],
      ['a head that is not a hash', { ...pos, 'position[head_sha]': 'main' }],
      ['a line that is not a number', { ...pos, 'position[new_line]': '4; x' }],
      ['a line of zero', { ...pos, 'position[new_line]': '0' }],
      ['a position of another type', { ...pos, 'position[position_type]': 'image' }],
      ['a merge request field that is not allowed', { source_branch: 'a', target_branch: 'b', title: 't', assignee_id: '1' }, 'projects/acme%2Fapp/merge_requests'],
      ['a merge request with no title', { source_branch: 'a', target_branch: 'b' }, 'projects/acme%2Fapp/merge_requests'],
      ['an edit of a note that changes anything but the body', { body: 'x', confidential: 'true' }, 'projects/acme%2Fapp/merge_requests/7/notes/9'],
    ];
    it.each(refused)('refuses %s', (_name, fields, endpoint) => {
      expect(() => validateGitLabCommand(post(fields, endpoint, endpoint?.includes('/notes/') ? { method: 'PUT' } : {}))).toThrow();
    });

    it('refuses a body in JSON and the transports that are not its own', () => {
      expect(() => validateGitLabCommand(post({ body: 'x' }, undefined, { json: '{"body":"x"}' }))).toThrow();
      expect(() => validateGitLabCommand(post({ body: 'x' }, undefined, { via: 'gh' }))).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------- Bitbucket

describe('Bitbucket', () => {
  const runtime = async (): Promise<VcsRuntime> => {
    host = await startFakeHost({ 'GET /2.0/repositories/acme/app/pullrequests/7/diff': { text: `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}` } });
    const s: VcsSettings = { id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', apiUrl: `${host.url}/2.0`, user: '', secretRef: 'x', cli: null, preference: 'api', repos: [] };
    return buildRuntime(s, { token: () => 'a:b', env: () => ({}), sleep: noSleep });
  };
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: '', fields: {}, ...over });
  const U = 'repositories/acme/app/pullrequests/7';

  it('plans an inline comment for each line comment, the general comment, and the request for changes last', async () => {
    const rt = await runtime();
    const out = await rt.provider.planWrite({
      op: 'submitReview',
      project: 'acme/app',
      iid: 7,
      event: 'request_changes',
      body: 'General.',
      commitSha: SHA,
      comments: [line({}), line({ side: 'old', line: 11, body: 'Removed.' }), line({ path: 'src/a.ts', line: null, body: 'About the file.' })],
    });
    expect(out).toEqual([
      cmd({ endpoint: `${U}/comments`, json: JSON.stringify({ content: { raw: 'Body.' }, inline: { path: 'src/a.ts', to: 11 } }) }),
      cmd({ endpoint: `${U}/comments`, json: JSON.stringify({ content: { raw: 'Removed.' }, inline: { path: 'src/a.ts', from: 11 } }) }),
      // a comment on a whole file stands on the first line the change touches (a removed one here), and says so
      cmd({ endpoint: `${U}/comments`, json: JSON.stringify({ content: { raw: 'Este comentário é sobre o arquivo inteiro.\n\nAbout the file.' }, inline: { path: 'src/a.ts', from: 11 } }) }),
      cmd({ endpoint: `${U}/comments`, json: JSON.stringify({ content: { raw: 'General.' } }) }),
      cmd({ endpoint: `${U}/request-changes` }),
    ]);
    for (const c of out) expect(() => validateBitbucketCommand(c)).not.toThrow();
  });

  it('leaves the request for changes out of a plain comment, and refuses a file that is not in the diff', async () => {
    const rt = await runtime();
    const out = await rt.provider.planWrite({ op: 'submitReview', project: 'acme/app', iid: 7, event: 'comment', body: 'Fine.', commitSha: SHA, comments: [] });
    expect(out).toHaveLength(1);
    await expect(rt.provider.planWrite({ op: 'submitReview', project: 'acme/app', iid: 7, event: 'comment', body: 'x', commitSha: SHA, comments: [line({ path: 'src/gone.ts', line: null })] })).rejects.toBeInstanceOf(VcsError);
  });

  it('plans the edit of a comment of the PR and the PR itself', async () => {
    const rt = await runtime();
    expect(await rt.provider.planWrite({ op: 'editMrNote', project: 'acme/app', iid: 7, noteId: 55, body: 'New.' })).toEqual([cmd({ method: 'PUT', endpoint: `${U}/comments/55`, json: '{"content":{"raw":"New."}}' })]);
    const [pr] = await rt.provider.planWrite({ op: 'createMr', project: 'acme/app', title: 'Do it', body: 'Closes #1', sourceBranch: 'cycle/1-do-it', targetBranch: 'main' });
    expect(JSON.parse(pr.json as string)).toEqual({ title: 'Do it', description: 'Closes #1', source: { branch: { name: 'cycle/1-do-it' } }, destination: { branch: { name: 'main' } } });
    expect(() => validateBitbucketCommand(pr)).not.toThrow();
  });

  describe('the closed list', () => {
    const refused: [string, Partial<VcsCommand>][] = [
      ['an inline comment with another key', { endpoint: `${U}/comments`, json: '{"content":{"raw":"x"},"inline":{"path":"a","to":3,"extra":1}}' }],
      ['an inline comment with a line that is not a number', { endpoint: `${U}/comments`, json: '{"content":{"raw":"x"},"inline":{"path":"a","to":"3"}}' }],
      ['an inline comment with no path', { endpoint: `${U}/comments`, json: '{"content":{"raw":"x"},"inline":{"to":3}}' }],
      ['a pull request with a source that is not a branch', { endpoint: 'repositories/acme/app/pullrequests', json: '{"title":"t","source":{"branch":{"name":"a b"}},"destination":{"branch":{"name":"main"}}}' }],
      ['a pull request key that is not allowed', { endpoint: 'repositories/acme/app/pullrequests', json: '{"title":"t","source":{"branch":{"name":"a"}},"destination":{"branch":{"name":"main"}},"reviewers":[]}' }],
      ['approving', { endpoint: `${U}/approve` }],
      ['merging', { endpoint: `${U}/merge`, json: '{}' }],
      ['a body on the request for changes', { endpoint: `${U}/request-changes`, json: '{"x":1}' }],
    ];
    it.each(refused)('refuses %s', (_name, over) => {
      expect(() => validateBitbucketCommand(cmd(over))).toThrow();
    });
  });
});
