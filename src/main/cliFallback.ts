import type { EngineId, LlmConfig } from '../shared/config/types';
import { fallbackListed, signedInProvider } from '../shared/config/signedIn';
import { t } from '../shared/i18n';
import type { ResolvedRole } from './config-resolve';
import { MaxTurnsError, ProviderBudgetError, type Run } from './engine/contract';
import { redact } from './errorlog-core';
import { withoutPool } from './modelPick';
import { isTestWorkspace } from './workspace';
import { getConfig, rc } from './workspaceConfig';

// The budget fallback on the signed-in Claude Code CLI: when the provider of a listed agent refuses a call for budget, the call is made once more on the
// anthropic provider saved with no key, which the CLI of this machine authenticates with its own login. Nothing here reads a credential or checks the login
// beforehand: a CLI that is missing or signed out fails the retry, and the call waits on the original refusal as it always did.

export interface FallbackInput {
  llm: Pick<LlmConfig, 'providers' | 'cliFallback'>;
  /** A test workspace refuses the fallback (fails closed, like the rest of the app). */
  test: boolean;
  agentId: string;
  /** The provider that refused. */
  refused: string;
  /** The model the call asked for: kept when the fallback lists it. */
  model: string;
  /** The engine of the session a round continues (absent: a new call). Only a session of the SDK can continue on the CLI. */
  resumeEngine?: EngineId;
}

/** Where the retry goes, or null when the call waits as today: off, not listed, a test workspace, no keyless provider, or the refusal came from the fallback itself. */
export function fallbackTarget(i: FallbackInput): { provider: string; model: string } | null {
  if (i.test || !fallbackListed(i.llm, i.agentId)) return null;
  if (i.resumeEngine !== undefined && i.resumeEngine !== 'claude-sdk') return null;
  const p = signedInProvider(i.llm);
  if (!p || p.id === i.refused) return null;
  return { provider: p.id, model: p.models.includes(i.model) ? i.model : (p.models[0] ?? i.model) };
}

/** The reset time the SDK's rate limit event gives, as epoch ms. The unit was not confirmed against a live CLI, so a value that can only be seconds is taken as seconds. */
export function resetMs(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
}

export interface FallbackDeps {
  llm: () => FallbackInput['llm'];
  test: () => boolean;
  resolve: (provider: string, model: string, primary: ResolvedRole) => ResolvedRole;
}

const liveDeps: FallbackDeps = {
  llm: () => getConfig().llm,
  test: isTestWorkspace,
  resolve: (provider, model, primary) => ({ ...withoutPool(rc().agentModel({ role: null, provider, model }, primary.role)), role: primary.role, modelRole: primary.modelRole }),
};

/**
 * Runs `first` and, when it ends in a refusal for budget that the fallback covers, `retry` once on the signed-in CLI. The fallback's own refusal (its usage limit,
 * with the reset time) and a call that ran out of turns are its answer; any other failure of the retry leaves the original refusal, with the reason beside it.
 */
export async function withBudgetFallback<T>(
  call: { agentId: string; primary: ResolvedRole; resumeEngine?: EngineId; onFallback?: (provider: string) => void },
  first: () => Promise<Run<T>>,
  retry: (target: ResolvedRole) => Promise<Run<T>>,
  deps: FallbackDeps = liveDeps,
): Promise<Run<T>> {
  try {
    return await first();
  } catch (e) {
    if (!(e instanceof ProviderBudgetError)) throw e;
    const to = fallbackTarget({ llm: deps.llm(), test: deps.test(), agentId: call.agentId, refused: e.provider || call.primary.providerId, model: call.primary.model, ...(call.resumeEngine ? { resumeEngine: call.resumeEngine } : {}) });
    if (!to) throw e;
    const target: ResolvedRole = { ...deps.resolve(to.provider, to.model, call.primary), loginOnly: true };
    call.onFallback?.(to.provider);
    try {
      const r = await retry(target);
      return { ...r, engine: target.engine };
    } catch (again) {
      if (again instanceof ProviderBudgetError || again instanceof MaxTurnsError) throw again;
      const reason = redact(again instanceof Error ? again.message : String(again)).slice(0, 300);
      throw new ProviderBudgetError(e.provider, e.engine, `${e.detail} ${t('main.engine.cliFallback.failed', { reason })}`.trim(), e.until);
    }
  }
}
