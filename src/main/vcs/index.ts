import { execFileSync } from 'node:child_process';
import { secrets } from '../secrets';
import { getConfig, rc } from '../workspaceConfig';
import type { VcsIntegration } from '../../shared/config/types';
import type { VcsProbeResult } from '../../shared/vcs';
import { VcsError } from './errors';
import { probeIntegration } from './probe';
import { type RuntimeDeps, type VcsRuntime, type VcsSettings, buildRuntime, useCli } from './runtime';
import type { VcsProvider } from './types';

// The provider of the running workspace: built from the config at call time (never at import), cached until the config it was built
// from changes. Call sites ask for the primary integration (the one that holds the issues); the others are reachable by id.

export type VcsExecutor = VcsRuntime['exec'];
export type { VcsProvider, VcsRuntime };

const installedCache = new Map<string, boolean>();

function cliInstalled(command: string): boolean {
  let known = installedCache.get(command);
  if (known === undefined) {
    try {
      execFileSync(command, ['--version'], { stdio: 'ignore', timeout: 5000 });
      known = true;
    } catch {
      known = false;
    }
    installedCache.set(command, known);
  }
  return known;
}

/** The integration has a secret source on this machine (a ref that names nothing is no token). */
function hasToken(s: VcsSettings): boolean {
  return !!s.secretRef && secrets().has(s.secretRef);
}

function token(s: VcsSettings): string {
  if (!s.secretRef) throw new VcsError('no_token', { id: s.id, ref: '-' });
  try {
    return secrets().resolve(s.secretRef);
  } catch {
    // The secrets store explains itself in its own channels; here the message names the ref, never a value.
    throw new VcsError('no_token', { id: s.id, ref: s.secretRef });
  }
}

let override: Partial<RuntimeDeps> = {};
let fixed: VcsRuntime | null = null;
let cache: { key: string; runtime: VcsRuntime } | null = null;

/** Tests only: replace the token source, fetch, CLI runner or clock; null clears. */
export function configureVcsForTests(deps: Partial<RuntimeDeps> | null): void {
  override = deps ?? {};
  cache = null;
  installedCache.clear();
}

/** Tests only: use this runtime instead of building one from the config; null clears. */
export function setVcsRuntimeForTests(runtime: VcsRuntime | null): void {
  fixed = runtime;
}

function settingsOf(id: string | null): VcsSettings | null {
  const v = id ? rc().vcs.find((x) => x.id === id) : rc().primaryVcs;
  if (!v) return null;
  const cfg = getConfig().vcs.find((x) => x.id === v.id);
  const repos = new Set<string>();
  for (const r of rc().repos) if (r.vcsId === v.id && r.projectPath) repos.add(r.projectPath);
  const issues = rc().issues;
  if (issues.vcsId === v.id && issues.project) repos.add(issues.project);
  return { id: v.id, kind: v.kind, host: v.host, apiUrl: cfg?.apiUrl ?? '', user: v.user, secretRef: v.secretRef, cli: v.cli, preference: cfg?.cliPreference ?? 'auto', repos: [...repos].sort() };
}

/** The dependencies a runtime is built with: the secrets store, the process environment, and whatever the tests replaced. */
export function vcsRuntimeDeps(): RuntimeDeps {
  return { token, env: () => ({ ...process.env }), cliInstalled, hasToken, ...override };
}

/** The runtime of an integration (the primary one without an id), or null when the workspace has none. */
export function vcsRuntime(id: string | null = null): VcsRuntime | null {
  if (fixed) return fixed;
  const s = settingsOf(id);
  if (!s) return null;
  const key = JSON.stringify(s);
  if (cache?.key === key) return cache.runtime;
  const runtime = buildRuntime(s, vcsRuntimeDeps());
  cache = { key, runtime };
  return runtime;
}

export function requireVcsRuntime(id: string | null = null): VcsRuntime {
  const r = vcsRuntime(id);
  if (!r) throw new VcsError('not_configured', { kind: 'VCS' });
  return r;
}

/** The provider of the primary integration; throws a translated error when the workspace has none. */
export function vcsProvider(id: string | null = null): VcsProvider {
  return requireVcsRuntime(id).provider;
}

/** Whether the primary integration can be used right now: its CLI is on, or it has a token source. What the jobs that read the host wait for. */
export function vcsReady(): boolean {
  if (fixed) return true;
  const s = settingsOf(null);
  if (!s) return false;
  return useCli(s, cliInstalled, hasToken(s)) || hasToken(s);
}

/** The CLI the agents' read-only shell may use for the primary integration, or null (API only, Bitbucket, no integration). */
export function vcsCliFor(): { kind: 'gitlab' | 'github'; command: string; host: string } | null {
  const s = settingsOf(null);
  if (!s || s.kind === 'bitbucket' || !s.cli || !useCli(s, cliInstalled, hasToken(s))) return null;
  return { kind: s.kind, command: s.cli, host: s.host };
}

/**
 * What the setup wizard calls: probes one integration of the config (auth, user, token permissions, a sample of my issues and MRs).
 * The issue project and the repositories it looks in come from the workspace config; a token typed but not yet stored can be passed to
 * test it without saving it. Reads only.
 */
export async function probeVcs(integration: VcsIntegration, extra: { token?: string } = {}): Promise<VcsProbeResult> {
  const { projects } = getConfig();
  return probeIntegration(
    {
      integration: { id: integration.id, kind: integration.kind, host: integration.host, apiUrl: integration.apiUrl, user: integration.user, secretRef: integration.secretRef, cliPreference: integration.cliPreference, cliCommand: integration.cliCommand },
      ...(extra.token ? { token: extra.token } : {}),
      issueProject: projects.issues.vcsId === integration.id ? projects.issues.project : null,
      repos: projects.repos.filter((r) => r.vcsId === integration.id && r.projectPath).map((r) => r.projectPath as string),
    },
    vcsRuntimeDeps(),
  );
}
