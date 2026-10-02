import { neutralConfig } from './config/defaults';
import { settingsFromConfig } from './config/settingsView';
import { THEMES, type Language, type LlmRole, type Theme } from './config/types';

export type ModelRole = LlmRole;
export type { Theme };
export { THEMES };

// The flat view of the workspace config that the Settings screen edits. The source of truth is the WorkspaceConfig (shared/config);
// see settingsView.ts for how this is derived and applied back.
export interface Settings {
  language: Language;
  /** Model id per role; the provider of each role is part of the workspace config. */
  models: Record<ModelRole, string>;
  /** Model ids the configured providers offer, for the pickers. Read-only: a save ignores it. */
  modelOptions: string[];
  tools: {
    files: boolean;
    skills: boolean;
    gitlabMcp: boolean;
    glab: boolean;
    subagents: boolean;
  };
  schedule: {
    preDaily: string;
    days: number[];
    statusEveryMin: number;
    from: string;
    to: string;
    retroDay: number;
    retroTime: string;
  };
  voice: { autoStop: boolean; silenceMs: number; speak: boolean; engine: 'edge' | 'kokoro'; prosody: boolean; bargeIn: boolean };
  notifications: boolean;
  closeToTray: boolean;
  retention: { enabled: boolean; days: number };
  appearance: { theme: Theme };
  web: WebSettings;
}

// Browser access (PWA). Only the desktop window changes these, through the web:* channels. Machine-level: it lives in the data root, not in a workspace.
export interface WebSettings {
  enabled: boolean;
  host: string;
  port: number;
  basePath: string;
  publicUrl: string;
  // IPv4 CIDR of the reverse proxy: only a peer inside it (or loopback) is believed about X-Real-IP and X-Forwarded-Proto.
  trustedProxy: string;
  allowExternalEffects: boolean;
}

// Loopback only: a fresh install never listens on a network address nor points at somebody's tunnel.
export const NEUTRAL_WEB: WebSettings = {
  enabled: false,
  host: '127.0.0.1',
  port: 4330,
  basePath: '/cerimonias/',
  publicUrl: 'http://localhost:4330/cerimonias/',
  trustedProxy: '127.0.0.1/32',
  allowExternalEffects: false,
};

export const DEFAULT_SETTINGS: Settings = settingsFromConfig(neutralConfig(), NEUTRAL_WEB);

export function withDefaults(partial: Partial<Settings> | null | undefined): Settings {
  const p = partial ?? {};
  return {
    language: p.language === 'en' || p.language === 'pt-BR' ? p.language : DEFAULT_SETTINGS.language,
    models: { ...DEFAULT_SETTINGS.models, ...p.models },
    modelOptions: Array.isArray(p.modelOptions) ? p.modelOptions : DEFAULT_SETTINGS.modelOptions,
    tools: { ...DEFAULT_SETTINGS.tools, ...p.tools },
    schedule: { ...DEFAULT_SETTINGS.schedule, ...p.schedule },
    voice: { ...DEFAULT_SETTINGS.voice, ...p.voice },
    notifications: p.notifications ?? DEFAULT_SETTINGS.notifications,
    closeToTray: p.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
    retention: { ...DEFAULT_SETTINGS.retention, ...p.retention },
    appearance: { theme: THEMES.includes(p.appearance?.theme as Theme) ? (p.appearance?.theme as Theme) : DEFAULT_SETTINGS.appearance.theme },
    web: { ...DEFAULT_SETTINGS.web, ...p.web },
  };
}
