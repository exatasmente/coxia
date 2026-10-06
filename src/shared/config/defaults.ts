// i18n-lint: allow-file default values of the config: model names, commands and ids, not prose
import { neutralDevCycle } from '../cycles/neutral';
import { newSquad } from './squads';
import { ensureSystemAgents, newAgent, systemAgents } from './team';
import { CONFIG_SCHEMA_VERSION, LLM_ROLES, defaultEngine, type AgentRoleConfig, type DeepPartial, type LlmProvider, type LlmRole, type PluginsConfig, type RoleModel, type RunnerConfig, type RunnerSandbox, type WorkspaceConfig } from './types';

// What a fresh install gets: nothing that belongs to one company or one machine.
// A person's own values reach a workspace only through the optional legacy profile of the v1 migration (legacy.ts).

export const DEFAULT_PROVIDER_ID = 'anthropic';
export const DEFAULT_SECRET_REF = 'llm.anthropic';

const NEUTRAL_ROLE_MODELS: Record<LlmRole, string> = { turn: 'haiku', reply: 'haiku', deep: 'sonnet', teams: 'haiku', fix: 'haiku' };

function roles<T>(make: (role: LlmRole) => T): Record<LlmRole, T> {
  return Object.fromEntries(LLM_ROLES.map((r) => [r, make(r)])) as Record<LlmRole, T>;
}

/** A sandbox that reaches nothing: no network, no folder beyond the worktree, and limits a test run fits in. */
export function neutralSandbox(): RunnerSandbox {
  return {
    network: 'off',
    registryHosts: ['registry.npmjs.org', 'registry.yarnpkg.com'],
    readOnlyPaths: [],
    limits: { commandMs: 5 * 60_000, stageMs: 30 * 60_000, memoryMb: 2048, processes: 256, fileMb: 256, copyMb: 2048 },
  };
}

export function neutralRunner(): RunnerConfig {
  return { enabled: false, triggerLabel: 'coxia', maxConcurrentRuns: 1, worktreesDir: null, commands: null, stageIdleMs: 10 * 60_000, stageMaxMs: 2 * 60 * 60_000, turns: { read: 30, write: 80 }, identity: { name: '', email: '' }, sandbox: neutralSandbox(), commitMessage: 'feat: {summary} #{iid}', linkDependencies: true, release: { soleMaintainer: false } };
}

/** A workspace with no plugins: no folder listed, nothing read and nothing offered; an allowed irreversible write is announced for 30 seconds. */
export function neutralPlugins(): PluginsConfig {
  return { dir: null, list: [], confirmSeconds: 30 };
}

