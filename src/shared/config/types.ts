// WorkspaceConfig v2: everything a workspace decides, in one versioned document.
// The JSON schema (schema.ts) and the defaults (defaults.ts) mirror this file; test/config-schema.test.ts fails when they drift apart.
// Paths are stored with a leading "~/" when they live under the home folder, so an exported config stays portable.

export const CONFIG_SCHEMA_VERSION = 2;

export type Language = 'pt-BR' | 'en';
export const LANGUAGES: Language[] = ['pt-BR', 'en'];

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: Theme[] = ['system', 'light', 'dark'];

// The model roles a call can ask for. `run()` in main/agents.ts takes one of these; llm.roles says which provider and model serve it.
export const LLM_ROLES = ['turn', 'reply', 'deep', 'teams', 'fix'] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

// Wire protocol of a provider. anthropic: spoken natively by the Claude Agent SDK (Anthropic, OpenRouter, any gateway that mirrors /v1/messages).
// openai: needs the translation adapter registered in main/llm.ts.
export const PROVIDER_KINDS = ['anthropic', 'openai'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface LlmProvider {
  /** Stable id, referenced by llm.roles. Lowercase letters, digits, "-" and "_". */
  id: string;
  kind: ProviderKind;
  /** API root: https://api.anthropic.com, https://openrouter.ai/api, http://localhost:11434/v1 ... */
  baseUrl: string;
  /** Model ids the provider offers (suggestions for the model picker; any id may still be typed). */
  models: string[];
  /** Reference into the secrets store. null: no key is sent (local model, or the credentials the Claude CLI already has). */
  secretRef: string | null;
  /** Optional Claude-settings-style JSON file whose "env" block (minus KEY/TOKEN variables) is merged into the agent environment. */
  envFile: string | null;
}

export interface RoleModel {
  /** An LlmProvider id. */
  provider: string;
  model: string;
}

export interface LlmConfig {
  providers: LlmProvider[];
  roles: Record<LlmRole, RoleModel>;
}

export interface RepoConfig {
  /** Short name used in cards and prompts (e.g. "api", "web"). */
  id: string;
  /** Local checkout. */
  path: string;
  remoteUrl: string | null;
  /** A VcsIntegration id; null when the repo has no integration. */
  vcsId: string | null;
  /** "group/name" on the host, when it cannot be derived from remoteUrl. */
  projectPath: string | null;
}

export interface IssueProjectConfig {
  /** A VcsIntegration id; null: no issue tracker. */
  vcsId: string | null;
  /** "group/name" of the project that holds the issues. */
  project: string | null;
  /** Numeric id of that project, for APIs that need it. */
  projectId: number | null;
  /** Prefix of a card ref, e.g. "sz4#" for "sz4#15499". Empty: refs are bare numbers. */
  refPrefix: string;
}

export interface ProjectsConfig {
  /** Folders that contain the repos worked on; the first one is the working directory of the agents. */
  roots: string[];
  repos: RepoConfig[];
  /** Also treat the git repos found directly under the roots as projects (consumed by the VCS phase). */
  autoDiscover: boolean;
  issues: IssueProjectConfig;
}

export const VCS_KINDS = ['gitlab', 'github', 'bitbucket'] as const;
export type VcsKind = (typeof VCS_KINDS)[number];
export const CLI_PREFERENCES = ['auto', 'cli', 'api'] as const;
export type CliPreference = (typeof CLI_PREFERENCES)[number];

export interface VcsIntegration {
  id: string;
  kind: VcsKind;
  /** Host without scheme, e.g. "gitlab.example.com" or "github.com". */
  host: string;
  /** API root; empty: derived from host and kind. */
  apiUrl: string;
  /** Login the integration acts as (read-only API use does not need it). */
  user: string;
  /** Reference into the secrets store for an API token. null: rely on the CLI's own login. */
  secretRef: string | null;
  /** auto: CLI when installed, API otherwise. */
  cliPreference: CliPreference;
  /** Executable of the provider CLI; null: the default for the kind (glab, gh). */
  cliCommand: string | null;
}

export interface DocsConfig {
  /** Fill the lists below with what Claude Code itself would load: ~/.claude and <project>/.claude, CLAUDE.md, .mcp.json. */
  autoDetect: boolean;
  /** Folders whose CLAUDE.md is part of the agents' context. */
  claudeMdRoots: string[];
  skillsDirs: string[];
  rulesDirs: string[];
  agentsDirs: string[];
  knowledgeDirs: string[];
  /** Claude-style MCP config files (.mcp.json). */
  mcpConfigFiles: string[];
  /** Folder that holds one subfolder per issue (specs, plans, quizzes). null: the app writes no spec files. */
  specsDir: string | null;
}

export const CEREMONY_IDS = ['preDaily', 'unblock', 'gate', 'qaHandoff', 'retro', 'releaseConflicts'] as const;
export type CeremonyId = (typeof CEREMONY_IDS)[number];

export const STAGE_KINDS = ['backlog', 'development', 'review', 'reviewApproved', 'qa', 'qaApproved', 'returned', 'done'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export interface StageDef {
  id: string;
  label: string;
  /** Case-insensitive regular expressions (source text) tested against the card stage or issue status. */
  match: string[];
  kind: StageKind;
  /** Position in the flow: higher is closer to done. */
  rank: number;
}

export interface PhaseFile {
  /** Base name of a document in the issue's spec folder. */
  file: string;
  /** What having it says about the phase, shown on the card. */
  label: string;
}

export interface GateFiles {
  /** Sub-folder of the spec folder that holds the artifact (bug, feat, investigation). */
  sub: string;
  gate: 1 | 2;
  /** [file, label] pairs, in order of preference. */
  files: [string, string][];
}

export interface SpecLayout {
  /** The spec folder of an issue starts with this text; "{iid}" is replaced by the issue number. */
  folderPrefix: string;
  /** From the most advanced phase to the first one: the first file present decides the phase. */
  phaseFiles: PhaseFile[];
  /** Files that hold the plan, in order of preference. */
  planFiles: string[];
  gateFiles: GateFiles[];
  documents: {
    gateQuiz: string;
    completion: string;
    qaChecklist: string;
  };
}

export interface DevCycleConfig {
  /** Template this section was filled from ("none", "sz-sdd", later: "scrum", "kanban"...). Informational once edited. */
  templateId: string;
  ceremonies: Record<CeremonyId, boolean>;
  stages: StageDef[];
  specLayout: SpecLayout;
  qa: {
    /** Login whose issue notes carry the release branch and pipelines. null: no QA hand-off notes. */
    user: string | null;
  };
}

export interface AgentRoleConfig {
  /** The llm.roles entry this agent role calls. */
  modelRole: LlmRole;
  /** Text appended to the agent's system prompt. */
  extraInstructions: string;
  /** Replaces the built-in role preamble when not empty. */
  promptOverride: string;
}

export interface AgentToolsConfig {
  files: boolean;
  skills: boolean;
  /** Issue tracker MCP tools (get issue / merge request details). */
  trackerMcp: boolean;
  /** Read-only use of the VCS CLI through the shell allow-list. */
  vcsCli: boolean;
  subagents: boolean;
}

export interface AgentsConfig {
  tools: AgentToolsConfig;
  /** Appended to every agent, before the role's own text. */
  extraInstructions: string;
  roles: Record<LlmRole, AgentRoleConfig>;
}

export const VOICE_ENGINES = ['edge', 'kokoro'] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];

export interface VoiceConfig {
  /** Master switch (consumed by the voice-optional phase: when off the app talks about "conversa" instead of "call"). */
  enabled: boolean;
  engine: VoiceEngine;
  /** faster-whisper model name (tiny, base, small, medium...). */
  sttModel: string;
  /** The wizard installed the sidecar dependencies on this machine. */
  depsInstalled: boolean;
  autoStop: boolean;
  silenceMs: number;
  speak: boolean;
  prosody: boolean;
  bargeIn: boolean;
}

export interface CommandConfig {
  enabled: boolean;
  /** Executable; "~/" expands. Never run through a shell. */
  command: string;
}

export interface CardSourceConfig extends CommandConfig {
  /** Arguments that print the cards as the JSON the app reads. */
  reportArgs: string[];
  /** Arguments that store a note on a card; "{ref}" and "{note}" are replaced. Empty: notes are not written back. */
  noteArgs: string[];
  /** File where the tool keeps its state, read to prepend the previous note. null: no previous note. */
  stateFile: string | null;
  timeoutMs: number;
}

export interface ReleaseSyncConfig extends CommandConfig {
  /** Working directory of the tool. null: the projects root. */
  cwd: string | null;
  /** Folder of the bare mirrors the tool keeps; conflict calls may read them. */
  mirrorsDir: string | null;
}

export interface TimeExportConfig extends CommandConfig {
  /** Shape of the exported entries. */
  format: 'none' | 'clockify-log';
}

export interface TerminalConfig {
  /** Terminal emulator to open for "continue in Claude Code". null: try gnome-terminal, then x-terminal-emulator. */
  command: string | null;
  /** Arguments that go before the shell command ("--title", "Coxia", "--"). */
  args: string[];
}

export interface ClaudeCliConfig {
  /** CLI that resumes an agent session (claude, or a wrapper that sets the provider). */
  command: string;
  /** Directory the CLI starts in. null: the projects root. */
  cwd: string | null;
}

export interface ExternalToolsConfig {
  cardSource: CardSourceConfig;
  releaseSync: ReleaseSyncConfig;
  timeExport: TimeExportConfig;
  terminal: TerminalConfig;
  claudeCli: ClaudeCliConfig;
}

export interface ScheduleConfig {
  preDaily: string;
  days: number[];
  statusEveryMin: number;
  from: string;
  to: string;
  retroDay: number;
  retroTime: string;
}

export interface WorkspaceConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  /** False until the setup wizard finishes (or the config was migrated from an existing install). */
  setupComplete: boolean;
  language: Language;
  appearance: { theme: Theme };
  notifications: boolean;
  closeToTray: boolean;
  retention: { enabled: boolean; days: number };
  schedule: ScheduleConfig;
  llm: LlmConfig;
  projects: ProjectsConfig;
  vcs: VcsIntegration[];
  docs: DocsConfig;
  devCycle: DevCycleConfig;
  agents: AgentsConfig;
  voice: VoiceConfig;
  externalTools: ExternalToolsConfig;
}

/** A secret the config needs, found by walking the secretRef fields. */
export interface SecretRequirement {
  ref: string;
  /** Dotted location of the fields that point at it, e.g. "llm.providers.openrouter". */
  usedBy: string[];
  label: string;
}

/** Recursive partial for patches and defaults filling; arrays are replaced whole, never merged. */
export type DeepPartial<T> = T extends (infer U)[] ? U[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
