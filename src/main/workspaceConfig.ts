import { existsSync } from 'node:fs';
import { setLanguage, setVoiceEnabled, t } from '../shared/i18n';
import { migrateConfig } from '../shared/config/migrations';
import type { WorkspaceConfig } from '../shared/config/types';
import { summarizeIssues, validateConfig } from '../shared/config/validate';
import { bootstrapConfigs, readConfigFile, writeConfigFile } from './config-bootstrap';
import { type ResolvedConfig, type ResolvedDocs, resolveConfig, resolveDocs } from './config-resolve';
import { ATAS, DATA_ROOT, EXISTING_INSTALL, HOME, WORKSPACE_ID } from './env';
import { loadLegacyProfile } from './legacy-profile';
import { secrets, seedLegacySecrets } from './secrets';

// The loaded config of the running workspace, and the getters that replaced the constants env.ts used to hold.
// Modules read `rc()` at call time, never at import time: the config can change while the app runs (Settings, import, the wizard).

let state: { config: WorkspaceConfig; resolved: ResolvedConfig } | null = null;
let bootstrapped = false;
let legacyWorkspace = false;
const listeners = new Set<(config: WorkspaceConfig) => void>();

const context = () => ({ home: HOME, env: process.env, fallbackCwd: ATAS });

function load(): { config: WorkspaceConfig; resolved: ResolvedConfig } {
  const log = (m: string) => console.log(`[config] ${m}`);
  const profile = loadLegacyProfile(process.env, log);
  if (!bootstrapped) {
    bootstrapped = true;
    legacyWorkspace = bootstrapConfigs({ root: DATA_ROOT, existingInstall: EXISTING_INSTALL, now: () => new Date(), log, profile }).marker.legacyWorkspaces.includes(WORKSPACE_ID);
  }
  const stored = readConfigFile(ATAS);
  const checked = validateConfig(stored);
  const legacy = legacyWorkspace;
  const config = checked.config ?? migrateConfig(stored, { legacyInstall: legacy, profile }).config;
  // A config migrated before userName existed keeps the name of the legacy profile, when there is one.
  if (legacy && profile && checked.ok && !(typeof stored === 'object' && stored !== null && 'userName' in stored)) config.userName = profile.config.userName ?? '';
  if (legacy && profile?.secrets.length) {
    try {
      seedLegacySecrets(profile.secrets);
    } catch (e) {
      console.error('[config] could not register the previous secret source', e instanceof Error ? e.message : e);
    }
  }
  setLanguage(config.language);
  setVoiceEnabled(config.voice.enabled);
  return { config, resolved: resolveConfig(config, context()) };
}

export function getConfig(): WorkspaceConfig {
  state ??= load();
  return state.config;
}

/** The resolved view: absolute paths, the optional integrations that are on, the former constants. */
export function rc(): ResolvedConfig {
  state ??= load();
  return state.resolved;
}

export function docsSources(): ResolvedDocs {
  return resolveDocs(getConfig(), context(), existsSync);
}

const flowInputs = (c: unknown): string => {
  const x = c as Partial<WorkspaceConfig> | null;
  // The flow, the flows of the squads, who belongs to which squad, who is its liaison, what its scope is, and who turns to whom.
  return JSON.stringify([
    x?.devCycle?.stages ?? null,
    x?.devCycle?.flows ?? null,
    (x?.squads ?? []).map((q) => [q.id, q.liaison ?? null, q.scope ?? null]),
    (x?.agents?.team ?? []).map((a) => [a.id, a.stages, a.turnsTo ?? null, a.squad ?? null]),
  ]);
};

/** Validates, writes and applies a whole config. Throws with every problem named when it is invalid. */
export function saveConfig(next: unknown): WorkspaceConfig {
  let checked = validateConfig(next);
  // A flow with a problem was kept as the person left it when the app opened it: it must not make an unrelated change (the theme, an agent's switch) unsavable.
  // Only a change to the flow itself, to the squads' structure, or to who turns to whom, is held to its checks.
  if (!checked.ok && state && flowInputs(next) === flowInputs(state.config)) {
    const tolerant = validateConfig(next, { tolerateFlow: true });
    if (tolerant.ok) checked = tolerant;
  }
  if (!checked.ok || !checked.config) throw new Error(t('main.config.invalid', { issues: summarizeIssues(checked.errors) }));
  writeConfigFile(ATAS, checked.config);
  state = { config: checked.config, resolved: resolveConfig(checked.config, context()) };
  setLanguage(checked.config.language);
  setVoiceEnabled(checked.config.voice.enabled);
  for (const fn of listeners) fn(checked.config);
  return checked.config;
}

