import type { LlmConfig, LlmProvider } from './types';

// The "signed-in Claude Code CLI": an anthropic provider on the Claude Agent SDK saved with no key. The SDK child then authenticates with the
// login the CLI of this machine already has; the app offers no login and never reads the CLI's credential files.

export function isSignedIn(p: Pick<LlmProvider, 'kind' | 'engine' | 'secretRef' | 'legacyCustomEndpoint'>): boolean {
  return p.kind === 'anthropic' && p.engine === 'claude-sdk' && !p.secretRef && !p.legacyCustomEndpoint;
}

/** The provider the budget fallback uses: the first signed-in one. null: there is none, and a refusal for budget waits as it always did. */
export function signedInProvider(llm: Pick<LlmConfig, 'providers'>): LlmProvider | null {
  return llm.providers.find(isSignedIn) ?? null;
}

/** The fallback is on and lists this agent (a built-in agent's id is its role). Says nothing of the provider or the workspace. */
export function fallbackListed(llm: Pick<LlmConfig, 'cliFallback'>, agentId: string): boolean {
  const f = llm.cliFallback;
  return !!f?.enabled && f.agents.includes(agentId);
}
