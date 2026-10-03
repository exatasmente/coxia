import type { Language, VcsIntegration, VcsKind, WorkspaceConfig } from '../config/types';
import { CYCLE_VARIANTS, GITLAB_TRACKER_MCP, hostWords, upperFirstWord, type CycleVariant, type Terms } from '../i18n/terms';
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

/** The id of the template whose wording the plain keys have, and the label key of its daily ceremony. */
const SDD_TEMPLATE = 'sdd';
const SDD_CEREMONY_LABEL = 'cycle.label.preDaily';
/** The days the retro looks back over in the wording of the plain keys ("weekly"). */
const WEEK = 7;

/** The variants of the cycle that apply to a workspace (see CYCLE_VARIANTS), in the order of that list. */
export function cycleVariants(config: Pick<WorkspaceConfig, 'devCycle'>): CycleVariant[] {
  const { templateId, ceremonyParams } = config.devCycle;
  const on: Record<CycleVariant, boolean> = {
    'off-sdd': templateId !== SDD_TEMPLATE,
    'own-ceremony': ceremonyParams.preDaily.label !== SDD_CEREMONY_LABEL,
    'own-target': ceremonyParams.preDaily.summaryTarget.trim() !== '',
    'own-retro': ceremonyParams.retro.windowDays !== WEEK,
  };
  return CYCLE_VARIANTS.filter((v) => on[v]);
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
    flags: cycleVariants(config),
    words: {
      ...hostWords(kind, language),
      ceremony,
      Ceremony: upperFirstWord(ceremony),
      summaryTarget: cycleText(preDaily.summaryTarget || 'cycle.summary.chat', language, user),
      retroDays: String(retro.windowDays),
      cli: primary ? (configuredCli(primary) ?? '') : '',
      trackerMcp: config.agents.tools.trackerMcpServer.trim() || (kind === null || kind === 'gitlab' ? GITLAB_TRACKER_MCP : ''),
    },
  };
}
