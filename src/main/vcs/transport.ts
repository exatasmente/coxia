import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VcsError, scrubSecrets } from './errors';
import type { HttpClient } from './http';

// How a provider reaches its host. The GitLab and GitHub providers speak REST through either of two transports with the same shape:
//   cli  `glab api <endpoint>` / `gh api <endpoint>`: the CLI's own login and host; used for the user who already has the CLI set up.
//   api  fetch with a token from the secrets store.
// Bitbucket Cloud has no CLI and only uses `api`.
// A transport only reads. Writes go through the executors (write.ts), after the confirmation flow.

export interface RestTransport {
  readonly kind: 'cli' | 'api';
  get<T>(path: string, what?: string): Promise<T>;
  /** A GraphQL query (a read). Writes never use this: see the executors. */
  graphql<T>(query: string): Promise<T>;
  /** Page/per_page pagination over `get`. */
  pages<T>(path: string, o?: { perPage?: number; maxPages?: number; pick?: (body: unknown) => T[]; what?: string }): Promise<T[]>;
}

const sep = (path: string): string => (path.includes('?') ? '&' : '?');

export function pagesOver(get: (path: string) => Promise<unknown>): RestTransport['pages'] {
  return async <T>(path: string, o: { perPage?: number; maxPages?: number; pick?: (body: unknown) => T[] } = {}): Promise<T[]> => {
    const perPage = o.perPage ?? 100;
    const out: T[] = [];
    for (let page = 1; page <= (o.maxPages ?? 5); page++) {
      const body = await get(`${path}${sep(path)}per_page=${perPage}&page=${page}`);
      const rows = o.pick ? o.pick(body) : (body as T[]);
      if (!Array.isArray(rows)) break;
      out.push(...rows);
      if (rows.length < perPage) break;
    }
    return out;
  };
}

// ---------------------------------------------------------------- cli

export type CliRun = (file: string, args: string[], o: { env: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer: number }) => Promise<string>;

const execFileP = promisify(execFile);

export const defaultCliRun: CliRun = async (file, args, o) => (await execFileP(file, args, { env: o.env, timeout: o.timeoutMs, maxBuffer: o.maxBuffer })).stdout;

/** Turns a failed CLI call into the same error a failed HTTP call gives. The CLI's own words stay in the detail (and are scrubbed). */
export function cliFailure(e: unknown, command: string, host: string): VcsError {
  const err = e as { code?: string | number; stderr?: string; stdout?: string; message?: string; killed?: boolean };
  if (err.code === 'ENOENT') return new VcsError('cli_missing', { command });
  if (err.killed || err.code === 'ETIMEDOUT') return new VcsError('timeout', { host, seconds: 60 });
  const text = `${err.stderr ?? ''}\n${err.stdout ?? ''}\n${err.message ?? ''}`;
  // "(HTTP 404)" is what glab and gh print; a bare number only counts when its reason phrase follows (a port or an id is not a status).
  const status = Number(/HTTP[ /:]*(\d{3})/i.exec(text)?.[1] ?? /\b(40[1349]|429|50[0-9])\s+(?:Unauthorized|Forbidden|Not Found|Unprocessable|Too Many|Internal Server|Bad Gateway|Service Unavailable|Gateway)/i.exec(text)?.[1] ?? NaN);
  const first = scrubSecrets(text.split('\n').map((l) => l.trim()).find((l) => l && !/^Command failed/i.test(l)) ?? '').slice(0, 200);
  if (/not logged in|auth login|authentication required|no token/i.test(text) || status === 401) return new VcsError('auth', { host, status: 401 }, { status: 401 });
  if (status === 404) return new VcsError('not_found', { host, what: first }, { status });
  if (status === 429) return new VcsError('rate_limited', { host, seconds: 60 }, { status, retryAfterMs: 60_000 });
  if (status === 403) return new VcsError('forbidden', { host, status, detail: first }, { status });
  if (status >= 500) return new VcsError('server', { host, status }, { status });
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|network is unreachable|no such host|dial tcp/i.test(text)) return new VcsError('network', { host, detail: first });
  return new VcsError('invalid', { detail: first || (err.message ?? '').split('\n')[0] });
}

export interface CliTransportOptions {
  command: string;
  host: string;
  env: () => NodeJS.ProcessEnv;
  run?: CliRun;
  timeoutMs?: number;
}

const CLI_TIMEOUT_MS = 60_000;
const CLI_MAX_BUFFER = 32 * 1024 * 1024;

export function cliTransport(o: CliTransportOptions): RestTransport {
  const run = o.run ?? defaultCliRun;
  const call = async (args: string[]): Promise<string> => {
    try {
      return await run(o.command, args, { env: o.env(), timeoutMs: o.timeoutMs ?? CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER });
    } catch (e) {
      throw cliFailure(e, o.command, o.host);
    }
  };
  const get = async <T>(path: string): Promise<T> => JSON.parse(await call(['api', path])) as T;
  return {
    kind: 'cli',
    get,
    graphql: async <T>(query: string): Promise<T> => {
      // i18n-ignore: internal marker of a read-only query
      if (!/^\s*(query\b|\{)/.test(query)) throw new VcsError('invalid', { detail: 'read only' });
      return JSON.parse(await call(['api', 'graphql', '-f', `query=${query}`])) as T;
    },
    pages: pagesOver(get),
  };
}

// ---------------------------------------------------------------- api

export function apiTransport(client: HttpClient, graphqlPath: { client: HttpClient; path: string } | null): RestTransport {
  const get = async <T>(path: string, what?: string): Promise<T> => (await client.request('GET', path, { what })).body as T;
  return {
    kind: 'api',
    get,
    graphql: async <T>(query: string): Promise<T> => {
      if (!graphqlPath) throw new VcsError('unsupported', { kind: client.host, what: 'GraphQL' });
      // i18n-ignore: internal marker of a read-only query
      if (!/^\s*(query\b|\{)/.test(query)) throw new VcsError('invalid', { detail: 'read only' });
      // A POST that only reads: safe to retry.
      return (await graphqlPath.client.request('POST', graphqlPath.path, { json: { query }, idempotent: true })).body as T;
    },
    pages: pagesOver(get),
  };
}
