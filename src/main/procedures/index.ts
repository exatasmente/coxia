import { recordWrite } from '../auditoria';
import { logError } from '../errorlog';
import { ATAS } from '../env';
import { pluginNotes } from '../plugins/module';
import { getConfig, rc } from '../workspaceConfig';
import { createProceduresPort, type ProceduresPort } from './port';

export type { OpenContext, ProceduresPort } from './port';

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
