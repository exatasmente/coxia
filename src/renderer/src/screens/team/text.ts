import type { AgentDef, SquadDef, WorkspaceConfig } from '../../../../shared/config/types';
import { cycleText } from '../../../../shared/cycles/text';
import { getLanguage } from '../../../../shared/i18n';

// The texts of a config are catalog keys or literals ("cycle.agentFlow.team.developer.name" or "Developer"): this is what a person reads.

/** A config text in the language of the app. */
export const shown = (value: string): string => cycleText(value, getLanguage());

export const agentName = (a: Pick<AgentDef, 'id' | 'name'>): string => shown(a.name) || a.id;
export const squadName = (s: Pick<SquadDef, 'id' | 'name'>): string => shown(s.name) || s.id;

/** The name of an agent by id, or the id itself when the team does not have it. */
export const agentNameById = (config: Pick<WorkspaceConfig, 'agents'>, id: string): string => {
  const a = config.agents.team.find((x) => x.id === id);
  return a ? agentName(a) : id;
};