export function updateConfig(change: (current: WorkspaceConfig) => WorkspaceConfig): WorkspaceConfig {
  return saveConfig(change(structuredClone(getConfig())));
}

export function reloadConfig(): WorkspaceConfig {
  state = null;
  return getConfig();
}

export function onConfigChange(fn: (config: WorkspaceConfig) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Environment for a child that talks to the VCS host through its CLI (glab, gh). Without a configured host the CLI uses its own default. */
export function vcsCliEnv(): NodeJS.ProcessEnv {
  const v = rc().primaryVcs;
  if (!v?.host) return { ...process.env };
  if (v.kind === 'github') return v.host === 'github.com' ? { ...process.env } : { ...process.env, GH_HOST: v.host };
  if (v.kind === 'bitbucket') return { ...process.env };
  return { ...process.env, GITLAB_HOST: v.host };
}

/** Whether a secretRef the config points at has a source on this machine. */
export function secretConfigured(ref: string | null): boolean {
  return !ref || secrets().has(ref);
}

/** The issue project as the API path segment: the numeric id when known, else the URL-encoded "group/name". */
export function issueProjectRef(): string {
  const { projectId, project } = rc().issues;
  if (projectId !== null) return String(projectId);
  if (project) return encodeURIComponent(project);
  throw new Error(t('main.config.noIssueProject'));
}

/** The VCS host, or an error naming what is missing: for the calls that cannot work without one. */
export function requireVcsHost(): string {
  const host = rc().vcsHost;
  if (!host) throw new Error(t('vcs.error.not_configured', { kind: 'VCS' }));
  return host;
}

/**
 * The issue project as the provider takes it: GitLab keeps the numeric id when the config has one (what the app always sent),
 * every other case the "group/name" path. Throws when the workspace has no issue project.
 */
export function issueProjectKey(): string {
  const { projectId, project } = rc().issues;
  if (rc().primaryVcs?.kind === 'gitlab' && projectId !== null) return String(projectId);
  if (project) return project;
  throw new Error(t('main.config.noIssueProject'));
}

/** Matches a note that opens with the QA user mention (the release hand-off comment), or null when the workspace has no QA user. */
export function qaNoteMarker(): RegExp | null {
  const user = rc().qaUser;
  return user ? new RegExp(`^@${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
}

/** The issue project URL-encoded as a path segment ("group%2Fname"), else its numeric id. */
export function issueProjectPath(): string {
  const { project } = rc().issues;
  return project ? encodeURIComponent(project) : issueProjectRef();
}

/** Web URL of an issue of the configured project, or null when the workspace has no host or issue project. */
export function issueWebUrl(iid: string | number): string | null {
  const { project } = rc().issues;
  const v = rc().primaryVcs;
  if (!v?.host || !project) return null;
  if (v.kind === 'github') return `https://${v.host}/${project}/issues/${iid}`;
  if (v.kind === 'bitbucket') return `https://bitbucket.org/${project}/issues/${iid}`;
  return `https://${v.host}/${project}/-/work_items/${iid}`;
}

/** A card ref of an issue of the configured project ("app#101" with the prefix, a bare number without one). */
export function isIssueRef(ref: string): boolean {
  const { refPrefix, project } = rc().issues;
  return !!project && ref.startsWith(refPrefix) && /^\d+$/.test(ref.slice(refPrefix.length));
}

/** Login of the QA account, or an empty string when the workspace has none (nothing matches it). */
export function qaUser(): string {
  return rc().qaUser ?? '';
}

/** The GitLab CLI is configured: what the jobs that read GitLab (feedback, watchers, quick actions, effects) need before they run. */
export function gitlabCliReady(): boolean {
  const v = rc().primaryVcs;
  return v?.kind === 'gitlab' && !!v.cli;
}
