import type { Language, VcsKind } from '../config/types';

// The workspace's own words: the standard placeholders every catalog text may use ({vcsName}, {cr}, {crs}, {crLong}, {crLongs}, {crMark},
// {ceremony}, {Ceremony}, {summaryTarget}, {retroDays}, {cli}, {trackerMcp}, plus {CrLong}, {CrLongs}, {anCr} and {ci}). They are filled by the translator from this table, so a text names the code
// host, the change request and the daily ceremony the workspace has, and a caller never passes them by hand. The host words live here, in
// one place; the workspace-dependent ones (ceremony, summary target, retro window, CLI) are added by `termsFor` in cycles/terms.ts.

/** The standard placeholders and the host kind that selects a key variant (`vcs.card.ciFailed.on-github`). */
export interface Terms {
  /** The integration the words come from; null when the workspace has none. */
  kind: VcsKind | null;
  /**
   * The variants of the cycle in force, as key suffixes (`.off-sdd`): see CYCLE_VARIANTS. Empty for a GitLab workspace on the SDD template with
   * its default parameters, whose texts are the plain keys.
   */
  flags: string[];
  words: Record<string, string>;
}

/**
 * The variants a key may have besides the host's `.on-<kind>`, selected by what the cycle configuration differs in from the SDD template with
 * its default parameters (the wording the plain keys have):
 *   off-sdd       the cycle is not the SDD template: no specs, no Plan, no playbook, no gates and quizzes
 *   own-ceremony  the daily ceremony has a name of its own (devCycle.ceremonyParams.preDaily.label)
 *   own-target    the summary is pasted somewhere the cycle names (preDaily.summaryTarget) and not into "the team daily"
 *   own-retro     the retro looks back over a window other than a week (ceremonyParams.retro.windowDays)
 * With several in force the first listed wins, so a key that needs a combination says it in the variant of the first.
 */
export const CYCLE_VARIANTS = ['off-sdd', 'own-ceremony', 'own-target', 'own-retro'] as const;
export type CycleVariant = (typeof CYCLE_VARIANTS)[number];

/** "{key}" is a Record keyed by the placeholder's name. */
export type TermWords = Record<string, string>;

interface HostWords {
  name: string;
  cr: string;
  crs: string;
  crLong: string;
  crLongs: string;
  mark: string;
  /** What the host calls the automated checks of a change request, as a word in a list. */
  ci: string;
}

// "MR" is the neutral default: a workspace with no integration keeps the app's historic noun.
const MERGE: Omit<HostWords, 'name' | 'ci'> = { cr: 'MR', crs: 'MRs', crLong: 'merge request', crLongs: 'merge requests', mark: '!' };
const PULL: Omit<HostWords, 'name' | 'ci'> = { cr: 'PR', crs: 'PRs', crLong: 'pull request', crLongs: 'pull requests', mark: '#' };

// i18n-ignore-start: the names of the hosts and of their change requests are the same in every language
const HOSTS: Record<VcsKind, HostWords> = {
  gitlab: { name: 'GitLab', ...MERGE, ci: 'pipeline' },
  github: { name: 'GitHub', ...PULL, ci: 'checks' },
  bitbucket: { name: 'Bitbucket', ...PULL, ci: 'pipeline' },
};
// i18n-ignore-end

// i18n-ignore-start: the words of a workspace with no integration, per language (the catalog entries cycle.vcs.fallback and cycle.summary.chat say the same)
const FALLBACK: Record<Language, { host: string; ceremony: string; summaryTarget: string }> = {
  'pt-BR': { host: 'provedor de código', ceremony: 'pré-daily', summaryTarget: 'chat do time' },
  en: { host: 'the code host', ceremony: 'pre-daily', summaryTarget: 'the team chat' },
};
// i18n-ignore-end

/** The MCP server the app's documentation names for the issue tools of GitLab: what {trackerMcp} says while none is configured on GitLab or with no integration. */
export const GITLAB_TRACKER_MCP = 'gitlab-issue-analysis';

/** The marker a ref of a change request is written with on a host: "app!7" on GitLab, "app#7" elsewhere. */
export const crMarkOf = (kind: VcsKind | null): string => (kind ? HOSTS[kind].mark : MERGE.mark);

export const upperFirstWord = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The host words for a kind (null: no integration), in a language. `anCr` is the noun with the English indefinite article ("an MR", "a PR");
 * Portuguese leaves the article to the text, so there it is the bare noun.
 */
export function hostWords(kind: VcsKind | null, language: Language): TermWords {
  const h: HostWords = kind ? HOSTS[kind] : { ...MERGE, name: FALLBACK[language].host, ci: 'pipeline' };
  return { vcsName: h.name, cr: h.cr, crs: h.crs, crLong: h.crLong, crLongs: h.crLongs, CrLong: upperFirstWord(h.crLong), CrLongs: upperFirstWord(h.crLongs), crMark: h.mark, anCr: language === 'en' ? `${h.cr === 'MR' ? 'an' : 'a'} ${h.cr}` : h.cr, ci: h.ci };
}

/** What a placeholder is before the workspace says anything: no integration, the app's own ceremony, a generic team chat, a week. */
export function defaultTerms(language: Language): Terms {
  const f = FALLBACK[language];
  return { kind: null, flags: [], words: { ...hostWords(null, language), ceremony: f.ceremony, Ceremony: upperFirstWord(f.ceremony), summaryTarget: f.summaryTarget, retroDays: '7', cli: '', trackerMcp: GITLAB_TRACKER_MCP } };
}
