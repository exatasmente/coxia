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

// How a provider is reached. anthropic, bedrock, vertex and foundry are the ways to run Claude (API key or cloud credentials; never a claude.ai
// subscription login, which Anthropic does not allow third-party apps to offer). openai-compatible covers hosted and local OpenAI-style servers.
export const PROVIDER_KINDS = ['anthropic', 'bedrock', 'vertex', 'foundry', 'openai-compatible'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

// The agent loop that serves a provider. claude-sdk: the Claude Agent SDK (Claude models only). open: the app's own open-source loop,
// for OpenAI-compatible and local providers (src/main/engine/open/, built separately; it plugs in through main/engine/registry.ts).
export const ENGINES = ['claude-sdk', 'open'] as const;
export type EngineId = (typeof ENGINES)[number];

export function defaultEngine(kind: ProviderKind): EngineId {
  return kind === 'openai-compatible' ? 'open' : 'claude-sdk';
}

export const STRUCTURED_MODES = ['auto', 'response_format', 'tool', 'prompt'] as const;
export type StructuredMode = (typeof STRUCTURED_MODES)[number];

/** What the wizard's "test connection" found out about an open-engine provider; the engine adapts to it. null when never tested. */
export interface ProviderCapabilities {
  chat: boolean;
  tools: boolean;
  jsonSchema: boolean;
  streaming: boolean;
  reasoning: boolean;
  /** Context window in tokens, when the server reports it. */
  contextWindow: number | null;
}

export interface LlmProvider {
  /** Stable id, referenced by llm.roles. Lowercase letters, digits, "-" and "_". */
  id: string;
  kind: ProviderKind;
  /** Which agent loop serves this provider. claude-sdk needs a Claude-capable kind (anything but openai-compatible). */
  engine: EngineId;
  /** API root: https://api.anthropic.com, https://openrouter.ai/api, http://localhost:11434/v1 ... Cloud kinds may leave it empty. */
  baseUrl: string;
  /** Model ids the provider offers (suggestions for the model picker; any id may still be typed). */
  models: string[];
  /**
   * Reference into the secrets store (API key). null: send no key, which is right for a local server and for the cloud kinds that use the
   * machine's own credentials (AWS default chain, gcloud application default credentials, az login).
   */
  secretRef: string | null;
  /** Optional Claude-settings-style JSON file whose "env" block (minus KEY/TOKEN variables) is merged into the agent environment. */
  envFile: string | null;
  /** Kind-specific, non-secret settings. bedrock: region, profile. vertex: project, region. foundry: resource. */
  options: Record<string, string>;
  /** Open engine: result of the connection test. null: untested (the engine tries tools and structured output and learns what the server rejects). */
  capabilities: ProviderCapabilities | null;
  /** Open engine: how the JSON answer is obtained. auto: response_format when the probe confirmed it, else a final_answer tool, else prompt + repair. */
  structured: StructuredMode;
  /** Open engine: extra headers some gateways want (OpenRouter's HTTP-Referer and X-Title). Never put a key here. */
  headers: Record<string, string>;
  /** Open engine: cap on one call's output; null: the server's own default. */
  maxOutputTokens: number | null;
  /** Open engine: sampling temperature; null: the server's own default. */
  temperature: number | null;
  /** Open engine: limit of one whole call in ms (a local model may need minutes to load); null: the engine's default. */
  timeoutMs: number | null;
  /**
   * The Claude Agent SDK is pointed at a non-Anthropic endpoint (non-Claude models). Anthropic does not support that; it exists so an
   * install made before the configuration keeps working. Never set by the wizard, never offered to a fresh install.
   */
  legacyCustomEndpoint: boolean;
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
  /** Prefix of a card ref, e.g. "app#" for "app#101". Empty: refs are bare numbers. */
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

export const STAGE_KINDS = ['backlog', 'development', 'review', 'reviewApproved', 'qa', 'qaApproved', 'returned', 'done', 'blocked'] as const;
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
  /** The section of the plan where the decisions taken in the ceremonies are recorded. */
  decisionLog: {
    /** Heading text (matched as a substring of a "##" heading). Empty: decisions are never written into the plan, they stay in the minutes. */
    heading: string;
  };
  documents: {
    gateQuiz: string;
    completion: string;
    qaChecklist: string;
  };
}

/**
 * Where a provider carries the stage of an issue. label: a (scoped) label; status: the issue status (GitLab work item status);
 * field: a project board field (GitHub Projects v2; `name` is the field); state: the open/closed style state (Bitbucket and GitHub issues);
 * column: a board column.
 */
export const STAGE_SOURCES = ['label', 'status', 'field', 'state', 'column'] as const;
export type StageSource = (typeof STAGE_SOURCES)[number];

export interface StageMappingRule {
  /** Which kind of provider the rule is for; "any" applies to all of them. */
  provider: VcsKind | 'any';
  source: StageSource;
  /** For source "field": the name of the project field (e.g. "Status"). Empty for the others. */
  name: string;
  /** Case-insensitive regular expression tested against the label, status, field value, state or column. */
  pattern: string;
  /** The StageDef id the match maps to. */
  stage: string;
}

/** The roles a prompt is written for; each is one family of agent calls (the ids in each are in cycles/prompts.ts). */
export const PROMPT_ROLES = ['turn', 'reply', 'deep', 'teams', 'gate', 'qa', 'retro', 'conflict'] as const;
export type PromptRole = (typeof PROMPT_ROLES)[number];

/** Fields of a card that the agent is shown. */
export const CARD_FIELDS = ['ref', 'iid', 'title', 'stage', 'mrs', 'mrPaths', 'blockers', 'pending', 'changes', 'note', 'url'] as const;
export type CardField = (typeof CARD_FIELDS)[number];

/** Parameters of each ceremony. A text parameter is a catalog key or a literal, in the language of the team. */
export interface CeremonyParams {
  preDaily: {
    /** How the team calls this ceremony ("pré-daily", "daily scrum", "standup"). */
    label: string;
    /** Words of the spoken turn of each agent. */
    speechWords: number;
    /** Reads of the spec the agent may do while preparing its turn; 0 tells it not to read. */
    specReads: number;
    /** Where the team summary of the ceremony is pasted (Teams, Slack...). Empty: a generic team chat. */
    summaryTarget: string;
    /** How the summary is written: greeting, sections, length. */
    summaryStyle: string;
  };
  unblock: { speechWords: number };
  gate: {
    /** Most questions of one quiz round. */
    maxQuestions: number;
    /** The kinds of consequence question a quiz may use. */
    questionKinds: string[];
    summaryWords: number;
  };
  qaHandoff: { speechWords: number };
  retro: {
    /** Days the retro looks back over. */
    windowDays: number;
    speechWords: number;
  };
  releaseConflicts: { speechWords: number };
}

/** What the team means by the words the agents use. A text is a catalog key or a literal and may carry {userName}, {theUser}, {ofUser}. */
export interface CycleMeanings {
  blocker: {
    /** A card in a stage of one of these kinds counts as blocked, whatever the provider reports. */
    stageKinds: StageKind[];
    /** What a blocker is, handed to the agent. Empty: nothing is said. */
    text: string;
  };
  question: {
    /** Agents end their turn with a question for the user when there is something only the user can decide. */
    enabled: boolean;
    /** What the agent may ask about; it goes after "if there is". */
    text: string;
  };
  readyForQa: {
    /** A card in a stage of one of these kinds is ready for the QA hand-off. */
    stageKinds: StageKind[];
    /** Only a card that has a spec folder can be handed to QA. */
    requiresSpec: boolean;
    /** What "ready for QA" means; shown to the agents. Empty: nothing is said. */
    text: string;
  };
}

/** What the agent is given about each card. */
export interface CardEnrichment {
  /** Look the issue's folder up in docs.specsDir and describe it on the card. */
  specFolder: boolean;
  /** Fields of the card the agent sees, in the card's own order. */
  cardFields: CardField[];
  /** Documents (relative to the spec folder, or to the projects root when they start with "./") the card names when they exist. */
  extraFiles: string[];
}

export interface PromptOverride {
  'pt-BR'?: string;
  en?: string;
}

export interface QuickTransitionRule {
  /** Name of the status the issue moves to. */
  to: string;
  /** Id of that status on the GitLab instance. */
  id: number;
  /** The stage label the issue gets. */
  label: string;
  /** Statuses it may leave. */
  from: string[];
  /** Stage labels removed on the way (any other stage label blocks the move). */
  removable: string[];
}

export interface DevCycleConfig {
  /** Template this section was filled from ("none", "sdd", "scrum", "kanban", "github-flow", "minimal", or a custom one). Informational once edited. */
  templateId: string;
  ceremonies: Record<CeremonyId, boolean>;
  ceremonyParams: CeremonyParams;
  stages: StageDef[];
  /** How a provider's states and labels map to the stages above, first match wins; StageDef.match is the fallback on free text. */
  stageMapping: StageMappingRule[];
  /** What blocker, question for me and ready for QA mean here. */
  meanings: CycleMeanings;
  enrichment: CardEnrichment;
  /** Which prompt family each role uses ("sdd", "scrum", "kanban", "flow"); a prompt the family does not have falls back to "sdd". */
  prompts: Record<PromptRole, string>;
  /** Replaces one prompt text, per language, by its id (e.g. "turn.main"); the placeholders are the ones of the built-in text. */
  promptOverrides: Record<string, PromptOverride>;
  /** Name of the skill (a folder of docs.skillsDirs with a SKILL.md) that describes the team's pipeline; agents are pointed at it when a ceremony needs the rules. Empty: none. */
  pipelineSkill: string;
  /** Regular expression for the label that says an issue shipped in a version. Group 1, when present, is the version shown. */
  releaseLabelPattern: string;
  specLayout: SpecLayout;
  /** Status changes the card's quick actions offer on GitLab (custom status ids differ per instance, so each workspace lists its own). Empty: none. */
  quickTransitions: QuickTransitionRule[];
  qa: {
    /** Login whose issue notes carry the release branch and pipelines. null: no QA hand-off notes. */
    user: string | null;
  };
}

export interface AgentDocsSelection {
  claudeMd: boolean;
  skills: boolean;
  rules: boolean;
  agents: boolean;
  knowledge: boolean;
  mcp: boolean;
}

export interface AgentRoleConfig {
  /** The llm.roles entry this agent role calls. */
  modelRole: LlmRole;
  /** Text appended to the agent's system prompt. */
  extraInstructions: string;
  /** Replaces the built-in role preamble when not empty. */
  promptOverride: string;
  /** Persona or tone of this agent ("direct and brief", "formal"), appended after the shared one. */
  persona: string;
  /** Turn limit of every call of this role; null: each call keeps its own limit. */
  maxTurns: number | null;
  /** Which documentation sources of `docs` this role may read. */
  docs: AgentDocsSelection;
}

export interface AgentToolsConfig {
  files: boolean;
  skills: boolean;
  /** Issue tracker MCP tools (get issue / merge request details). */
  trackerMcp: boolean;
  /** Name of the MCP server that offers them (tools are mcp__<server>__get_issue_details_and_comments and ...get_merge_request_details_and_changes). Empty: none. */
  trackerMcpServer: string;
  /** Read-only use of the VCS CLI through the shell allow-list. */
  vcsCli: boolean;
  subagents: boolean;
}

export interface AgentsConfig {
  tools: AgentToolsConfig;
  /** Appended to every agent, before the role's own text. */
  extraInstructions: string;
  /** Persona or tone shared by every agent; a role's own persona comes after it. */
  persona: string;
  roles: Record<LlmRole, AgentRoleConfig>;
}

export const VOICE_ENGINES = ['edge', 'kokoro'] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];

