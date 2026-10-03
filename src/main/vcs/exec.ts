import { execFile } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { t } from '../../shared/i18n';
import type { VcsKind } from '../../shared/config/types';
import { VcsError, scrubSecrets } from './errors';
import type { HttpClient } from './http';
import { type CliRun, cliFailure, defaultCliRun } from './transport';
import type { VcsCommand } from './types';

// The only code that writes to a code host. It runs a command the confirmation flow already approved (approveAction in actions.ts):
// nothing else imports it, and a test keeps it that way. Each executor refuses a command its provider's validator would refuse, so a
// command read back from disk is judged again right before it runs.

export interface ExecMeta {
  /** Filled with the HTTP status when the host answered. */
  code?: number;
  /** Filled with what the host answered, parsed, when it was JSON: the id of the comment or the number of the pull request that was just made. */
  response?: unknown;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface VcsExecutor {
  run(command: VcsCommand, meta?: ExecMeta): Promise<string>;
}

const RESULT_MAX = 2000;
const execP = promisify(execFile);

function withTempFiles<T>(fn: (file: (name: string, content: string) => string) => Promise<T>): Promise<T> {
  const files: string[] = [];
  const make = (name: string, content: string): string => {
    const f = join(tmpdir(), `vcs-${name}-${Date.now()}-${files.length}.txt`);
    writeFileSync(f, content, { mode: 0o600 });
    files.push(f);
    return f;
  };
  return fn(make).finally(() => {
    for (const f of files) {
      try {
        unlinkSync(f);
      } catch {}
    }
  });
}

export interface GitLabExecDeps {
  host: string;
  command: string | null;
  env: () => NodeJS.ProcessEnv;
  run?: CliRun;
  /** API transport. */
  client: HttpClient | null;
  graphqlClient: HttpClient | null;
  validate: (c: VcsCommand) => void;
}

/** GraphQL answers 200 even when the mutation fails; the errors come in the body. */
function graphqlErrors(body: unknown): string[] {
  const b = body as { errors?: unknown[]; data?: Record<string, { errors?: string[] } | null> } | null;
  const inner = Object.values(b?.data ?? {}).flatMap((v) => v?.errors ?? []);
  return [...(b?.errors ?? []).map((e) => JSON.stringify(e)), ...inner].map(String);
}

export function gitlabExecutor(d: GitLabExecDeps): VcsExecutor {
  const run = d.run ?? defaultCliRun;
  const cli = async (args: string[]): Promise<string> => {
    try {
      return await run(d.command ?? 'glab', args, { env: d.env(), timeoutMs: 60_000, maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      throw cliFailure(e, d.command ?? 'glab', d.host);
    }
  };
  return {
    async run(c, meta = {}) {
      d.validate(c);
      if (c.via === 'glab') {
        const args = ['api', '--method', c.method, c.endpoint];
        return withTempFiles(async (file) => {
          for (const [k, v] of Object.entries(c.fields)) {
            if (v.length > 200 || v.includes('\n')) args.push('-F', `${k}=@${file('field', v)}`);
            else args.push('-f', `${k}=${v}`);
          }
          const out = await cli(args);
          if (c.endpoint === 'graphql') {
            const errors = graphqlErrors(JSON.parse(out));
            if (errors.length) throw new Error(t('vcs.exec.refused', { host: d.host, detail: scrubSecrets(errors.join(' ')).slice(0, 500) }));
          }
          meta.response = parsed(out);
          return out.slice(0, RESULT_MAX);
        });
      }
      if (c.via === 'curl') {
        // Array fields such as reviewer_ids[] are rejected by glab (it sends a JSON body): curl with the token glab holds.
        const token = (await execP(d.command ?? 'glab', ['config', 'get', 'token', '--host', d.host])).stdout.trim();
        const args = ['-sS', '-w', '\nHTTP %{http_code}', '-X', c.method, '-H', `PRIVATE-TOKEN: ${token}`];
        for (const [k, v] of Object.entries(c.fields)) args.push('--data-urlencode', `${k}=${v}`);
        args.push(`https://${d.host}/api/v4/${c.endpoint}`);
        const { stdout } = await execP('curl', args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
        const code = /HTTP (\d+)\s*$/.exec(stdout)?.[1];
        if (code) meta.code = Number(code);
        if (!code || Number(code) >= 400) throw new Error(t('vcs.exec.responded', { host: d.host, code: code ?? '?', body: scrubSecrets(stdout).slice(0, 500) }));
        meta.response = parsed(stdout.replace(/\nHTTP \d+\s*$/, ''));
        return stdout.slice(0, RESULT_MAX);
      }
      if (c.via === 'api') {
        if (c.endpoint === 'graphql') {
          if (!d.graphqlClient) throw new VcsError('not_configured', { kind: 'GitLab' });
          const r = await d.graphqlClient.request('POST', 'graphql', { json: { query: c.fields.query } });
          meta.code = r.status;
          const errors = graphqlErrors(r.body);
          if (errors.length) throw new Error(t('vcs.exec.refused', { host: d.host, detail: scrubSecrets(errors.join(' ')).slice(0, 500) }));
          return JSON.stringify(r.body).slice(0, RESULT_MAX);
        }
        if (!d.client) throw new VcsError('not_configured', { kind: 'GitLab' });
        const r = await d.client.request(c.method, c.endpoint, { form: c.fields });
        meta.code = r.status;
        meta.response = r.body;
        return JSON.stringify(r.body).slice(0, RESULT_MAX);
      }
      throw new Error(t('vcs.validate.endpoint', { endpoint: c.endpoint }));
    },
  };
}

export interface GitHubExecDeps {
  host: string;
  command: string | null;
  env: () => NodeJS.ProcessEnv;
  run?: CliRun;
  client: HttpClient | null;
  graphqlClient: HttpClient | null;
  validate: (c: VcsCommand) => void;
}

export function githubExecutor(d: GitHubExecDeps): VcsExecutor {
  const run = d.run ?? defaultCliRun;
  return {
    async run(c, meta = {}) {
      d.validate(c);
      if (c.via === 'gh') {
        const args = ['api', '--method', c.method, c.endpoint];
        return withTempFiles(async (file) => {
          if (c.endpoint === 'graphql') args.push('-f', `query=${c.fields.query}`);
          else if (c.json !== undefined) args.push('-H', 'Content-Type: application/json', '--input', file('body', c.json));
          let out: string;
          try {
            out = await run(d.command ?? 'gh', args, { env: d.env(), timeoutMs: 60_000, maxBuffer: 16 * 1024 * 1024 });
          } catch (e) {
            throw cliFailure(e, d.command ?? 'gh', d.host);
          }
          if (c.endpoint === 'graphql') {
            const errors = graphqlErrors(JSON.parse(out));
            if (errors.length) throw new Error(t('vcs.exec.refused', { host: d.host, detail: scrubSecrets(errors.join(' ')).slice(0, 500) }));
          }
          meta.response = parsed(out);
          return out.slice(0, RESULT_MAX);
        });
      }
      if (c.via === 'api') {
        if (c.endpoint === 'graphql') {
          if (!d.graphqlClient) throw new VcsError('not_configured', { kind: 'GitHub' });
          const r = await d.graphqlClient.request('POST', 'graphql', { json: { query: c.fields.query } });
          meta.code = r.status;
          const errors = graphqlErrors(r.body);
          if (errors.length) throw new Error(t('vcs.exec.refused', { host: d.host, detail: scrubSecrets(errors.join(' ')).slice(0, 500) }));
          return JSON.stringify(r.body).slice(0, RESULT_MAX);
        }
        if (!d.client) throw new VcsError('not_configured', { kind: 'GitHub' });
        const r = await d.client.request(c.method, c.endpoint, { json: c.json !== undefined ? JSON.parse(c.json) : undefined });
        meta.code = r.status;
        meta.response = r.body;
        return JSON.stringify(r.body ?? {}).slice(0, RESULT_MAX);
      }
      throw new Error(t('vcs.validate.endpoint', { endpoint: c.endpoint }));
    },
  };
}

export function bitbucketExecutor(d: { client: HttpClient; validate: (c: VcsCommand) => void }): VcsExecutor {
  return {
    async run(c, meta = {}) {
      d.validate(c);
      const r = await d.client.request(c.method, c.endpoint, { json: c.json !== undefined ? JSON.parse(c.json) : undefined });
      meta.code = r.status;
      meta.response = r.body;
      return JSON.stringify(r.body ?? {}).slice(0, RESULT_MAX);
    },
  };
}

export type ExecutorOf = Record<VcsKind, VcsExecutor | undefined>;
