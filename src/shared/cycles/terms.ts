import type { Language, VcsIntegration, VcsKind, WorkspaceConfig } from '../config/types';
import { hostWords, upperFirstWord, type Terms } from '../i18n/terms';
import { cycleText, userTerms } from './text';

// The standard placeholders of a workspace (see ../i18n/terms.ts), built from its configuration: the integration that holds the issues, the
// cycle's name for the daily ceremony, its retro window and where its summary is pasted.

/** The CLI each host has when the integration does not name one. */
const DEFAULT_CLI: Partial<Record<VcsKind, string>> = { gitlab: 'glab', github: 'gh' };

/** The integration that holds the issues, else the first one; null when the workspace has none. */
export function primaryIntegration(config: Pick<WorkspaceConfig, 'vcs' | 'projects'>): VcsIntegration | null {
  return config.vcs.find((v) => v.id === config.projects.issues.vcsId) ?? config.vcs[0] ?? null;
}

/** The command of the integration's CLI, or null when it uses the API only or its host has no CLI. */
export function configuredCli(v: Pick<VcsIntegration, 'kind' | 'cliPreference' | 'cliCommand'>): string | null {
  return v.cliPreference === 'api' ? null : (v.cliCommand ?? DEFAULT_CLI[v.kind] ?? null);
}

/** The terms of a workspace in a language. `cli` is empty when the host is read through the app's own tool or there is no integration. */
export function termsFor(config: WorkspaceConfig, language: Language): Terms {
  const primary = primaryIntegration(config);
  const kind = primary?.kind ?? null;
  const user = userTerms(language, config);
  const { preDaily, retro } = config.devCycle.ceremonyParams;
  const ceremony = cycleText(preDaily.label, language, user);
  return {
    kind,
    words: {
      ...hostWords(kind, language),
      ceremony,
      Ceremony: upperFirstWord(ceremony),
      summaryTarget: cycleText(preDaily.summaryTarget || 'cycle.summary.chat', language, user),
      retroDays: String(retro.windowDays),
      cli: primary ? (configuredCli(primary) ?? '') : '',
    },
  };
}
