import { createGitLabProvider, validateGitLabCommand } from '../../src/main/vcs/gitlab';
import { type VcsRuntime, type VcsSettings } from '../../src/main/vcs/runtime';
import { type RestTransport, pagesOver } from '../../src/main/vcs/transport';

export const GITLAB_SETTINGS: VcsSettings = {
  id: 'gitlab',
  kind: 'gitlab',
  host: 'git.acme.test',
  apiUrl: '',
  user: '',
  secretRef: null,
  cli: 'glab',
  preference: 'cli',
  repos: [],
};

/** A GitLab transport that answers every read from `handler` (the endpoint exactly as the provider asks for it). */
export function fakeTransport(handler: (endpoint: string) => unknown | Promise<unknown>, graphql: (query: string) => unknown | Promise<unknown> = () => ({ data: null })): RestTransport {
  const get = async (endpoint: string) => handler(endpoint);
  return { kind: 'cli', get: get as RestTransport['get'], graphql: (async (q: string) => graphql(q)) as RestTransport['graphql'], pages: pagesOver(get) };
}

/** A GitLab runtime on a fake transport, for the call sites that go through vcsProvider(). Nothing here can write. */
export function fakeGitlabRuntime(handler: (endpoint: string) => unknown | Promise<unknown>, graphql?: (query: string) => unknown | Promise<unknown>, run: VcsRuntime['exec']['run'] = async () => 'not run'): VcsRuntime {
  return {
    settings: GITLAB_SETTINGS,
    provider: createGitLabProvider({ id: 'gitlab', host: GITLAB_SETTINGS.host, transport: fakeTransport(handler, graphql) }),
    exec: { run },
  };
}

export { validateGitLabCommand };
