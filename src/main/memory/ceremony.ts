import type { AgentDef } from '../../shared/config/types';
import { prompt as cp } from '../cyclePrompts';
import { fence } from '../runner/prompt';
import type { MemoryOpenContext } from './port';
import type { MemorySession } from './session';

// The seam the ceremonies read the memory through. A ceremony agent (the five system agents behind `askAgent`, and an agent named inside a ceremony) reads and never writes: its
// session has no write tool, makes no folder and leaves no notice, and its facts come from the cache, so no turn of a voice session waits for git. `askAgent` has no dependency
// object, so the door is registered once by the memory module at start; without it every ceremony call is what it was.

export interface CeremonyMemoryAsk {
  /** The system agent of the role, or the team agent named in the ceremony. */
  agent: MemoryOpenContext['agent'];
  /** False: the `teams` role has no tools at all, so it gets the list and nothing to open an entry with. */
  tools: boolean;
}

export type CeremonyMemoryOpen = (ask: CeremonyMemoryAsk) => Promise<MemorySession | null>;

let opener: CeremonyMemoryOpen | null = null;

/** Registers (or, with null, removes) the door a ceremony asks for its memory. */
export function setCeremonyMemory(open: CeremonyMemoryOpen | null): void {
  opener = open;
}

/** The session of a ceremony call, or null when no door is registered, the workspace's switch is off or the memory could not be opened. */
export async function openCeremonyMemory(ask: CeremonyMemoryAsk): Promise<MemorySession | null> {
  if (!opener) return null;
  try {
    return await opener(ask);
  } catch {
    return null;
  }
}

/** What a ceremony call adds to its system text and to the end of its prompt for a session it was given. The prompt's opening is how the cost and retention screens recognise it, so the section goes last. */
export function ceremonyAddition(session: MemorySession): { system: string; prompt: string } {
  return session.tools
    ? { system: cp('runner.rules.sharedMemory'), prompt: cp('runner.section.sharedIndex', { text: fence(session.list.text) }) }
    : { system: '', prompt: cp('runner.section.sharedIndexList', { text: fence(session.list.text) }) };
}

/** The agent a ceremony role is: its system agent of the team, else the id alone, which is all a read-only session needs. */
export const ceremonyAgent = (team: readonly AgentDef[], role: string): MemoryOpenContext['agent'] => {
  const found = team.find((a) => a.id === role && a.system);
  return found ?? ({ id: role, permission: 'read', model: { role: null, provider: '', model: '' } } as MemoryOpenContext['agent']);
};
