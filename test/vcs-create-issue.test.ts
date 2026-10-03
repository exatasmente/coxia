// The new issue a squad's request turns into, on each of the three hosts: the command planned (with the labels the issue is born with where the host has
// them) and what each provider's closed list of writes accepts and refuses.
import { afterEach, describe, expect, it } from 'vitest';
import { validateBitbucketCommand } from '../src/main/vcs/bitbucket';
import { VcsError } from '../src/main/vcs/errors';
import { validateGitHubCommand } from '../src/main/vcs/github';
import { validateGitLabCommand } from '../src/main/vcs/gitlab';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import type { VcsCommand, VcsWriteOp } from '../src/main/vcs/types';
import { type FakeHost, noSleep, startFakeHost } from './helpers/fakeHost';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

const make = async (settings: Omit<VcsSettings, 'apiUrl'>, path: string, token = 't'): Promise<VcsRuntime> => {
  host = await startFakeHost({});
  return buildRuntime({ ...settings, apiUrl: `${host.url}${path}` }, { token: () => token, env: () => ({}), sleep: noSleep });
};
const create = (over: Partial<Extract<VcsWriteOp, { op: 'createIssue' }>> = {}): VcsWriteOp => ({ op: 'createIssue', project: 'acme/app', title: 'Expose the totals', body: 'Squad A needs them.', labels: ['squad-b'], ...over });

describe('GitHub', () => {
  const runtime = (): Promise<VcsRuntime> => make({ id: 'gh', kind: 'github', host: 'ghe.test', user: '', secretRef: 'x', cli: 'gh', preference: 'api', repos: [] }, '/api/v3');
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues', fields: {}, ...over });

  it('plans one POST with the title, the description and the labels', async () => {
    const rt = await runtime();
    const [issue] = await rt.provider.planWrite(create());
    expect(issue).toEqual(cmd({ json: JSON.stringify({ title: 'Expose the totals', body: 'Squad A needs them.', labels: ['squad-b'] }) }));
    expect(() => validateGitHubCommand(issue)).not.toThrow();
    // no labels: the key is left out; the title is one line
    const [bare] = await rt.provider.planWrite(create({ labels: [], title: '  Expose\nthe   totals ' }));
    expect(JSON.parse(bare.json as string)).toEqual({ title: 'Expose the totals', body: 'Squad A needs them.' });
  });

  it('refuses what is not a title, a label or a repository path', async () => {
    const rt = await runtime();
    await expect(rt.provider.planWrite(create({ title: '   ' }))).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.planWrite(create({ title: 'x'.repeat(300) }))).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.planWrite(create({ labels: ['a,b'] }))).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.planWrite(create({ project: '../x/y' }))).rejects.toBeInstanceOf(VcsError);
  });

  it('accepts only that shape: no other key, no missing title, a title that is text, labels that are text, and not the address of an issue or its comments', () => {
    const ok = { title: 't', body: 'b' };
    expect(() => validateGitHubCommand(cmd({ json: JSON.stringify(ok) }))).not.toThrow();
    expect(() => validateGitHubCommand(cmd({ json: JSON.stringify({ ...ok, labels: ['x'] }) }))).not.toThrow();
    const refused: [string, Partial<VcsCommand>][] = [
      ['another key', { json: JSON.stringify({ ...ok, assignees: ['x'] }) }],
      ['a missing description', { json: JSON.stringify({ title: 't' }) }],
      ['a title that is not text', { json: JSON.stringify({ title: 3, body: 'b' }) }],
      ['an empty title', { json: JSON.stringify({ title: '  ', body: 'b' }) }],
      ['labels that are not text', { json: JSON.stringify({ ...ok, labels: [3] }) }],
      ['a form instead of JSON', { fields: { title: 't' } }],
      ['another transport', { via: 'glab' as VcsCommand['via'] }],
      ['the wrong method', { method: 'PUT' }],
      ['an issue that exists', { endpoint: 'repos/acme/app/issues/12', json: JSON.stringify(ok) }],
      ['a path that leaves the repository', { endpoint: 'repos/acme/../issues', json: JSON.stringify(ok) }],
    ];
    for (const [name, over] of refused) expect(() => validateGitHubCommand(cmd({ json: JSON.stringify(ok), ...over })), name).toThrow();
  });
});

