import type { SecretRequirement, WorkspaceConfig } from './config/types';
import type { SecretInfo, SecretsStorageStatus } from './secrets';

// What the configuration screens (the wizard, Settings) get from `config:get`.

export type SdkLocationView = { mode: 'local'; root: string; entry: string } | { mode: 'bundled' } | { mode: 'missing'; reason: string };

export interface ConfigView {
  config: WorkspaceConfig;
  /** Every secret source known on this machine (never a value). */
  secrets: SecretInfo[];
  storage: SecretsStorageStatus;
  /** The secrets this config points at, and whether each has a source. */
  requirements: (SecretRequirement & { configured: boolean })[];
  /** Where the Claude Agent SDK would be loaded from right now. */
  claudeSdk: SdkLocationView;
  workspaceId: string;
}

// Module event name: screens follow a config or secret change made anywhere.
export const CONFIG_EVENT = 'config';
