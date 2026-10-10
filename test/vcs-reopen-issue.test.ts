// Reopening an issue, the write the board uses to undo its own close: planned by the three providers and accepted by each validator in that shape only.
import { afterEach, describe, expect, it } from 'vitest';
import { validateBitbucketCommand } from '../src/main/vcs/bitbucket';
import { VcsError } from '../src/main/vcs/errors';
import { validateGitHubCommand } from '../src/main/vcs/github';
import { validateGitLabCommand } from '../src/main/vcs/gitlab';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import { type FakeHost, noSleep, startFakeHost } from './helpers/fakeHost';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

async function make(settings: Omit<VcsSettings, 'apiUrl'>, path: string): Promise<VcsRuntime> {
  host = await startFakeHost({});
  return buildRuntime({ ...settings, apiUrl: `${host.url}${path}` }, { token: () => 't', env: () => ({}), sleep: noSleep });
}

const GH: Omit<VcsSettings, 'apiUrl'> = { id: 'gh', kind: 'github', host: 'ghe.test', user: '', secretRef: 'x', cli: 'gh', preference: 'api', repos: [] };
const GL: Omit<VcsSettings, 'apiUrl'> = { id: 'gl', kind: 'gitlab', host: 'gitlab.test', user: '', secretRef: 'x', cli: 'glab', preference: 'api', repos: [] };
const BB: Omit<VcsSettings, 'apiUrl'> = { id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', user: 'ana', secretRef: 'x', cli: null, preference: 'api', repos: ['acme/app'] };

describe('reopenIssue', () => {
  it('GitHub: one PATCH of the open state, accepted by the validator and by nothing wider', async () => {
    const rt = await make(GH, '/api/v3');
    const [reopen] = await rt.provider.planWrite({ op: 'reopenIssue', project: 'acme/app', iid: 12 });
    expect(reopen).toEqual({ vcs: 'github', via: 'api', method: 'PATCH', endpoint: 'repos/acme/app/issues/12', fields: {}, json: '{"state":"open"}' });
    expect(() => validateGitHubCommand(reopen)).not.toThrow();
    expect(() => validateGitHubCommand({ ...reopen, json: '{"state":"open","title":"x"}' })).toThrow();
    expect(() => validateGitHubCommand({ ...reopen, json: '{"state":"reopened"}' })).toThrow();
    await expect(rt.provider.planWrite({ op: 'reopenIssue', project: 'acme/app', iid: 0 })).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
  });

  it('GitLab: one PUT with the reopen state event, accepted by the validator', async () => {
    const rt = await make(GL, '/api/v4');
    const [reopen] = await rt.provider.planWrite({ op: 'reopenIssue', project: 'acme/app', iid: 12 });
    expect(reopen).toEqual({ vcs: 'gitlab', via: 'api', method: 'PUT', endpoint: 'projects/acme%2Fapp/issues/12', fields: { state_event: 'reopen' } });
    expect(() => validateGitLabCommand(reopen)).not.toThrow();
    await expect(rt.provider.planWrite({ op: 'reopenIssue', project: 'acme/app', iid: -3 })).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
  });

  it('Bitbucket: one PUT of the open state, accepted by the validator and by nothing wider', async () => {
    const rt = await make(BB, '/2.0');
    const [reopen] = await rt.provider.planWrite({ op: 'reopenIssue', project: 'acme/app', iid: 12 });
    expect(reopen).toEqual({ vcs: 'bitbucket', via: 'api', method: 'PUT', endpoint: 'repositories/acme/app/issues/12', fields: {}, json: '{"state":"open"}' });
    expect(() => validateBitbucketCommand(reopen)).not.toThrow();
    expect(() => validateBitbucketCommand({ ...reopen, json: '{"state":"open","title":"x"}' })).toThrow();
    await expect(rt.provider.planWrite({ op: 'reopenIssue', project: 'acme/app', iid: 0 })).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
  });

  it('leaves closeIssue as it was on the three hosts', async () => {
    const gh = await make(GH, '/api/v3');
    expect((await gh.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 12 }))[0]).toMatchObject({ method: 'PATCH', json: '{"state":"closed"}' });
    await host?.close();
    const gl = await make(GL, '/api/v4');
    expect((await gl.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 12 }))[0]).toMatchObject({ method: 'PUT', fields: { state_event: 'close' } });
    await host?.close();
    const bb = await make(BB, '/2.0');
    expect((await bb.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 12 }))[0]).toMatchObject({ method: 'PUT', json: '{"state":"closed"}' });
  });
});
