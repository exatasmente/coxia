import { recordWrite } from '../auditoria';
import { logError } from '../errorlog';
import { ATAS } from '../env';
import { pluginNotes } from '../plugins/module';
import { getConfig, rc } from '../workspaceConfig';
import { createProcedureOffers, type ProcedureOffers } from './offers';
import type { ScreenMarks } from './screen';
import { createProceduresPort, type ProceduresPort } from './port';
import { createProcedureStore } from './store';

export type { OpenContext, ProceduresPort } from './port';
export type { Offer, OfferInput, ProcedureOffers } from './offers';

/** The model's context window for an agent, when its provider says it; a failure to resolve the model leaves the list at its full size. */
export function contextWindowOf(model: Parameters<ReturnType<typeof rc>['agentModel']>[0]): number | null {
  try {
    return rc().agentModel(model).capabilities?.contextWindow ?? null;
  } catch {
    return null;
  }
}

let port: ProceduresPort | null = null;

/** The running workspace's door to its procedures, over its own folder. One for the process, as the shared activities memory is. */
export const proceduresPort = (): ProceduresPort => (port ??= createProceduresPort({ config: getConfig, dir: ATAS, pluginNames: () => pluginNotes().map((p) => p.name), audit: recordWrite, contextWindow: contextWindowOf, onError: logError }));

let screens: () => ScreenMarks | null = () => null;
let offers: ProcedureOffers | null = null;

/** The screens the offers move a draft mark in: given by the module that starts them, as they do not exist when the process starts. */
export function offerScreens(get: () => ScreenMarks | null): void {
  screens = get;
}

/** The workspace's offers to keep a procedure, in memory. One for the process, as the port is: a workspace switch restarts the app. */
export const procedureOffers = (): ProcedureOffers =>
  (offers ??= createProcedureOffers({ store: createProcedureStore(ATAS, { onError: (e) => logError('procedures', e) }), config: getConfig, sessions: () => screens(), audit: recordWrite }));