export function neutralConfig(): WorkspaceConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    setupComplete: false,
    language: 'pt-BR',
    userName: '',
    userArticle: '',
    appearance: { theme: 'system' },
    notifications: true,
    closeToTray: true,
    retention: { enabled: false, days: 30 },
    schedule: { preDaily: '09:40', days: [1, 2, 3, 4, 5], statusEveryMin: 30, from: '08:00', to: '19:00', retroDay: 5, retroTime: '16:00' },
    llm: {
      providers: [{ id: DEFAULT_PROVIDER_ID, kind: 'anthropic', engine: 'claude-sdk', baseUrl: 'https://api.anthropic.com', models: ['haiku', 'sonnet', 'opus'], secretRef: DEFAULT_SECRET_REF, envFile: null, options: {}, capabilities: null, structured: 'auto', headers: {}, maxOutputTokens: null, temperature: null, timeoutMs: null, legacyCustomEndpoint: false }],
      roles: roles<RoleModel>((r) => ({ provider: DEFAULT_PROVIDER_ID, model: NEUTRAL_ROLE_MODELS[r] })),
    },
    projects: { roots: [], repos: [], autoDiscover: true, issues: { vcsId: null, project: null, projectId: null, refPrefix: '', cardScope: 'assigned', cardLabels: [] }, verifyCommands: {} },
    vcs: [],
    docs: { autoDetect: true, claudeMdRoots: [], skillsDirs: [], rulesDirs: [], agentsDirs: [], knowledgeDirs: [], mcpConfigFiles: [], specsDir: null },
    devCycle: neutralDevCycle(),
    agents: {
      tools: { files: true, skills: true, trackerMcp: true, trackerMcpServer: '', vcsCli: true, subagents: true },
      extraInstructions: '',
      persona: '',
      roles: roles<AgentRoleConfig>((r) => ({ modelRole: r, extraInstructions: '', promptOverride: '', persona: '', maxTurns: null, docs: { claudeMd: true, skills: true, rules: true, agents: true, knowledge: true, mcp: true } })),
      team: systemAgents(),
    },
    squads: [],
    voice: { enabled: false, engine: 'edge', sttModel: 'small', depsInstalled: false, kokoroDir: null, autoStop: true, silenceMs: 1200, speak: true, prosody: true, bargeIn: true },
    claudeSdk: { installed: false, version: null, path: null },
    externalTools: {
      cardSource: { enabled: false, command: '', reportArgs: [], noteArgs: [], stateFile: null, historyFile: null, timeoutMs: 150_000 },
      releaseSync: { enabled: false, command: '', cwd: null, mirrorsDir: null },
      timeExport: { enabled: false, command: '', format: 'none' },
      terminal: { command: null, args: [] },
      claudeCli: { command: 'claude', cwd: null },
    },
    runner: neutralRunner(),
    plugins: neutralPlugins(),
  };
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Objects merge key by key, arrays and scalars are replaced; a key the patch leaves out keeps its default.
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = k in base ? mergeDeep((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

const PROVIDER_DEFAULTS = { models: [] as string[], secretRef: null, envFile: null, options: {} as Record<string, string>, capabilities: null, structured: 'auto' as const, headers: {} as Record<string, string>, maxOutputTokens: null, temperature: null, timeoutMs: null, legacyCustomEndpoint: false };
const REPO_DEFAULTS = { remoteUrl: null, vcsId: null, projectPath: null };
const VCS_DEFAULTS = { apiUrl: '', user: '', secretRef: null, cliPreference: 'auto' as const, cliCommand: null };

/** A provider with every field filled: the id and the kind are the only things that cannot be guessed. */
export function newProvider(partial: Pick<LlmProvider, 'id' | 'kind'> & Partial<LlmProvider>): LlmProvider {
  return completeProvider(partial);
}

// Key order is the order a person reads the file in: who it is first, then how it is reached, then the details.
function completeProvider(p: Pick<LlmProvider, 'id' | 'kind'> & Partial<LlmProvider>): LlmProvider {
  return Object.assign({ id: p.id, kind: p.kind, engine: p.engine ?? defaultEngine(p.kind), baseUrl: p.baseUrl ?? '' }, PROVIDER_DEFAULTS, p, { engine: p.engine ?? defaultEngine(p.kind), baseUrl: p.baseUrl ?? '' }) as LlmProvider;
}

/** Fills whatever a stored or imported config leaves out with the neutral default (forward compatible: a newer field never breaks an older file). */
export function withConfigDefaults(partial: DeepPartial<WorkspaceConfig> | Record<string, unknown> | null | undefined): WorkspaceConfig {
  const c = mergeDeep(neutralConfig(), partial ?? {});
  return {
    ...c,
    llm: { ...c.llm, providers: c.llm.providers.map(completeProvider) },
    projects: { ...c.projects, repos: c.projects.repos.map((r) => ({ ...REPO_DEFAULTS, ...r })) },
    vcs: c.vcs.map((v) => ({ ...VCS_DEFAULTS, ...v })),
    devCycle: { ...c.devCycle, stageMapping: c.devCycle.stageMapping.map((r) => ({ ...r, name: r.name ?? '' })), comments: Object.fromEntries(Object.entries(c.devCycle.comments ?? {}).map(([id, tpl]) => [id, { ...tpl, sections: tpl.sections ?? [], technicalDetail: tpl.technicalDetail ?? false }])) },
    squads: Array.isArray(c.squads) ? c.squads.map(newSquad) : [],
    agents: { ...c.agents, team: ensureSystemAgents(Array.isArray(c.agents.team) ? c.agents.team.map(newAgent) : [], c.agents.roles) },
  };
}