describe('GitLab', () => {
  const runtime = (): Promise<VcsRuntime> => make({ id: 'gl', kind: 'gitlab', host: 'gitlab.test', user: '', secretRef: 'x', cli: 'glab', preference: 'api', repos: [] }, '/api/v4');
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fapp/issues', fields: {}, ...over });

  it('plans one POST with the title, the description and the labels joined by commas', async () => {
    const rt = await runtime();
    const [issue] = await rt.provider.planWrite(create({ labels: ['squad-b', 'needs triage'] }));
    expect(issue).toEqual(cmd({ fields: { title: 'Expose the totals', description: 'Squad A needs them.', labels: 'squad-b,needs triage' } }));
    expect(() => validateGitLabCommand(issue)).not.toThrow();
    const [bare] = await rt.provider.planWrite(create({ labels: [] }));
    expect(bare.fields).toEqual({ title: 'Expose the totals', description: 'Squad A needs them.' });
    // the transport the person's own CLI would use is accepted too
    expect(() => validateGitLabCommand({ ...issue, via: 'glab' })).not.toThrow();
  });

  it('refuses a label with a comma (it would become two) and a title with nothing in it', async () => {
    const rt = await runtime();
    await expect(rt.provider.planWrite(create({ labels: ['a,b'] }))).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.planWrite(create({ title: ' ' }))).rejects.toBeInstanceOf(VcsError);
  });

  it('accepts only that shape: title, description and labels, nothing else', () => {
    expect(() => validateGitLabCommand(cmd({ fields: { title: 't' } }))).not.toThrow();
    const refused: [string, Partial<VcsCommand>][] = [
      ['another field', { fields: { title: 't', assignee_id: '1' } }],
      ['a missing title', { fields: { description: 'd' } }],
      ['an empty title', { fields: { title: '  ' } }],
      ['empty labels', { fields: { title: 't', labels: ' ' } }],
      ['a body in JSON', { fields: { title: 't' }, json: '{"title":"t"}' }],
      ['another transport', { fields: { title: 't' }, via: 'gh' as VcsCommand['via'] }],
    ];
    for (const [name, over] of refused) expect(() => validateGitLabCommand(cmd(over)), name).toThrow();
  });
});

describe('Bitbucket', () => {
  const runtime = (): Promise<VcsRuntime> => make({ id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', user: '', secretRef: 'x', cli: null, preference: 'api', repos: [] }, '/2.0', 'a:b');
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/issues', fields: {}, ...over });

  it('plans one POST with the title and the description, and leaves the labels out: its issues have none', async () => {
    const rt = await runtime();
    const [issue] = await rt.provider.planWrite(create());
    expect(issue).toEqual(cmd({ json: JSON.stringify({ title: 'Expose the totals', content: { raw: 'Squad A needs them.' } }) }));
    expect(() => validateBitbucketCommand(issue)).not.toThrow();
    await expect(rt.provider.planWrite(create({ title: '' }))).rejects.toBeInstanceOf(VcsError);
  });

  it('accepts only that shape', () => {
    const ok = { title: 't', content: { raw: 'b' } };
    expect(() => validateBitbucketCommand(cmd({ json: JSON.stringify(ok) }))).not.toThrow();
    const refused: [string, Partial<VcsCommand>][] = [
      ['another key', { json: JSON.stringify({ ...ok, priority: 'major' }) }],
      ['a missing description', { json: JSON.stringify({ title: 't' }) }],
      ['a description that is not raw text', { json: JSON.stringify({ title: 't', content: 'b' }) }],
      ['an empty title', { json: JSON.stringify({ title: ' ', content: { raw: 'b' } }) }],
      ['an issue that exists', { endpoint: 'repositories/acme/app/issues/12' }],
    ];
    for (const [name, over] of refused) expect(() => validateBitbucketCommand(cmd({ json: JSON.stringify(ok), ...over })), name).toThrow();
  });
});
