import { agentFlow, agentFlowEngineering } from './templates/agentFlow';
import { githubFlow } from './templates/githubFlow';
import { kanban } from './templates/kanban';
import { minimal } from './templates/minimal';
import { scrum } from './templates/scrum';
import { releaseFlow } from './templates/releaseFlow';
import { sdd } from './templates/sdd';
import type { CycleTemplate } from './types';

export * from './apply';
export * from './ceremonies';
export * from './host';
export * from './neutral';
export * from './prompts';
export * from './stages';
export * from './terms';
export * from './text';
export * from './types';
export * from './view';
export { agentFlow, agentFlowEngineering, githubFlow, kanban, minimal, releaseFlow, scrum, sdd };
export { AGENT_FLOW_STAGES, ENGINEERING_FLOW_STAGES, agentFlowTeam, engineeringTeam } from './templates/agentFlow';
export { RELEASE_FLOW_STAGES, RELEASE_MANAGER, releaseManager } from './templates/releaseFlow';

/** The templates that ship with the app, in the order the wizard lists them. */
export const BUILT_IN_TEMPLATES: CycleTemplate[] = [sdd, scrum, kanban, githubFlow, minimal, agentFlow, agentFlowEngineering, releaseFlow];

export function builtInTemplate(id: string): CycleTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
