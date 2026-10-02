import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VcsCommand } from '../src/shared/types';
import { buildRuntime } from '../src/main/vcs/runtime';
import type { CliRun } from '../src/main/vcs/transport';
import { GITLAB_SETTINGS, fakeGitlabRuntime } from './helpers/vcs';

// The write path: a module proposes, the user confirms, the executor runs, the audit log records. Nothing else reaches the host.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-vcs-writes-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

const gl = (over: Partial<VcsCommand> = {}): VcsCommand => ({ via: 'glab', method: 'POST', endpoint: 'projects/sz4%2Fsz4/issues/15499/notes', fields: { body: 'hello' }, ...over });
const input = (command: VcsCommand, key = 'k1') => ({ key, issue: 15499, issueTitle: 'Issue', summary: 'Comment', command });

let ran: { command: VcsCommand }[];
let failWith: Error | null;

beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  asReal(false);
  ran = [];
  failWith = null;
  setVcsRuntimeForTests(
    fakeGitlabRuntime(async () => ({}), undefined, async (command, meta) => {
      ran.push({ command });
      if (failWith) throw failWith;
      if (meta) meta.code = 201;
      return 'ok';
    }),
  );
});

afterAll(() => {
  rmSync(DATA, { recursive: true, force: true });
});

describe('proposing', () => {
  it('stores a pending action and runs nothing', () => {
    const a = actions.proposeVcsAction(input(gl()));
    expect(a).toMatchObject({ kind: 'gitlab', state: 'pending', issue: 15499, summary: 'Comment' });
    expect(a?.command).toEqual(gl());
    expect(a?.output).toContain('POST projects/sz4%2Fsz4/issues/15499/notes  (via glab)');
    expect(ran).toHaveLength(0);
    expect(actions.listActions()).toHaveLength(1);
  });

  it('keeps the old name working and deduplicates by key', () => {
    expect(actions.proposeGitlabAction(input(gl()))).not.toBeNull();
    expect(actions.proposeVcsAction(input(gl()))).toBeNull();
    expect(actions.listActions()).toHaveLength(1);
  });

  it('files a GitHub or Bitbucket write as a "vcs" action and shows its body', () => {
    const a = actions.proposeVcsAction(input({ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/1/comments', fields: {}, json: '{"body":"hi"}' }));
    expect(a?.kind).toBe('vcs');
    expect(a?.output).toContain('body = {"body":"hi"}');
    const b = actions.proposeVcsAction(input({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/issues/1/comments', fields: {}, json: '{"content":{"raw":"x"}}' }, 'k2'));
    expect(b?.kind).toBe('vcs');
  });

  it('refuses a command its provider would never run, before it is stored', () => {
    expect(() => actions.proposeVcsAction(input(gl({ endpoint: 'user' })))).toThrow(/endpoint inválido/);
    expect(() => actions.proposeVcsAction(input({ vcs: 'github', via: 'api', method: 'PUT', endpoint: 'repos/acme/app/pulls/1/merge', fields: {}, json: '{}' }))).toThrow(/endpoint inválido/);
    expect(() => actions.proposeVcsAction(input({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/pullrequests/1/merge', fields: {} }))).toThrow(/endpoint inválido/);
    expect(actions.listActions()).toHaveLength(0);
  });

  it('turns a planned write with several commands into one proposal each', () => {
    const made = actions.proposeVcsCommands(
      { key: 'labels:12', issue: 12, summary: 'Labels' },
      [
        { vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/12/labels', fields: {}, json: '{"labels":["a"]}' },
        { vcs: 'github', via: 'api', method: 'DELETE', endpoint: 'repos/acme/app/issues/12/labels/b', fields: {} },
      ],
    );
    expect(made.map((a) => a?.key)).toEqual(['labels:12', 'labels:12#2']);
  });
});

describe('confirming', () => {
  it('runs the command the proposal holds, once, and records one audit line', async () => {
    const a = actions.proposeVcsAction(input(gl())) as { id: string };
    const done = await actions.approveAction(a.id);
    expect(done.state).toBe('done');
    expect(ran).toEqual([{ command: gl() }]);
    const [line] = listAudit();
    expect(line).toMatchObject({ kind: 'gitlab', target: 'POST projects/sz4%2Fsz4/issues/15499/notes', via: 'glab', fields: { body: 'hello' }, ok: true, code: 201, issue: 15499 });
    expect(line.origin).toMatchObject({ actionId: a.id, key: 'k1' });
    await expect(actions.approveAction(a.id)).rejects.toThrow(/já foi tratada/);
    expect(ran).toHaveLength(1);
  });

  it('audits GraphQL as graphql and a GitHub write under its own name, with the JSON body', async () => {
    const mutation = 'mutation { workItemUpdate(input: { id: "gid://gitlab/WorkItem/5001", statusWidget: { status: "gid://gitlab/WorkItems::Statuses::Custom::Status/77" } }) { errors } }';
    const a = actions.proposeVcsAction(input(gl({ endpoint: 'graphql', fields: { query: mutation } }), 'q')) as { id: string };
    await actions.approveAction(a.id);
    expect(listAudit()[0]).toMatchObject({ kind: 'graphql', target: 'POST graphql' });
  });

  it('records a failure with the status code and leaves the action failed', async () => {
    const { VcsError } = await import('../src/main/vcs/errors');
    failWith = new VcsError('forbidden', { host: 'h', status: 403, detail: 'insufficient_scope' }, { status: 403 });
    const a = actions.proposeVcsAction(input(gl())) as { id: string };
    const done = await actions.approveAction(a.id);
    expect(done.state).toBe('failed');
    expect(done.output).toContain('insufficient_scope');
    expect(listAudit()[0]).toMatchObject({ ok: false, code: 403 });
  });

  it('never lets a token reach the audit file, even echoed in an error', async () => {
    failWith = new Error('request failed: PRIVATE-TOKEN: glpat-abcdefghij0123456789 and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and Authorization: Bearer abcdef0123456789');
    const a = actions.proposeVcsAction(input(gl())) as { id: string };
    await actions.approveAction(a.id);
    const file = readFileSync(join(ATAS, 'auditoria.jsonl'), 'utf8');
    expect(file).not.toMatch(/glpat-abcdef|ghp_abcdef|abcdef0123456789/);
  });

  it('refuses in a test workspace and runs nothing', async () => {
    const a = actions.proposeVcsAction(input(gl())) as { id: string };
    asReal(true);
    await expect(actions.approveAction(a.id)).rejects.toThrow(/Workspace de testes/);
    expect(ran).toHaveLength(0);
    expect(listAudit()).toHaveLength(0);
  });

  it('judges a stored command again before it runs: an edited file cannot widen what is written', async () => {
    const calls: string[][] = [];
    const run: CliRun = async (_f, args) => {
      calls.push(args);
      return '{}';
    };
    setVcsRuntimeForTests(buildRuntime(GITLAB_SETTINGS, { token: () => 't', env: () => ({}), run }));
    const a = actions.proposeVcsAction(input(gl())) as { id: string };
    const file = join(ATAS, 'acoes.json');
    const store = JSON.parse(readFileSync(file, 'utf8'));
    store.actions[0].command.endpoint = 'projects/sz4%2Fsz4/repository/files/x/../../../../../../user';
    writeFileSync(file, JSON.stringify(store));
    const done = await actions.approveAction(a.id);
    expect(done.state).toBe('failed');
    expect(done.output).toMatch(/endpoint inválido/);
    expect(calls).toHaveLength(0);
  });

  it('fails clearly when the command belongs to a host this workspace has no integration for', async () => {
    const a = actions.proposeVcsAction(input({ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/1/comments', fields: {}, json: '{"body":"x"}' })) as { id: string };
    setVcsRuntimeForTests(null);
    const done = await actions.approveAction(a.id);
    expect(done.state).toBe('failed');
    expect(done.output).toMatch(/github/);
  });

  it('edits the QA note through the provider, audited as a note edit', async () => {
    const file = join(ATAS, 'acoes.json');
    const base = actions.proposeVcsAction(input(gl(), 'seed')) as { id: string };
    const store = JSON.parse(readFileSync(file, 'utf8'));
    store.actions[0] = { ...store.actions[0], id: 'qa1', key: 'qa-comment:1', kind: 'qa-comment', command: null, noteId: 903, proposedBody: 'New body\nsecond line', currentBody: 'old', state: 'pending' };
    writeFileSync(file, JSON.stringify(store));
    expect(base.id).not.toBe('qa1');
    const done = await actions.approveAction('qa1');
    expect(done.state).toBe('done');
    expect(ran[0].command).toMatchObject({ vcs: 'gitlab', via: 'glab', method: 'PUT', endpoint: 'projects/1/issues/15499/notes/903', fields: { body: 'New body\nsecond line' } });
    expect(listAudit()[0]).toMatchObject({ kind: 'note-edit', target: 'PUT projects/1/issues/15499/notes/903', via: 'glab' });
  });
});

describe('the only door', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
    });
  const src = join(import.meta.dirname, '..', 'src');
  const read = (p: string) => readFileSync(p, 'utf8');

  it('only the runtime builder imports the executors, and only actions.ts calls them', () => {
    const importers = files(src).filter((f) => /from '(\.\/|\.\.\/vcs\/)exec'/.test(read(f)) || /from '\.\/vcs\/exec'/.test(read(f)));
    expect(importers.map((f) => f.replace(src, ''))).toEqual(['/main/vcs/runtime.ts']);
    const callers = files(src).filter((f) => /\.exec\.run\(/.test(read(f)));
    expect(callers.map((f) => f.replace(src, ''))).toEqual(['/main/actions.ts']);
  });

  it('no module outside the vcs folder runs glab or gh itself', () => {
    const offenders = files(join(src, 'main'))
      .filter((f) => !f.includes('/main/vcs/'))
      .filter((f) => /(execFile|exec|run|spawn)\(\s*['"](glab|gh)['"]/.test(read(f)))
      .map((f) => f.replace(src, ''));
    expect(offenders).toEqual([]);
  });

  it('a provider has no method that writes: planning only', async () => {
    const { vcsProvider } = await import('../src/main/vcs');
    const names = Object.keys(vcsProvider());
    expect(names.filter((n) => /^(post|put|patch|delete|create|update|write|exec|run|approve|merge|push)/i.test(n))).toEqual([]);
  });
});
