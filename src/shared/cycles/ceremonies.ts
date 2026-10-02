import { CEREMONY_IDS, type CeremonyId, type DevCycleConfig } from '../config/types';

// Which ceremonies the app offers. A ceremony is on when the cycle says so, and available when what it works on exists: the gate needs
// artifacts to quiz, the QA hand-off needs spec folders to read and write. A ceremony that is off is hidden, not greyed out.

/** Facts about the workspace that a ceremony depends on. */
export interface CeremonyContext {
  /** docs.specsDir is configured: spec folders can be read and written. */
  specs: boolean;
}

export type Availability = Record<CeremonyId, boolean>;

export function ceremonyAvailable(cycle: Pick<DevCycleConfig, 'ceremonies' | 'specLayout'>, id: CeremonyId, ctx: CeremonyContext): boolean {
  if (cycle.ceremonies[id] === false) return false;
  switch (id) {
    case 'gate':
      return ctx.specs && cycle.specLayout.gateFiles.length > 0;
    case 'qaHandoff':
      return ctx.specs;
    default:
      return true;
  }
}

export function availability(cycle: Pick<DevCycleConfig, 'ceremonies' | 'specLayout'>, ctx: CeremonyContext): Availability {
  return Object.fromEntries(CEREMONY_IDS.map((id) => [id, ceremonyAvailable(cycle, id, ctx)])) as Availability;
}
