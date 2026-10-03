import type { AgentDef, WorkspaceConfig, CeremonyId, Language } from '../shared/config/types';
import { cycleOf, cycleText, type CycleTemplate } from '../shared/cycles';
import { getLanguage } from '../shared/i18n';
import { proposeDocs, scanWorkspace, targetsOf } from './agentPrep-core';
import { allTemplates } from './cycle-core';

// What the setup wizard asks of the cycle work: the list of templates to choose from, and the "prepare agents" scan. Both take what they need
// as arguments (a config and a home folder), so the wizard can call them before anything is saved.

export interface WizardTemplate {
  id: string;
  /** Already in the language asked for. */
  name: string;
  description: string;
  builtIn: boolean;
  /** What the person still has to provide for the template to be fully useful ("specsDir", "qaUser"...). */
  needs: string[];
  /** The part of the workspace config the template sets: applying it is `mergeDeep(config, patch)`, then `devCycle.templateId` is the id. */
  patch: { devCycle: ReturnType<typeof cycleOf> };
  ceremonies: Record<CeremonyId, boolean>;
  stages: { id: string; label: string }[];
  /** The agents the template brings, merged into the workspace's team when it is chosen. */
  team: AgentDef[];
}

function describeTemplate(t: CycleTemplate, builtIn: boolean, language: Language): WizardTemplate {
  const cycle = cycleOf(t);
  return {
    id: t.id,
    name: cycleText(t.name, language),
    description: cycleText(t.description, language),
    builtIn,
    needs: t.needs,
    patch: { devCycle: cycle },
    ceremonies: cycle.ceremonies,
    stages: cycle.stages.map((s) => ({ id: s.id, label: cycleText(s.label, language) })),
    team: t.team ?? [],
  };
}

/** The templates of this machine (built-in first, then the ones imported), with the cycle each one sets. */
export function listCycleTemplates(language: Language = getLanguage()): WizardTemplate[] {
  return allTemplates().map(({ template, builtIn }) => describeTemplate(template, builtIn, language));
}

export interface AgentPrepResult {
  /** What the scan found, as a docs section ("~/" paths): the wizard offers each path that the config does not list yet. */
  docs: ReturnType<typeof proposeDocs>['docs'];
  notes: string[];
  /** One entry per project scanned, with the short summary the screen shows. */
  projects: { id: string; path: string; exists: boolean; summary: string; stack: string[] }[];
}

/** Scans the projects of `config` and ~/.claude: no model, no writes, no secret read. */
export function prepareAgents(config: WorkspaceConfig, opts: { home: string }): AgentPrepResult {
  const scan = scanWorkspace(targetsOf(config, opts.home), opts.home, config.language);
  const proposal = proposeDocs(scan, null, opts.home, config.language);
  return {
    docs: proposal.docs,
    notes: proposal.notes,
    projects: scan.projects.map((p) => ({ id: p.id, path: p.path, exists: p.exists, summary: p.summary, stack: p.stack })),
  };
}
