import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AttachmentRef } from '../../shared/attachments';
import type { AgentToolsConfig, LlmRole } from '../../shared/config/types';
import type { RunActivity } from '../activity';
import type { ResolvedRole } from '../config-resolve';
import type { UsageReport } from '../../shared/runs/usage';
import type { SandboxSession } from '../sandbox/session';
import type { EvidenceTools } from '../evidence/tool';

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
  /** The run's worktree: its working directory, which it may read whole, and the only folder it may change unless `writeRoot` narrows that. */
  root: string;
  /** A folder inside `root` that is the only place the agent may change; absent: the whole of `root`. Reads stay on `root`. */
  writeRoot?: string;
  /** Names directly under `writeRoot` the app owns and the agent may not write. */
  writeReserved?: readonly string[];
  /** Exact relative file paths the agent may write, when a task has a single-file output. */
  writeAllow?: readonly string[];
  /** The hooks that enforce it (runner/hooks.ts). Both engines run these same callbacks, so a refusal is the same on either. */
  hooks: NonNullable<Options['hooks']>;
}

/**
 * What a reading agent of a run is confined to: the run's worktree and the documentation folders it was given. Only a call of a run
 * carries one, and it never opens a tool: it says where the file tools may look, so a reader stays a reader.
 */
export interface ReadConfinement {
  /** The run's worktree: the only folder a file tool may touch, besides `roots`. */
  root: string;
  /** Absolute folders the config lists as documentation outside the worktree, which the reader may still reach. */
  roots: string[];
  /** The hooks that enforce it (runner/hooks.ts, `readConfinedHooks`): the read policy plus the path guard, never one instead of the other. */
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
   * Set for an agent of a run that only reads: its file tools (`Read`, `Grep`, `Glob`) are confined to `root` and `roots`, and it is offered no `Edit`, no `Write` and no shell.
   * A call with `confine` leaves this out, and so does every call outside a run (a ceremony, a channel): neither has a worktree to be confined to.
   */
  read?: ReadConfinement;
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
  /**
   * The call carries no tool and no documentation at all: no native tool, no app tool, no MCP server (the person's included), and neither the engine's own discovery
   * of a `CLAUDE.md` nor an index of documentation folders reaches the system text. The model gets the system text, the prompt and the answer's schema, nothing else.
   * Set by `askBare` only; the engine's own transport of the structured answer (`final_answer` on the open engine) stays, since it is not a capability.
   */
  bare?: boolean;
  /** The `ReleaseAction` tool of a release run's agent: one step of the release, answered in text. Absent for every other call. */
  release?: (input: unknown) => Promise<string>;
  /**
   * The conversation the agent was called in and the files the message carries: with them the call gets the read-only `ConversationAttachment` tool,
   * scoped to that conversation. Absent: no attachment tool (a stage's own agent opens the files through the message section instead).
   */
  attachments?: { thread: string; refs: readonly AttachmentRef[] };
  /** The stage's sandbox, for an agent set to `shell: sandbox`: the engine offers the `Shell` tool over it, and leaves its own Bash off. */
  exec?: SandboxSession;
  /**
   * A call that continues the session of the call before it (`resume`): the same dialog and the same tools, with one prompt of the app in between. Absent: the
   * call opens its own session and starts from its prompt alone.
   */
  resume?: string;
  /** The evidence tools of a stage that keeps evidence (a stage with a sandbox): the engines offer them next to the `Shell` tool. */
  evidence?: EvidenceTools;
  /**
   * A picture of the stage's output folder the agent opened with `ViewImage`: the file it looked at, told the moment it looked. What a stage saw and did not keep
   * is kept (or said as seen and not kept) while its sandbox is still open; an evidence id it looked at is not reported (it is already kept).
   */
  onLooked?: (path: string) => void;
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
  /**
   * The door of a stage that talks while it works: the engine calls it after every step of the model (with the results of its tools, and when it stops without a
   * final answer), and gets back the next message to deliver into the session, or null at once when there is none. `delivered` is called the moment the message entered the session (the app writes
   * its line). Absent: the call is the one of today, a single pass.
   */
  incoming?: (delivered: (text: string) => void) => Promise<string | null>;
  /**
   * The app tools of a stage that talks while it works (`SendMessage`, `CallAgent`), or of a called agent (`AskConversation`), already built as engine-neutral
   * tools (runner/tools.ts). The engine offers each one when its name is in `allowedTools`; absent: the call gets none of them.
   */
  runnerTools?: import('./open/tools/types').ToolImpl[];
}

export type EngineRunner = <T>(request: EngineRequest) => Promise<Run<T>>;
