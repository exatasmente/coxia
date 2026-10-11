import { personaOf } from '../../shared/config/team';
import { PERSON_WHO, type Who, personaWho } from '../../shared/runs';
import { viaOf } from '../rpc';
import { getConfig } from '../workspaceConfig';

// Who a record of "the person did this" is worded as (#248): the persona when the call is one of its open acts, the person for every other call. Read at the top of a
// handler, before it awaits: the act's scope closes when the handler settles, and a record written later is not the persona's.

/** The persona's id in this workspace; `persona` when there is none (an act cannot be open then, so this is only a floor). */
export const personaIdNow = (): string => personaOf(getConfig().agents.team)?.id ?? 'persona';

export function whoNow(): Who {
  return viaOf() === 'persona' ? personaWho(personaIdNow()) : PERSON_WHO;
}

/** Whether the call being served is the persona's. */
export const byPersona = (): boolean => viaOf() === 'persona';
