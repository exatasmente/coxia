// The seam between agents.ts and the open engine. agents.ts builds the SDK options as always; when an engine other than Claude is
// selected, it hands them here and gets back what runOnce returns. The selection itself is a test hook for now (env flags); the
// configuration layer will replace `openEngineFromEnv` with provider -> engine selection.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { ChatClient, type ProviderConfig } from './client';
import { type DocSources, discoverClaudeMd } from './context';
import { EngineError } from './errors';
import { type Capabilities, type OpenRunParams, OpenMaxTurnsError, type RunEvents, runOpen } from './loop';
import { ProviderBudgetError } from '../contract';
import type { Json } from './types';
import { existsSync } from 'node:fs';

export interface OpenEngineSelection {
  provider: ProviderConfig;
  capabilities?: Capabilities;
  structured?: OpenRunParams['structured'];
  docs?: DocSources;
}

// COXIA_ENGINE=open + COXIA_LLM_OPENAI_BASEURL / _MODEL / _KEY. Anything else keeps the Claude engine.
export function openEngineFromEnv(env: NodeJS.ProcessEnv = process.env): OpenEngineSelection | null {
  if (env.COXIA_ENGINE !== 'open') return null;
  const baseUrl = env.COXIA_LLM_OPENAI_BASEURL;
  const model = env.COXIA_LLM_OPENAI_MODEL;
  if (!baseUrl || !model) return null;
  return {
    provider: { baseUrl, model, apiKey: env.COXIA_LLM_OPENAI_KEY || undefined },
    structured: (env.COXIA_LLM_STRUCTURED as OpenRunParams['structured']) || undefined,
    capabilities: env.COXIA_LLM_JSON_SCHEMA === '1' ? { jsonSchema: true } : undefined,
  };
}

// One client per provider and model for the life of the process, so what a server taught it (rejected parameters, reasoning echo) sticks.
const clients = new Map<string, ChatClient>();

export function clientFor(provider: ProviderConfig): ChatClient {
  const key = `${provider.baseUrl}|${provider.model}|${provider.apiKey ? 'k' : ''}`;
  let c = clients.get(key);
  if (!c) {
    c = new ChatClient(provider);
    clients.set(key, c);
  }
  return c;
}

// CLAUDE.md up the tree, and the .claude folders of the working directory and the home: what Claude Code would load.
export function defaultDocSources(cwd: string): DocSources {
  const dirs = (sub: string) => [join(cwd, '.claude', sub), join(homedir(), '.claude', sub)].filter((d) => existsSync(d));
  return {
    claudeMd: discoverClaudeMd(cwd),
    skillDirs: dirs('skills'),
    agentDirs: dirs('agents'),
    docDirs: [join(cwd, '.claude', 'rules'), join(cwd, '.claude', 'knowledge-base')].filter((d) => existsSync(d)),
    mcpConfigs: [join(cwd, '.mcp.json'), join(homedir(), '.claude.json')].filter((f) => existsSync(f)),
  };
}

export interface BridgeArgs {
  selection: OpenEngineSelection;
  prompt: string;
  // The options agents.ts would pass to query(); the engine honours the ones that apply (cwd, tools, hooks, maxTurns, resume, ...).
  options: Options;
  sessionsDir: string;
  secret: { isSecret: (path: string) => boolean; globs: string[] };
  shellEnv?: Record<string, string>;
  extraTools?: OpenRunParams['extraTools'];
  // The folder an agent that writes may change; Write and Edit are only offered with it.
  writeRoot?: string;
  signal?: AbortSignal;
  describeTool?: (name: string, input: Json) => string;
  events?: RunEvents;
  makeMaxTurnsError: (sessionId: string, sources: string[]) => Error;
}

export async function runOpenOnce<T>(a: BridgeArgs): Promise<{ data: T; sessionId: string; sources: string[] }> {
  const o = a.options;
  const append = typeof o.systemPrompt === 'object' && o.systemPrompt && 'append' in o.systemPrompt ? (o.systemPrompt.append ?? '') : '';
  const schema = o.outputFormat && o.outputFormat.type === 'json_schema' ? (o.outputFormat.schema as Json) : undefined;
  const cwd = o.cwd ?? process.cwd();
  try {
    const r = await runOpen<T>({
      role: 'agent',
      prompt: a.prompt,
      schema,
      client: clientFor(a.selection.provider),
      capabilities: a.selection.capabilities,
      structured: a.selection.structured,
      cwd,
      additionalDirectories: o.additionalDirectories,
      systemAppend: append,
      allowedTools: o.allowedTools ?? [],
      disallowedTools: o.disallowedTools,
      noTools: Array.isArray(o.tools) && o.tools.length === 0,
      hooks: o.hooks,
      isSecret: a.secret.isSecret,
      secretGlobs: a.secret.globs,
      docs: a.selection.docs ?? defaultDocSources(cwd),
      maxTurns: o.maxTurns ?? 8,
      resume: o.resume,
      sessionsDir: a.sessionsDir,
      shellEnv: a.shellEnv,
      extraTools: a.extraTools,
      writeRoot: a.writeRoot,
      signal: a.signal,
      describeTool: a.describeTool,
      events: a.events,
    });
    return { data: r.data, sessionId: r.sessionId, sources: r.sources };
  } catch (e) {
    if (e instanceof OpenMaxTurnsError) throw a.makeMaxTurnsError(e.sessionId, e.sources);
    // A refusal by budget is a wait, not a failure of the stage: it goes up as a reason of its own, with the provider that answered.
    if (e instanceof EngineError && e.kind === 'budget') throw new ProviderBudgetError(a.selection.provider.model, 'open', e.message);
    throw e;
  }
}
