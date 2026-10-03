import type { AgentDef, CeremonyId, DeepPartial, DevCycleConfig, Language, StageDef, VcsKind } from '../config/types';

// A development-cycle template: the process a team follows, as data. Applying one fills `devCycle` of the workspace config (and nothing else),
// so a workspace config exported with `config:export` already carries the cycle, and a template file is just that section with a name.
//
// Text in a template (names, labels, prompts) is a catalog key of src/shared/i18n/*.json or a literal written in the team's language:
// `cycleText()` (cycles/text.ts) tries the catalog first and falls back to the literal. Built-in templates use keys, so they follow the
// language of the workspace; a template a team writes for itself may use literals.

export const TEMPLATE_FORMAT = 'coxia-cycle-template';
export const TEMPLATE_FORMAT_VERSION = 1;

/** Fields of the workspace config the template cannot fill by itself: the wizard asks for them when the template is chosen. */
export const TEMPLATE_NEEDS = ['specsDir', 'qaUser', 'issueProject', 'releaseSync', 'cardSource'] as const;
export type TemplateNeed = (typeof TEMPLATE_NEEDS)[number];

export interface CycleTemplate {
  /** Stable id (lowercase letters, digits, "-" and "_"). Written to devCycle.templateId. */
  id: string;
  /** Catalog key or literal. */
  name: string;
  /** Catalog key or literal: one or two sentences saying who the process is for. */
  description: string;
  /** What the person still has to provide for the template to be fully useful ("specsDir": the folder of issue specs...). */
  needs: TemplateNeed[];
  /** The cycle: every field left out takes the neutral default. */
  devCycle: DeepPartial<DevCycleConfig>;
  /** The agents the cycle brings. Applying the template adds those the workspace lacks (by id) and never touches one it already has. Never a system agent. */
  team?: AgentDef[];
}

/** The file a template is exported to and imported from. */
export interface TemplateFile {
  format: typeof TEMPLATE_FORMAT;
  formatVersion: typeof TEMPLATE_FORMAT_VERSION;
  exportedAt: string;
  template: CycleTemplate;
}

/** What a template listing shows (names already in the language asked for). */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  needs: TemplateNeed[];
  ceremonies: CeremonyId[];
  stages: string[];
}

/** What a card says about its stage, as a provider reports it. Anything the provider does not have is left out. */
export interface StageInput {
  provider?: VcsKind;
  labels?: string[];
  /** The status of a work item (GitLab custom status). */
  status?: string | null;
  /** The open/closed style state of an issue or MR. */
  state?: string | null;
  /** Board fields, by field name (GitHub Projects v2: { Status: 'In progress' }). */
  fields?: Record<string, string | null | undefined>;
  column?: string | null;
  /** A free text the report already computed (the card.stage of an external card source). */
  text?: string | null;
}

export type { Language, StageDef };
