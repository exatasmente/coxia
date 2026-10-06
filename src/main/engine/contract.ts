import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentToolsConfig, LlmRole } from '../../shared/config/types';
import type { RunActivity } from '../activity';
import type { ResolvedRole } from '../config-resolve';
import type { UsageReport } from '../../shared/runs/usage';
import type { SandboxSession } from '../sandbox/session';

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
    // i18n-ignore: error text the engine compares
    super('agent ended with error_max_turns');
  }
}

/**
 * Thrown by an engine when the provider refused the call because the key ran out of budget. It is not a failure of the stage: the runner turns it into a
 * wait, names the provider in words the person reads, and does not spend an attempt on it. `detail` is the provider's own text, already redacted.
 */
export class ProviderBudgetError extends Error {
  constructor(
    readonly provider: string,
    readonly engine: 'claude-sdk' | 'open',
    readonly detail: string,
  ) {
    // i18n-ignore-next-line: error text the caller reads and the engines compare
    super(`provider budget exhausted: ${provider}`);
    this.name = 'ProviderBudgetError';
  }
}

/** The read-only shell the agent may use: SDK permission rules plus the allow-list the hook enforces (see agents.ts). */
export interface ShellPolicy {
  rules: string[];
  patterns: RegExp[];
}

/** What an agent that writes is confined to: only a stage of a run whose agent has the `worktree` permission carries one. */
export interface Confinement {
  /** The run's worktree: the only folder the agent may change, and its working directory. */
  root: string;
  /** The hooks that enforce it (runner/hooks.ts). Both engines run these same callbacks, so a refusal is the same on either. */
  hooks: NonNullable<Options['hooks']>;
}

export interface CommandAsk {
  /** The agent's own rules (`allowedCommands`). */
  rules: string[];
  request(command: string): Promise<{ ok: boolean; note?: string }>;
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
  /** The tools the agent of this call uses: its own when it names them, else the workspace's. Absent: the workspace's. */
  tools?: AgentToolsConfig;
  /** Set for an agent that may change files; read-only calls leave it out and keep the policy of the ceremonies. */
  confine?: Confinement;
  /**
   * How much of the code host the call may read. `workspace` (the default, what the ceremonies and a reader with `tracker: read` get): the host CLI allow-list, the `VcsRead`
   * tool and the tracker MCP tools the workspace switched on. `tool`: only the `VcsRead` tool (an agent that writes with `tracker: read`: no CLI, no MCP server).
   * `none`: nothing of the host.
   */
  tracker?: 'workspace' | 'tool' | 'none';
  /**
   * The call reads no documentation of Claude Code: neither the `CLAUDE.md` and `.claude/` of the working directory or the home, nor its settings and its automatic
   * memory. Set for the agents of the team (`runAgent`); the ceremonies leave it off and read what they read.
   */
  isolated?: boolean;
  /** The `ReleaseAction` tool of a release run's agent: one step of the release, answered in text. Absent for every other call. */
  release?: (input: unknown) => Promise<string>;
  /** The stage's sandbox, for an agent set to `shell: sandbox`: the engine offers the `Shell` tool over it, and leaves its own Bash off. */
  exec?: SandboxSession;
  /**
   * A ceremony agent: a command the code does not allow is asked of the person instead of refused (the call waits for the answer), and the rules the person
   * gave the agent ("allow always") let a command through without asking. Never for a write to the code host, which is asked every time.
   */
  ask?: CommandAsk;
  /** Aborting it stops the call (a stage that ran past its limit, a cancelled run). */
  abort?: AbortController;
  /** Called once per model call with what it used (and what it cost, when the provider or the SDK said). */
  onUsage?: (usage: UsageReport) => void;
  /** Called at every sign of life from the model: a piece of text, a tool call, a usage report, a message of the SDK. */
  beat?: () => void;
  /** Where the engine reports what it is doing (tool calls, narration, blocked calls); the run's own states are reported by `run`. */
  activity?: RunActivity;
}

export type EngineRunner = <T>(request: EngineRequest) => Promise<Run<T>>;