export interface VoiceConfig {
  /** Master switch: off means no sidecar, no microphone, no speech, and the app says "conversa" (chat) instead of "call". */
  enabled: boolean;
  engine: VoiceEngine;
  /** faster-whisper model name (tiny, base, small, medium...). */
  sttModel: string;
  /** The sidecar dependencies are installed on this machine (set by voice:install and voice:uninstall). */
  depsInstalled: boolean;
  /** Folder with kokoro-v1.0.onnx and voices-v1.0.bin, when they live outside the app's own data folder; "~/" expands. null: only the app's folders. */
  kokoroDir: string | null;
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
  /** File where the tool appends one line per day it ran (the retro and the watchers read it). null: none. */
  historyFile: string | null;
  timeoutMs: number;
}

export interface ReleaseSyncConfig extends CommandConfig {
  /** Working directory of the tool. null: the projects root. */
  cwd: string | null;
  /** Folder of the bare mirrors the tool keeps; conflict calls may read them. */
  mirrorsDir: string | null;
}

export interface TimeExportConfig extends CommandConfig {
  /** Layout the export command reads: "none" (the day file only) or the name of a layout. */
  format: string;
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

/** Where the Claude Agent SDK comes from: bundled with the app (installs made before the SDK became a separate download) or a user-local install. */
export interface ClaudeSdkConfig {
  /** The SDK was installed by the wizard (or exists bundled with an existing install). */
  installed: boolean;
  version: string | null;
  /** Folder of the user-local install (it holds node_modules/@anthropic-ai/claude-agent-sdk). null: the bundled copy. */
  path: string | null;
}

export const USER_ARTICLES = ['', 'o', 'a'] as const;
export type UserArticle = (typeof USER_ARTICLES)[number];

export interface WorkspaceConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  /** False until the setup wizard finishes (or the config was migrated from an existing install). */
  setupComplete: boolean;
  language: Language;
  /** How the agents address the user. Empty: no name. */
  userName: string;
  /** Portuguese article that goes with the name ("o Bruno", "a Ana"); empty: the name alone, no article. Only pt-BR text reads it. */
  userArticle: UserArticle;
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
  claudeSdk: ClaudeSdkConfig;
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
