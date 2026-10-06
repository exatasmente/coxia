import { docsFlowOf } from '../../shared/config/squads';
import type { WorkspaceConfig } from '../../shared/config/types';
import { applyCycleTemplate } from '../cycle-core';
import { type Runner, RunnerError } from '../runner/service';
import type { Run } from '../../shared/runs';

// What the button that creates or updates the documentation of a repository does in the main process: start the documentation run, applying the docs flow first
// when the workspace has none and the person was asked and said yes. The window knows whether it must ask by reading `docsFlowOf(config)`.

/** The id of the template that brings the Documentation writer and the docs flow. */
export const DOCS_TEMPLATE = 'docs-flow';

/** Adds the docs flow and its agent to the running workspace (next to the flow of the issues, which stays as it is). */
export const applyDocsFlow = (): void => void applyCycleTemplate(DOCS_TEMPLATE);

export interface DocsStartDeps {
  runner: Pick<Runner, 'startDocs' | 'checkDocs'>;
  config(): WorkspaceConfig;
  applyFlow(): void;
}

/**
 * Starts the documentation run of a repository. A workspace with no docs flow gets it only when `applyFlow` is true (the person confirmed what enters: the agent and
 * the flow) and the start passes `checkDocs`; otherwise the start is refused with `no-docs-flow`, which the window answers with that confirmation, or with what `checkDocs` found.
 */
export async function startDocsRun(d: DocsStartDeps, repo: string, mode: string, applyFlow: boolean): Promise<Run> {
  if (!docsFlowOf(d.config())?.length) {
    if (!applyFlow) throw new RunnerError('no-docs-flow');
    // What would stop the start (the mode, a run already going, the repository, the identity) is found out before the template changes the configuration.
    await d.runner.checkDocs(repo, mode);
    d.applyFlow();
  }
  return d.runner.startDocs(repo, mode as 'create' | 'update');
}
