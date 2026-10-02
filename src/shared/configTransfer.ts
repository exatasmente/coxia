import type { ConfigChange } from './config/transfer';
import type { ConfigIssue } from './config/validate';
import type { SecretRequirement } from './config/types';
import type { SecretInput } from './secrets';

// What the screens exchange with the main process for exporting and importing a workspace configuration.

export type ImportTarget = { mode: 'new'; name: string } | { mode: 'existing'; id: string };

export type ImportSource = { text: string } | { path: string };

export interface ImportSecretNeed extends SecretRequirement {
  /** A source for this ref already exists on this machine (an earlier import, or the same ref in another workspace). */
  satisfied: boolean;
}

export interface ImportPreview {
  ok: boolean;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
  /** Name the exported workspace had; a default for a new workspace. */
  workspaceName: string | null;
  /** Notes of the migration when the file was written by an older schema. */
  migrated: string[];
  /** What the import would change in the target (against the neutral defaults for a new workspace). */
  changes: ConfigChange[];
  /** The secrets the file points at; the importer provides each one (stored value, command or environment variable). */
  secrets: ImportSecretNeed[];
  /** Programs the imported config would run. Show them: a config file can make the app execute things. */
  commands: { field: string; command: string }[];
  /** Local paths in the file that do not exist on this machine. */
  missingPaths: { field: string; path: string }[];
}

export interface ImportApply {
  source: ImportSource;
  target: ImportTarget;
  /** Sources for the secrets the file needs. Refs not listed (and not satisfied) stay missing and are reported back. */
  secrets: SecretInput[];
}

export interface ImportResult {
  workspaceId: string;
  created: boolean;
  /** The import changed the workspace the app is running; it applied immediately. Otherwise the user switches to it. */
  appliedToRunning: boolean;
  /** Secret refs still without a source. */
  missingSecrets: string[];
}

export interface ExportResult {
  path: string | null;
  requiredSecrets: SecretRequirement[];
}
