import { migrateConfig } from '../../src/shared/config/migrations';
import type { WorkspaceConfig } from '../../src/shared/config/types';

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

/** The config an existing install gets from the migration: the author's profile over the old settings. */
export function legacyConfigFixture(v1: Record<string, unknown> = V1_SETTINGS): WorkspaceConfig {
  return migrateConfig(v1, { legacyInstall: true }).config;
}

/** Makes the running workspace behave like an install that predates the configuration. Call after CERIMONIAS_DATA_DIR is set. */
export async function installLegacyConfig(): Promise<WorkspaceConfig> {
  const { saveConfig } = await import('../../src/main/workspaceConfig');
  return saveConfig(legacyConfigFixture());
}

/** Gives a secret ref an environment-variable source holding a throwaway value, so a provider resolves without a keychain. */
export async function installEnvSecret(ref: string, name = 'COXIA_TEST_KEY', value = 'test-key-not-real'): Promise<void> {
  process.env[name] = value;
  const { secrets } = await import('../../src/main/secrets');
  secrets().set({ ref, source: 'env', name });
}
