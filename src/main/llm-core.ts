import { readFileSync } from 'node:fs';
import type { ResolvedRole } from './config-resolve';

// The environment a Claude Agent SDK child gets for a provider. Pure: the secret, the profile file and the process environment come in.

// Variables inherited from a Claude Code or Claude Desktop session make the child ignore the provider routing.
const INHERITED = /^(CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDE_PREVIEW_|ANTHROPIC_)|^CLAUDE_(PID|EFFORT)$/;
const OFFICIAL = /^https:\/\/api\.anthropic\.com\/?$/;

export interface SdkEnvInput {
  target: Pick<ResolvedRole, 'kind' | 'baseUrl' | 'options'>;
  base: NodeJS.ProcessEnv;
  /** The provider's key, or null when it has none. */
  secret: string | null;
  /** Non-secret variables from the provider's env file. */
  profile: Record<string, string>;
  vcsHost: string | null;
}

/** The variables of a Claude-settings-style JSON file's "env" block, without anything that looks like a key or token. */
export function readProfileEnv(file: string | null): Record<string, string> {
  if (!file) return {};
  try {
    const settings = JSON.parse(readFileSync(file, 'utf8')) as { env?: Record<string, string> };
    return Object.fromEntries(Object.entries(settings.env ?? {}).filter(([k]) => !/KEY|TOKEN/.test(k)));
  } catch {
    return {};
  }
}

export function sdkEnv(input: SdkEnvInput): Record<string, string> {
  const { target, secret } = input;
  const keepApiKey = target.kind === 'anthropic' && !secret;
  const clean = Object.fromEntries(
    Object.entries(input.base).filter((e): e is [string, string] => e[1] !== undefined && (!INHERITED.test(e[0]) || (keepApiKey && e[0] === 'ANTHROPIC_API_KEY'))),
  );
  const out: Record<string, string> = { ...clean, ...input.profile };
  const o = target.options;
  switch (target.kind) {
    case 'anthropic':
      if (target.baseUrl) out.ANTHROPIC_BASE_URL = target.baseUrl;
      if (secret) {
        if (OFFICIAL.test(target.baseUrl)) out.ANTHROPIC_API_KEY = secret;
        else {
          // Gateways such as OpenRouter authenticate with a bearer token and ignore x-api-key.
          out.ANTHROPIC_AUTH_TOKEN = secret;
          out.ANTHROPIC_API_KEY = '';
        }
      }
      break;
    case 'bedrock':
      out.CLAUDE_CODE_USE_BEDROCK = '1';
      if (o.region) out.AWS_REGION = o.region;
      if (o.profile) out.AWS_PROFILE = o.profile;
      if (target.baseUrl) out.ANTHROPIC_BEDROCK_BASE_URL = target.baseUrl;
      if (secret) out.AWS_BEARER_TOKEN_BEDROCK = secret;
      break;
    case 'vertex':
      out.CLAUDE_CODE_USE_VERTEX = '1';
      if (o.project) out.ANTHROPIC_VERTEX_PROJECT_ID = o.project;
      if (o.region) out.CLOUD_ML_REGION = o.region;
      if (target.baseUrl) out.ANTHROPIC_VERTEX_BASE_URL = target.baseUrl;
      break;
    case 'foundry':
      out.CLAUDE_CODE_USE_FOUNDRY = '1';
      if (o.resource) out.ANTHROPIC_FOUNDRY_RESOURCE = o.resource;
      if (target.baseUrl) out.ANTHROPIC_FOUNDRY_BASE_URL = target.baseUrl;
      if (secret) out.ANTHROPIC_FOUNDRY_API_KEY = secret;
      break;
    case 'openai-compatible':
      throw new Error('o Claude Agent SDK não atende um provedor openai-compatible; use o motor aberto');
  }
  // Outside a git checkout glab falls back to gitlab.com.
  if (input.vcsHost) out.GITLAB_HOST = input.vcsHost;
  return out;
}
