import { CEREMONY_IDS, CONFIG_SCHEMA_VERSION, LLM_ROLES, type AgentRoleConfig, type CeremonyId, type DeepPartial, type LlmRole, type RoleModel, type WorkspaceConfig } from './types';

// What a fresh install gets: nothing that belongs to one company or one machine.
// The values of the original author live in legacy.ts and reach a workspace only through the v1 migration.

export const DEFAULT_PROVIDER_ID = 'anthropic';
export const DEFAULT_SECRET_REF = 'llm.anthropic';

const NEUTRAL_ROLE_MODELS: Record<LlmRole, string> = { turn: 'haiku', reply: 'haiku', deep: 'sonnet', teams: 'haiku', fix: 'haiku' };

function roles<T>(make: (role: LlmRole) => T): Record<LlmRole, T> {
  return Object.fromEntries(LLM_ROLES.map((r) => [r, make(r)])) as Record<LlmRole, T>;
}

export function neutralConfig(): WorkspaceConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    setupComplete: false,
    language: 'pt-BR',
    appearance: { theme: 'system' },
    notifications: true,
    closeToTray: true,
    retention: { enabled: false, days: 30 },
    schedule: { preDaily: '09:40', days: [1, 2, 3, 4, 5], statusEveryMin: 30, from: '08:00', to: '19:00', retroDay: 5, retroTime: '16:00' },
    llm: {
      providers: [{ id: DEFAULT_PROVIDER_ID, kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['haiku', 'sonnet', 'opus'], secretRef: DEFAULT_SECRET_REF, envFile: null }],
      roles: roles<RoleModel>((r) => ({ provider: DEFAULT_PROVIDER_ID, model: NEUTRAL_ROLE_MODELS[r] })),
    },
    projects: { roots: [], repos: [], autoDiscover: true, issues: { vcsId: null, project: null, projectId: null, refPrefix: '' } },
    vcs: [],
    docs: { autoDetect: true, claudeMdRoots: [], skillsDirs: [], rulesDirs: [], agentsDirs: [], knowledgeDirs: [], mcpConfigFiles: [], specsDir: null },
    devCycle: {
      templateId: 'none',
      ceremonies: Object.fromEntries(CEREMONY_IDS.map((c) => [c, c !== 'qaHandoff' && c !== 'releaseConflicts'])) as Record<CeremonyId, boolean>,
      stages: [],
      specLayout: {
        folderPrefix: '#{iid}-',
        phaseFiles: [],
        planFiles: [],
        gateFiles: [],
        documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
      },
      qa: { user: null },
    },
    agents: {
      tools: { files: true, skills: true, trackerMcp: true, vcsCli: true, subagents: true },
      extraInstructions: '',
      roles: roles<AgentRoleConfig>((r) => ({ modelRole: r, extraInstructions: '', promptOverride: '' })),
    },
    voice: { enabled: true, engine: 'edge', sttModel: 'small', depsInstalled: false, autoStop: true, silenceMs: 1200, speak: true, prosody: true, bargeIn: true },
    externalTools: {
      cardSource: { enabled: false, command: '', reportArgs: [], noteArgs: [], stateFile: null, timeoutMs: 150_000 },
      releaseSync: { enabled: false, command: '', cwd: null, mirrorsDir: null },
      timeExport: { enabled: false, command: '', format: 'none' },
      terminal: { command: null, args: [] },
      claudeCli: { command: 'claude', cwd: null },
    },
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

const PROVIDER_DEFAULTS = { models: [] as string[], secretRef: null, envFile: null };
const REPO_DEFAULTS = { remoteUrl: null, vcsId: null, projectPath: null };
const VCS_DEFAULTS = { apiUrl: '', user: '', secretRef: null, cliPreference: 'auto' as const, cliCommand: null };

/** Fills whatever a stored or imported config leaves out with the neutral default (forward compatible: a newer field never breaks an older file). */
export function withConfigDefaults(partial: DeepPartial<WorkspaceConfig> | Record<string, unknown> | null | undefined): WorkspaceConfig {
  const c = mergeDeep(neutralConfig(), partial ?? {});
  return {
    ...c,
    llm: { ...c.llm, providers: c.llm.providers.map((p) => ({ ...PROVIDER_DEFAULTS, ...p })) },
    projects: { ...c.projects, repos: c.projects.repos.map((r) => ({ ...REPO_DEFAULTS, ...r })) },
    vcs: c.vcs.map((v) => ({ ...VCS_DEFAULTS, ...v })),
  };
}
