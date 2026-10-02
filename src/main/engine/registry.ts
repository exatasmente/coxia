import type { EngineId, LlmRole } from '../../shared/config/types';
import type { ResolvedRole } from '../config-resolve';
import { rc } from '../workspaceConfig';
import type { EngineRunner } from './contract';

// Engines register themselves; agents.ts picks one per call from the provider the role is mapped to.
const engines = new Map<EngineId, EngineRunner>();

export function registerEngine(id: EngineId, runner: EngineRunner): void {
  engines.set(id, runner);
}

export function hasEngine(id: EngineId): boolean {
  return engines.has(id);
}

/** The provider, model and engine that serve a role in the current workspace. This is the seam for choosing an engine. */
export function engineFor(role: LlmRole): ResolvedRole {
  return rc().role(role);
}

export function runnerFor(target: ResolvedRole): EngineRunner {
  const runner = engines.get(target.engine);
  if (!runner) {
    throw new Error(
      target.engine === 'open'
        ? `O provedor "${target.providerId}" usa o motor aberto, que não está instalado nesta versão do app.`
        : `Nenhum motor "${target.engine}" registrado para o provedor "${target.providerId}".`,
    );
  }
  return runner;
}
