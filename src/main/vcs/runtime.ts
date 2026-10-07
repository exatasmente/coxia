import type { CliPreference, VcsKind } from '../../shared/config/types';
import { type BitbucketOptions, createBitbucketProvider } from './bitbucket';
import { VcsError } from './errors';
import { bitbucketExecutor, githubExecutor, gitlabExecutor, type VcsExecutor } from './exec';
import { createGitHubProvider, validateGitHubCommand } from './github';
import { createGitLabProvider, validateGitLabCommand } from './gitlab';
import { type HttpDeps, HttpClient } from './http';
import { type CliRun, apiTransport, cliTransport } from './transport';
import type { VcsProvider } from './types';

// Builds a provider and its executor from one VCS integration of the config. Pure over its inputs (the token, the process
// environment, fetch and the CLI runner come in), so the same code runs against a fake host in the tests.

export interface VcsSettings {
  id: string;
  kind: VcsKind;
  host: string;
  /** API root; empty: derived from the host and the kind. */
  apiUrl: string;
  user: string;
  secretRef: string | null;
  /** The CLI to run (glab, gh), or null when the integration is configured for the API only. */
  cli: string | null;
  preference: CliPreference;
  /** "owner/repo" paths the integration looks things up in when the host has no "my work" query (Bitbucket). */
  repos: string[];
}

export interface RuntimeDeps extends HttpDeps {
  /** The API token of the integration. Throws a VcsError when there is none. */
  token: (s: VcsSettings) => string;
  env: () => NodeJS.ProcessEnv;
  run?: CliRun;
  cliInstalled?: (command: string) => boolean;
  /** The integration has a credential for the API (a secret source, or a token typed for a probe). Default: it names a secretRef. */
  hasToken?: (s: VcsSettings) => boolean;
  timeoutMs?: number;
}

export interface VcsRuntime {
  settings: VcsSettings;
  provider: VcsProvider;
  exec: VcsExecutor;
  /** The HTTP client of the API transport (null when the integration uses its CLI): what the probe reads scopes and rate limits with. */
  api?: HttpClient | null;
}

export function defaultApiUrl(kind: VcsKind, host: string): string {
  if (kind === 'gitlab') return `https://${host}/api/v4`;
  if (kind === 'github') return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  return 'https://api.bitbucket.org/2.0';
}

/** Whether a host name is safe to put in a URL: no scheme, path, port tricks or credentials. */
export function checkHost(host: string): string {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(host)) throw new VcsError('invalid', { detail: host });
  return host;
}

/**
 * Whether an integration talks to its host through the CLI. `cli` always does, `api` never. `auto` follows what the user set up: a token
 * means the API (the user typed one for a reason, possibly for another host than the CLI is logged in to); without one, the CLI when it is
 * installed. Bitbucket has no CLI.
 */
export function useCli(s: VcsSettings, installed: (command: string) => boolean, hasToken: boolean): boolean {
  if (s.kind === 'bitbucket' || !s.cli || s.preference === 'api') return false;
  if (s.preference === 'cli') return true;
  return !hasToken && installed(s.cli);
}

function headersFor(s: VcsSettings, token: () => string): () => Record<string, string> {
  const base = { 'User-Agent': 'Coxia', Accept: 'application/json' };
  if (s.kind === 'gitlab') return () => ({ ...base, 'PRIVATE-TOKEN': token() });
  if (s.kind === 'github') return () => ({ ...base, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token()}` });
  // Bitbucket: "user:app-password" (or "email:api-token") is Basic; a bare repository or workspace access token is Bearer.
  return () => {
    const v = token();
    return { ...base, Authorization: v.includes(':') ? `Basic ${Buffer.from(v).toString('base64')}` : `Bearer ${v}` };
  };
}

export function buildRuntime(s: VcsSettings, deps: RuntimeDeps): VcsRuntime {
  checkHost(s.host);
  const installed = deps.cliInstalled ?? (() => true);
  const cli = useCli(s, installed, (deps.hasToken ?? ((x: VcsSettings) => !!x.secretRef))(s));
  const apiUrl = s.apiUrl || defaultApiUrl(s.kind, s.host);
  const http = (baseUrl: string) =>
    new HttpClient({ host: s.host, baseUrl, headers: headersFor(s, () => deps.token(s)), timeoutMs: deps.timeoutMs, deps: { fetch: deps.fetch, sleep: deps.sleep, now: deps.now } });
  const client = cli ? null : http(apiUrl);
  const graphqlBase = (): string => new URL('..', apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString();
  const graphqlClient = cli || s.kind === 'bitbucket' ? null : http(graphqlBase());

  if (s.kind === 'gitlab') {
    const env = () => ({ ...deps.env(), GITLAB_HOST: s.host });
    const transport = cli
      ? cliTransport({ command: s.cli as string, host: s.host, env, run: deps.run })
      : apiTransport(client as HttpClient, graphqlClient ? { client: graphqlClient, path: 'graphql' } : null);
    return {
      settings: s,
      api: client,
      provider: createGitLabProvider({ id: s.id, host: s.host, transport }),
      exec: gitlabExecutor({ host: s.host, command: s.cli, env, run: deps.run, client, graphqlClient, validate: validateGitLabCommand }),
    };
  }
  if (s.kind === 'github') {
    const env = () => (s.host === 'github.com' ? deps.env() : { ...deps.env(), GH_HOST: s.host });
    const transport = cli
      ? cliTransport({ command: s.cli as string, host: s.host, env, run: deps.run })
      : apiTransport(client as HttpClient, graphqlClient ? { client: graphqlClient, path: 'graphql' } : null);
    return {
      settings: s,
      api: client,
      provider: createGitHubProvider({ id: s.id, host: s.host, transport, token: () => ((deps.hasToken ?? ((x: VcsSettings) => !!x.secretRef))(s) ? deps.token(s) : null) }),
      exec: githubExecutor({ host: s.host, command: s.cli, env, run: deps.run, client, graphqlClient, validate: validateGitHubCommand }),
    };
  }
  const options: BitbucketOptions = { id: s.id, host: s.host, client: client as HttpClient, repos: s.repos };
  const provider = createBitbucketProvider(options);
  return { settings: s, api: client, provider, exec: bitbucketExecutor({ client: client as HttpClient, validate: provider.validateCommand }) };
}
