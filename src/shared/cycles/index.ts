import { githubFlow } from './templates/githubFlow';
import { kanban } from './templates/kanban';
import { minimal } from './templates/minimal';
import { scrum } from './templates/scrum';
import { sdd } from './templates/sdd';
import type { CycleTemplate } from './types';

export * from './apply';
export * from './ceremonies';
export * from './neutral';
export * from './prompts';
export * from './stages';
export * from './text';
export * from './types';
export * from './view';
export { githubFlow, kanban, minimal, scrum, sdd };

/** The templates that ship with the app, in the order the wizard lists them. */
export const BUILT_IN_TEMPLATES: CycleTemplate[] = [sdd, scrum, kanban, githubFlow, minimal];

// The id the existing install's cycle carries: the SDD template plus the author's specifics (see config/legacy.ts).
const ALIASES: Record<string, string> = { 'sz-sdd': 'sdd' };

export function builtInTemplate(id: string): CycleTemplate | undefined {
  const real = ALIASES[id] ?? id;
  return BUILT_IN_TEMPLATES.find((t) => t.id === real);
}
