import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { LlmRole } from '../../shared/config/types';
import type { ResolvedRole } from '../config-resolve';

// The contract between the ceremonies (main/agents.ts `run`) and an agent engine.
// An engine takes one structured request and returns the model's JSON answer plus the sources it read; it never knows about ceremonies.
//   claude-sdk  main/agents.ts (runClaudeSdk): the Claude Agent SDK, for Claude models on Anthropic, Bedrock, Vertex and Foundry.
//   open        main/engine/open/: the app's own loop for OpenAI-compatible and local providers. Registers itself with registerEngine().

export type Schema = Record<string, unknown>;

export interface Run<T> {
  data: T;
  sessionId: string;
  sources: string[];
  /** The agent ran out of turns and answered from what it had already read. */
  partial?: true;
}

/** Thrown by an engine whose agent hit its turn limit; `run` then resumes the session once, without tools, for a partial answer. */
export class MaxTurnsError extends Error {
  constructor(
    readonly sessionId: string,
    readonly sources: string[],
  ) {
    super('agent ended with error_max_turns');
  }
}

/** The read-only shell the agent may use: SDK permission rules plus the allow-list the hook enforces (see agents.ts). */
export interface ShellPolicy {
  rules: string[];
  patterns: RegExp[];
}

export interface EngineRequest {
  role: LlmRole;
  prompt: string;
  /** JSON Schema of the answer. */
  schema: Schema;
  /** The resolved provider and model serving this role (llm.roles + agents.roles). */
  target: ResolvedRole;
  /** Final system prompt: role preamble, the agent rules from the config and the VCS hints. */
  system: string;
  /** Working directory of the agent. */
  cwd: string;
  /** Tool names the role may use without asking (Read, Grep, Glob, Skill, MCP tools, Agent, Bash(...) rules). Everything else is denied. */
  allowedTools: string[];
  /** Folders besides cwd the agent may read (configured docs sources outside the working directory). */
  extraDirs: string[];
  shell: ShellPolicy;
  /** Per-call options of the Claude Agent SDK: resume, maxTurns, tools. Other engines read maxTurns and resume and may ignore the rest. */
  extra: Partial<Options>;
}

export type EngineRunner = <T>(request: EngineRequest) => Promise<Run<T>>;
