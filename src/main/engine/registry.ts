import type { EngineId, LlmRole } from '../../shared/config/types';
import type { ResolvedRole } from '../config-resolve';
import { rc } from '../workspaceConfig';
import type { EngineRunner } from './contract';
import { t } from '../../shared/i18n';

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
        ? t('main.engine.noOpenEngine', { provider: target.providerId })
        : t('main.engine.noEngine', { engine: target.engine, provider: target.providerId }),
    );
  }
  return runner;
}
