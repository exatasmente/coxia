import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLegacyProfile, type LegacyProfile } from '../../src/shared/config/legacy';
import { migrateConfig } from '../../src/shared/config/migrations';
import { neutralConfig } from '../../src/shared/config';
import type { DevCycleConfig, Language, StageDef, VcsKind, WorkspaceConfig } from '../../src/shared/config/types';
import { applyTemplate, builtInTemplate } from '../../src/shared/cycles';

// The fictional profile of an install that predates the configuration (org "acme", repo "acme/web", people Ana and Bruno). The same file is
// the documented example for COXIA_LEGACY_PROFILE.
export const EXAMPLE_PROFILE_FILE = join(import.meta.dirname, '../../docs/examples/legacy-profile.example.json');
export const exampleProfile = (): LegacyProfile => parseLegacyProfile(JSON.parse(readFileSync(EXAMPLE_PROFILE_FILE, 'utf8'))) as LegacyProfile;

// A flow of seven stages (the ones of the example profile): what the stage-aware tests sort and rank by.
export const TEST_STAGES: StageDef[] = exampleProfile().config.devCycle?.stages as StageDef[];

// The flat settings file of the app before the configuration existed (the real layout of config.json).
export const V1_SETTINGS = {
  models: { turn: 'deepseek/deepseek-v4.1-flash', reply: 'deepseek/deepseek-v4.1-flash', deep: 'deepseek/deepseek-v4-pro-0813', teams: 'qwen/qwen3.7-flash' },
  tools: { files: true, skills: true, gitlabMcp: true, glab: true, subagents: true },
  schedule: { preDaily: '09:40', days: [1, 2, 3, 4, 5], statusEveryMin: 30, from: '08:00', to: '19:00', retroDay: 5, retroTime: '16:00' },
  voice: { autoStop: true, silenceMs: 1200, speak: true, engine: 'edge', prosody: true, bargeIn: true },
  notifications: true,
  closeToTray: true,
  retention: { enabled: false, days: 30 },
  appearance: { theme: 'system' },
};

/** The config an existing install gets from the migration: the example profile over the old settings. */
export function legacyConfigFixture(v1: Record<string, unknown> = V1_SETTINGS): WorkspaceConfig {
  return migrateConfig(v1, { legacyInstall: true, profile: exampleProfile() }).config;
}

/** Makes the running workspace behave like an install that predates the configuration. Call after CERIMONIAS_DATA_DIR is set. */
export async function installLegacyConfig(): Promise<WorkspaceConfig> {
  const { saveConfig } = await import('../../src/main/workspaceConfig');
  return saveConfig(legacyConfigFixture());
}

/** Makes the running workspace one on a host of the given kind, with its CLI forced on (so no test depends on what the machine has installed). */
export async function installHostConfig(kind: VcsKind | null, options: { language?: Language; cliPreference?: 'auto' | 'cli' | 'api' } = {}): Promise<WorkspaceConfig> {
  const { saveConfig } = await import('../../src/main/workspaceConfig');
  const c = hostConfig(kind, { language: options.language ?? 'pt-BR' });
  if (c.vcs[0]) c.vcs[0].cliPreference = options.cliPreference ?? 'cli';
  return saveConfig(c);
}

/** Gives a secret ref an environment-variable source holding a throwaway value, so a provider resolves without a keychain. */
export async function installEnvSecret(ref: string, name = 'COXIA_TEST_KEY', value = 'test-key-not-real'): Promise<void> {
  process.env[name] = value;
  const { secrets } = await import('../../src/main/secrets');
  secrets().set({ ref, source: 'env', name });
}

/** The development cycle of the example profile: the SDD template with the fictional team's specifics. */
export const exampleCycle = (): DevCycleConfig => exampleProfile().config.devCycle as DevCycleConfig;

/** A workspace on the generic cycle of a template, with one integration of the given kind (null: none): what the host-aware tests render. */
export function hostConfig(kind: VcsKind | null, options: { language?: Language; template?: string } = {}): WorkspaceConfig {
  const c = applyTemplate(neutralConfig(), builtInTemplate(options.template ?? 'sdd')!);
  c.language = options.language ?? 'en';
  c.docs.autoDetect = false;
  if (kind) {
    c.vcs = [{ id: 'host', kind, host: kind === 'gitlab' ? 'gitlab.example.com' : kind === 'github' ? 'github.com' : 'bitbucket.org', apiUrl: '', user: '', secretRef: null, cliPreference: 'auto', cliCommand: null }];
    c.projects.issues.vcsId = 'host';
  }
  return c;
}
