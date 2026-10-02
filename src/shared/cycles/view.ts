import type { CycleMeanings, Language, StageDef, WorkspaceConfig } from '../config/types';
import type { DestinationLabels } from '../destination';
import { availability, type Availability, type CeremonyContext } from './ceremonies';
import { builtInName } from './names';
import { cycleText, userTerms } from './text';

// What the screens need to know about the cycle, as plain data: which ceremonies to show, what the stages are, how to call the person.
// The main process builds it (cycle:view) and the renderer follows config changes; nothing here reads the disk.

export interface ViewContext extends CeremonyContext {
  /** Name of the tool that stores a note on a card (the card source's command); null when there is none. */
  noteTool: string | null;
}

export interface CycleView {
  templateId: string;
  templateName: string;
  language: Language;
  /** How the greeting addresses the person; empty when no name is set. */
  userName: string;
  /** Ceremonies the app offers right now (on in the cycle and with what they need present). */
  ceremonies: Availability;
  /** How the team calls the daily preparation. */
  preDailyLabel: string;
  stages: StageDef[];
  meanings: Pick<CycleMeanings, 'blocker' | 'readyForQa'>;
  /** Words a decision's destination is written with. */
  destination: DestinationLabels;
}

export function buildCycleView(config: WorkspaceConfig, ctx: ViewContext): CycleView {
  const { devCycle, language } = config;
  const terms = userTerms(language, config);
  return {
    templateId: devCycle.templateId,
    templateName: builtInName(devCycle.templateId, language),
    language,
    userName: terms.userName,
    ceremonies: availability(devCycle, ctx),
    preDailyLabel: cycleText(devCycle.ceremonyParams.preDaily.label, language, terms),
    stages: devCycle.stages,
    meanings: { blocker: devCycle.meanings.blocker, readyForQa: devCycle.meanings.readyForQa },
    destination: {
      heading: cycleText(devCycle.specLayout.decisionLog.heading, language, terms),
      noteTool: ctx.noteTool,
      noteFallback: cycleText('cycle.noteFallback', language),
      minutes: cycleText('cycle.minutes', language),
    },
  };
}
