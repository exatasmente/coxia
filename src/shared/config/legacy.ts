import type { DeepPartial, WorkspaceConfig } from './types';
import type { WebSettings } from '../settings';

// Migration of an install that predates the configuration (a v1 `config.json`, or a workspace folder with no config at all).
// The app ships no profile of its own: whatever such an install used to hardcode (host, repositories, tools, prompts) is read from an
// optional JSON file the person keeps outside the repository (env COXIA_LEGACY_PROFILE, read by src/main/legacy-profile.ts).
// Without that file the install migrates to the neutral defaults with `setupComplete: false`, and the setup assistant runs.
// An annotated, fictional example lives in docs/examples/legacy-profile.example.json.

/** A secret whose source is a command the person already runs; seeded into the secrets store of a migrated install. */
export interface LegacySecretSeed {
  ref: string;
  command: string;
  args: string[];
}

export interface LegacyProfile {
  /** A patch over the neutral defaults: every field of WorkspaceConfig is allowed. */
  config: DeepPartial<WorkspaceConfig>;
  /** Written to web.json of the install when that file is absent. */
  web: Partial<WebSettings> | null;
  secrets: LegacySecretSeed[];
  /** The v1 `models` of the old settings name models of this provider; without it they are not carried over. */
  migratedModels: { provider: string; defaultModel: string } | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Reads the profile file's document; null when it is not one (the caller then behaves as if there were no profile). */
export function parseLegacyProfile(raw: unknown): LegacyProfile | null {
  if (!isObject(raw) || !isObject(raw.config)) return null;
  const secrets = (Array.isArray(raw.secrets) ? raw.secrets : [])
    .filter(isObject)
    .map((s) => ({ ref: text(s.ref), command: text(s.command), args: Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === 'string') : [] }))
    .filter((s) => s.ref && s.command);
  const mm = isObject(raw.migratedModels) && text(raw.migratedModels.provider) && text(raw.migratedModels.defaultModel) ? { provider: text(raw.migratedModels.provider), defaultModel: text(raw.migratedModels.defaultModel) } : null;
  return { config: raw.config as DeepPartial<WorkspaceConfig>, web: isObject(raw.web) ? (raw.web as Partial<WebSettings>) : null, secrets, migratedModels: mm };
}
