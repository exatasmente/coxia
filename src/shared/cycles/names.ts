import type { Language } from '../config/types';
import { cycleText } from './text';

const NAMES: Record<string, string> = {
  none: 'cycle.none.name',
  sdd: 'cycle.sdd.name',
  scrum: 'cycle.scrum.name',
  kanban: 'cycle.kanban.name',
  'github-flow': 'cycle.githubFlow.name',
  minimal: 'cycle.minimal.name',
  'agent-flow': 'cycle.agentFlow.name',
  'agent-flow-engineering': 'cycle.agentFlowEngineering.name',
};

/** The name of a built-in template in a language; a custom template's id is returned as it is. */
export function builtInName(id: string, language: Language): string {
  return NAMES[id] ? cycleText(NAMES[id], language) : id;
}
