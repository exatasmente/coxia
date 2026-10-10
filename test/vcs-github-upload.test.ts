import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VcsError } from '../src/main/vcs/errors';
import { type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import type { CliRun } from '../src/main/vcs/transport';
import type { ExecMeta, VcsCommand } from '../src/main/vcs/types';
import { GITLAB_SETTINGS } from './helpers/vcs';

// An upload of evidence to GitHub under each preference: the file goes by the API client (the uploads host is another origin than the API root, and `gh api`
// does not take it), with the token in the client's headers; a workspace on the CLI gets it only when a token is set, and says so plainly when it has none.
// Fake fetch and fake CLI: no network, no real host.

const TOKEN = 'TESTTOKEN-github-not-real-0002';
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(String(dirs.pop()), { recursive: true, force: true });
});

const settings = (over: Partial<VcsSettings> = {}): VcsSettings => ({ id: 'gh', kind: 'github', host: 'github.com', apiUrl: '', user: '', secretRef: 'gh.token', cli: 'gh', preference: 'cli', repos: [], ...over });

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
}

function fakeFetch(seen: Seen[], answer: () => Response = () => new Response(JSON.stringify({ url: 'https://example.test/assets/ev-1.png' }), { status: 201, headers: { 'content-type': 'application/json' } })): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), method: String(init.method), headers: init.headers as Record<string, string>, body: Buffer.from(init.body as Buffer) });
    return answer();
  }) as unknown as typeof fetch;
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-gh-upload-'));
  dirs.push(dir);
  const at = join(dir, 'ev-1.png');
  writeFileSync(at, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  return at;
}

const upload = (path: string) => ({ op: 'uploadAttachment', project: 'acme/app', path, name: 'ev-1.png', media: 'image/png' }) as const;

/** A CLI that fails the test if it is ever asked to run: the upload must not go through `gh`, and the token must never be on a command line. */
const noCli = (calls: string[][]): CliRun => async (_file, args) => {
  calls.push(args);
  throw new Error('the CLI must not be used for an upload');
};

describe('a GitHub workspace on the CLI preference with a token set', () => {
  it('uploads the file by the API client, to the uploads host, with the token in the headers', async () => {
    const seen: Seen[] = [];
    const calls: string[][] = [];
    const rt = buildRuntime(settings(), { token: () => TOKEN, env: () => ({}), fetch: fakeFetch(seen), run: noCli(calls) });
    const [cmd] = await rt.provider.planWrite(upload(fixture()));
    expect(cmd).toMatchObject({ via: 'api', method: 'POST', bodyFile: expect.any(String) });
    const meta: ExecMeta = {};
    await rt.exec.run(cmd, meta);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(/^https:\/\/uploads\.github\.com\/\?repository_id=acme%2Fapp&name=ev-1\.png&content_type=image%2Fpng$/);
    expect(seen[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].headers['Content-Type']).toBe('image/png');
    expect([...seen[0].body]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(meta).toMatchObject({ code: 201, response: { url: 'https://example.test/assets/ev-1.png' } });
    // The CLI was never run, so the token was on no command line.
    expect(calls).toEqual([]);
  });

  it('still posts every other write through the CLI', async () => {
    const calls: string[][] = [];
    const run: CliRun = async (_file, args) => {
      calls.push(args);
      return JSON.stringify({ number: 5 });
    };
    const rt = buildRuntime(settings(), { token: () => TOKEN, env: () => ({}), fetch: fakeFetch([]), run });
    const [cmd] = await rt.provider.planWrite({ op: 'commentIssue', project: 'acme/app', iid: 1, body: 'hi' });
    expect(cmd.via).toBe('gh');
    await rt.exec.run(cmd);
    expect(calls).toHaveLength(1);
    expect(calls[0].join(' ')).not.toContain(TOKEN);
  });
});

describe('a GitHub workspace on the CLI preference with no token', () => {
  const noToken = () =>
    buildRuntime(settings({ secretRef: null }), {
      token: () => {
        throw new VcsError('no_token', { id: 'gh', ref: '' });
      },
      env: () => ({}),
      fetch: fakeFetch([]),
      run: noCli([]),
    });

  it('plans nothing and names the real cause, not a missing integration', async () => {
    const err = await noToken().provider.planWrite(upload(fixture())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VcsError);
    expect((err as VcsError).code).toBe('upload_needs_api');
    expect((err as VcsError).message).toMatch(/CLI/);
    expect((err as VcsError).message).not.toMatch(/no GitHub integration|não tem uma integração/);
  });

  it('says the same when an upload planned elsewhere reaches the executor', async () => {
    const rt = noToken();
    const cmd: VcsCommand = { vcs: 'github', via: 'api', method: 'POST', endpoint: 'uploads.github.com/?repository_id=acme%2Fapp&name=ev-1.png&content_type=image%2Fpng', fields: {}, headers: { 'Content-Type': 'image/png' }, bodyFile: fixture() };
    await expect(rt.exec.run(cmd)).rejects.toMatchObject({ code: 'upload_needs_api' });
  });

  it('keeps not_configured for a write that really has no client', async () => {
    const rt = noToken();
    const cmd: VcsCommand = { vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/1/comments', fields: {}, json: '{"body":"x"}' };
    await expect(rt.exec.run(cmd)).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('the API preference', () => {
  it('uploads the file the same way: to the uploads host, with the token', async () => {
    const seen: Seen[] = [];
    const rt = buildRuntime(settings({ preference: 'api' }), { token: () => TOKEN, env: () => ({}), fetch: fakeFetch(seen) });
    const [cmd] = await rt.provider.planWrite(upload(fixture()));
    await rt.exec.run(cmd);
    expect(seen.map((s) => new URL(s.url).host)).toEqual(['uploads.github.com']);
    expect(seen[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('reports a refusal of the host as the host\'s, not as a missing integration', async () => {
    const rt = buildRuntime(settings({ preference: 'api' }), { token: () => TOKEN, env: () => ({}), fetch: fakeFetch([], () => new Response('{"message":"Bad credentials"}', { status: 401, headers: { 'content-type': 'application/json' } })) });
    const [cmd] = await rt.provider.planWrite(upload(fixture()));
    await expect(rt.exec.run(cmd)).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('a GitHub Enterprise host', () => {
  it('plans no upload (the uploads host named is github.com\'s, and the token must not go there)', async () => {
    const rt = buildRuntime(settings({ host: 'ghe.test', preference: 'api' }), { token: () => TOKEN, env: () => ({}), fetch: fakeFetch([]) });
    await expect(rt.provider.planWrite(upload(fixture()))).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('GitLab on the CLI preference', () => {
  it('still cannot carry the file, and says the real cause instead of a missing integration', async () => {
    const rt = buildRuntime({ ...GITLAB_SETTINGS, secretRef: null }, { token: () => 'unused', env: () => ({}), run: noCli([]) });
    const cmd: VcsCommand = { vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fapp/uploads', fields: {}, headers: { 'Content-Type': 'image/png' }, bodyFile: fixture() };
    await expect(rt.exec.run(cmd)).rejects.toMatchObject({ code: 'upload_needs_api' });
  });
});
