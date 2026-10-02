import { execFileSync } from 'node:child_process';
import { secrets } from '../secrets';
import { getConfig, rc } from '../workspaceConfig';
import { VcsError } from './errors';
import { type RuntimeDeps, type VcsRuntime, type VcsSettings, buildRuntime, useCli } from './runtime';
import type { VcsExecutor } from './exec';
import type { VcsProvider } from './types';

// The provider of the running workspace: built from the config at call time (never at import), cached until the config it was built
// from changes. Call sites ask for the primary integration (the one that holds the issues); the others are reachable by id.

export type { VcsExecutor, VcsProvider, VcsRuntime };

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

function depsNow(): RuntimeDeps {
  return { token, env: () => ({ ...process.env }), cliInstalled, ...override };
}

/** The runtime of an integration (the primary one without an id), or null when the workspace has none. */
export function vcsRuntime(id: string | null = null): VcsRuntime | null {
  if (fixed) return fixed;
  const s = settingsOf(id);
  if (!s) return null;
  const key = JSON.stringify(s);
  if (cache?.key === key) return cache.runtime;
  const runtime = buildRuntime(s, depsNow());
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
  if (useCli(s, cliInstalled)) return true;
  return !!s.secretRef && secrets().has(s.secretRef);
}

/** The CLI the agents' read-only shell may use for the primary integration, or null (API only, Bitbucket, no integration). */
export function vcsCliFor(): { kind: 'gitlab' | 'github'; command: string; host: string } | null {
  const s = settingsOf(null);
  if (!s || s.kind === 'bitbucket' || !s.cli || !useCli(s, cliInstalled)) return null;
  return { kind: s.kind, command: s.cli, host: s.host };
}
