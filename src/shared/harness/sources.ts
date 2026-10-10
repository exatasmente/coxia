import type { DocsConfig, WorkspaceConfig } from '../config/types';
import { DOCS_KEYS, type DocsKey } from '../wizard';

// The extra sources of Settings › Documentation. The screen keeps only the lists it edits; what it saves is built here from the configuration as it is at that moment.

/** The lists of extra sources of a configuration, copied. */
export function docsListsOf(config: WorkspaceConfig): Pick<DocsConfig, DocsKey> {
  return Object.fromEntries(DOCS_KEYS.map((k) => [k, [...config.docs[k]]])) as Pick<DocsConfig, DocsKey>;
}

/**
 * `current` with only the lists of extra sources replaced. `config:save` replaces the whole configuration, so `current` must be read right before saving: a snapshot taken
 * when the screen opened would write over whatever was changed since (the team, a flow), on this screen or another.
 */
export function withDocsSources(current: WorkspaceConfig, lists: Pick<DocsConfig, DocsKey>): WorkspaceConfig {
  const own = Object.fromEntries(DOCS_KEYS.map((k) => [k, [...lists[k]]]));
  return { ...current, docs: { ...current.docs, ...own } };
}

/**
 * `current` with only the roadmap pointer replaced; blank clears it (the agents are then told there is no roadmap). Built on the configuration as it is at that moment,
 * for the same reason as `withDocsSources`.
 */
export function withRoadmapFile(current: WorkspaceConfig, value: string): WorkspaceConfig {
  const file = value.trim();
  const docs = { ...current.docs };
  if (file) docs.roadmapFile = file;
  else delete docs.roadmapFile;
  return { ...current, docs };
}
