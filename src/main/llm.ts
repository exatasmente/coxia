import type { ResolvedRole } from './config-resolve';
import { readProfileEnv, sdkEnv } from './llm-core';
import { SecretError } from './secrets-core';
import { secrets } from './secrets';
import { getConfig, rc } from './workspaceConfig';
import { vcsShellEnv } from './vcs/readPolicy';
import { t } from '../shared/i18n';

/** The key of a provider, or null when it has none (local server, machine credentials). A configured ref with no source is an error, never a silent no-key call. */
export function providerSecret(secretRef: string | null): string | null {
  if (!secretRef) return null;
  try {
    return secrets().resolve(secretRef);
  } catch (e) {
    if (e instanceof SecretError) throw new Error(t('main.llm.keyMissing', { ref: secretRef, reason: e.message }));
    throw e;
  }
}

/** The environment of a Claude Agent SDK child for the provider that serves this role. */
export function claudeSdkEnv(target: ResolvedRole): Record<string, string> {
  return sdkEnv({ target, base: process.env, secret: providerSecret(target.secretRef), profile: readProfileEnv(target.envFile), vcsHost: rc().primaryVcs?.kind === 'gitlab' ? rc().vcsHost : null, extraEnv: rc().primaryVcs?.kind === 'github' ? vcsShellEnv() : undefined });
}

const isOpenRouter = (baseUrl: string): boolean => {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai';
  } catch {
    return false;
  }
};

/** The OpenRouter provider of this workspace, if it has one (the cost screens and the health check are OpenRouter features). */
export function openRouterProvider() {
  return getConfig().llm.providers.find((p) => isOpenRouter(p.baseUrl)) ?? null;
}

/** The OpenRouter key. Throws when the workspace has no OpenRouter provider or its secret is not configured. */
export function openRouterKey(): string {
  const p = openRouterProvider();
  if (!p) throw new Error(t('main.llm.noOpenRouter'));
  const key = providerSecret(p.secretRef);
  if (!key) throw new Error(t('main.llm.openRouterNoKey'));
  return key;
}
