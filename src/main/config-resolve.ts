import { join } from 'node:path';
import { claudeProjectFolder, expandHome } from '../shared/config/paths';
import type { AgentModel, CeremonyId, ClaudeCliConfig, DevCycleConfig, EngineId, IssueProjectConfig, LlmProvider, LlmRole, ProviderCapabilities, ProviderKind, SpecLayout, StageDef, StructuredMode, TerminalConfig, VcsKind, WorkspaceConfig } from '../shared/config/types';
import { t } from '../shared/i18n';

// Turns a WorkspaceConfig into what the rest of the main process needs: absolute paths, the optional integrations that are on, the
// values the app used to hardcode. Pure: everything machine-specific comes in through the context, so a test can resolve the same
// config for any home folder. Modules do not call this; they use the getters of workspaceConfig.ts, which bind it to the loaded config.

export interface ResolveContext {
  home: string;
  env: NodeJS.ProcessEnv;
  /** Working directory of the agents when no project root is configured (the workspace folder: no access to the rest of the disk). */
  fallbackCwd: string;
}

export interface ResolvedRepo {
  id: string;
  path: string;
  remoteUrl: string | null;
  vcsId: string | null;
  projectPath: string | null;
}

export interface ResolvedVcs {
  id: string;
  kind: VcsKind;
  host: string;
  apiUrl: string;
  user: string;
  secretRef: string | null;
  /** The CLI to run, or null when the integration is configured for the API only. */
  cli: string | null;
}

export interface ResolvedCardSource {
  command: string;
  reportArgs: string[];
  noteArgs: string[];
  stateFile: string | null;
  historyFile: string | null;
  timeoutMs: number;
}

export interface ResolvedReleaseSync {
  command: string;
  cwd: string;
  mirrorsDir: string | null;
}

export interface ResolvedRole {
  role: LlmRole;
  /** The llm.roles entry actually used (agents.roles[role].modelRole). */
  modelRole: LlmRole;
  providerId: string;
  kind: ProviderKind;
  engine: EngineId;
  baseUrl: string;
  model: string;
  secretRef: string | null;
  envFile: string | null;
  options: Record<string, string>;
  capabilities: ProviderCapabilities | null;
  structured: StructuredMode;
  headers: Record<string, string>;
  maxOutputTokens: number | null;
  temperature: number | null;
  timeoutMs: number | null;
  legacyCustomEndpoint: boolean;
}

export interface ResolvedConfig {
  home: string;
  projectsRoot: string;
  projectRoots: string[];
  repos: ResolvedRepo[];
  vcs: ResolvedVcs[];
  /** The integration that holds the issues, else the first one. */
  primaryVcs: ResolvedVcs | null;
  vcsHost: string | null;
  issues: IssueProjectConfig;
  qaUser: string | null;
  specsDir: string | null;
  specLayout: SpecLayout;
  stages: StageDef[];
  releaseLabelPattern: RegExp;
  ceremonies: DevCycleConfig['ceremonies'];
  cardSource: ResolvedCardSource | null;
  releaseSync: ResolvedReleaseSync | null;
  timeExport: { command: string; format: string } | null;
  terminal: TerminalConfig;
  claudeCli: ClaudeCliConfig & { cwd: string };
  transcriptsDir: string;
  cloneRoots: string[];
  isOn(ceremony: CeremonyId): boolean;
  role(role: LlmRole): ResolvedRole;
  /** The provider and model of a team agent: a borrowed role, or an explicit provider and model. `label` is the role the call is reported under. */
  agentModel(model: AgentModel, label?: LlmRole): ResolvedRole;
  provider(id: string): LlmProvider | undefined;
}

const DEFAULT_CLI: Partial<Record<VcsKind, string>> = { gitlab: 'glab', github: 'gh' };

export function resolveConfig(c: WorkspaceConfig, ctx: ResolveContext): ResolvedConfig {
  const x = (p: string): string => expandHome(p, ctx.home);
  const xn = (p: string | null): string | null => (p?.trim() ? x(p) : null);
  const roots = c.projects.roots.map(x);
  const projectsRoot = roots[0] ?? ctx.fallbackCwd;

  const vcs: ResolvedVcs[] = c.vcs.map((v) => ({
    id: v.id,
    kind: v.kind,
    host: v.host,
    apiUrl: v.apiUrl || (v.kind === 'github' ? 'https://api.github.com' : v.kind === 'gitlab' ? `https://${v.host}/api/v4` : ''),
    user: v.user,
    secretRef: v.secretRef,
    cli: v.cliPreference === 'api' ? null : (v.cliCommand ?? DEFAULT_CLI[v.kind] ?? null),
  }));
  const primaryVcs = vcs.find((v) => v.id === c.projects.issues.vcsId) ?? vcs[0] ?? null;

  const card = c.externalTools.cardSource;
  const sync = c.externalTools.releaseSync;
  const time = c.externalTools.timeExport;

  const target = (role: LlmRole, modelRole: LlmRole, providerId: string, model: string): ResolvedRole => {
    const p = c.llm.providers.find((q) => q.id === providerId);
    if (!p) throw new Error(t('main.config.noProvider', { provider: providerId, role }));
    return {
      role,
      modelRole,
      providerId: p.id,
      kind: p.kind,
      engine: p.engine,
      baseUrl: p.baseUrl,
      model,
      secretRef: p.secretRef,
      envFile: xn(p.envFile),
      options: p.options,
      capabilities: p.capabilities,
      structured: p.structured,
      headers: p.headers,
      maxOutputTokens: p.maxOutputTokens,
      temperature: p.temperature,
      timeoutMs: p.timeoutMs,
      legacyCustomEndpoint: p.legacyCustomEndpoint,
    };
  };

  return {
    home: ctx.home,
    projectsRoot,
    projectRoots: roots,
    repos: c.projects.repos.map((r) => ({ id: r.id, path: x(r.path), remoteUrl: r.remoteUrl, vcsId: r.vcsId, projectPath: r.projectPath })),
    vcs,
    primaryVcs,
    vcsHost: primaryVcs?.host ?? null,
    issues: c.projects.issues,
    qaUser: c.devCycle.qa.user,
    specsDir: ctx.env.CERIMONIAS_SPECS_DIR ?? xn(c.docs.specsDir),
    specLayout: c.devCycle.specLayout,
    stages: c.devCycle.stages,
    releaseLabelPattern: new RegExp(c.devCycle.releaseLabelPattern),
    ceremonies: c.devCycle.ceremonies,
    cardSource: card.enabled && card.command.trim() ? { command: x(card.command), reportArgs: card.reportArgs, noteArgs: card.noteArgs, stateFile: xn(card.stateFile), historyFile: xn(card.historyFile), timeoutMs: card.timeoutMs } : null,
    releaseSync: sync.enabled && sync.command.trim() ? { command: x(sync.command), cwd: xn(sync.cwd) ?? projectsRoot, mirrorsDir: xn(sync.mirrorsDir) } : null,
    timeExport: time.enabled && time.command.trim() ? { command: x(time.command), format: time.format } : null,
    terminal: c.externalTools.terminal,
    claudeCli: { command: c.externalTools.claudeCli.command, cwd: xn(c.externalTools.claudeCli.cwd) ?? projectsRoot },
    transcriptsDir: ctx.env.CERIMONIAS_TRANSCRIPTS_DIR ?? join(ctx.home, '.claude/projects', claudeProjectFolder(projectsRoot)),
    cloneRoots: ctx.env.CERIMONIAS_CLONES_DIR ? [ctx.env.CERIMONIAS_CLONES_DIR] : roots.length ? roots : [projectsRoot],
    isOn: (ceremony) => c.devCycle.ceremonies[ceremony] !== false,
    provider: (id) => c.llm.providers.find((p) => p.id === id),
    role(role) {
      const modelRole = c.agents.roles[role]?.modelRole ?? role;
      const rm = c.llm.roles[modelRole] ?? c.llm.roles[role];
      return target(role, modelRole, rm.provider, rm.model);
    },
    agentModel(model, label = 'deep') {
      if (model.role) {
        const rm = c.llm.roles[model.role];
        return target(label, model.role, rm.provider, rm.model);
      }
      return target(label, label, model.provider, model.model);
    },
  };
}

export interface ResolvedDocs {
  claudeMdRoots: string[];
  skillsDirs: string[];
  rulesDirs: string[];
  agentsDirs: string[];
  knowledgeDirs: string[];
  mcpConfigFiles: string[];
  /** Detected automatically (not listed in the config), for display. */
  detected: string[];
}

const uniq = (list: string[]): string[] => [...new Set(list)];

/**
 * The documentation sources the agents can use: what the config lists, plus (autoDetect) what Claude Code itself would load:
 * ~/.claude (CLAUDE.md, skills, agents, commands), and per project root and repo CLAUDE.md, .claude/{skills,agents,rules} and .mcp.json.
 */
export function resolveDocs(c: WorkspaceConfig, ctx: ResolveContext, exists: (path: string) => boolean): ResolvedDocs {
  const x = (p: string): string => expandHome(p, ctx.home);
  const out: ResolvedDocs = {
    claudeMdRoots: c.docs.claudeMdRoots.map(x),
    skillsDirs: c.docs.skillsDirs.map(x),
    rulesDirs: c.docs.rulesDirs.map(x),
    agentsDirs: c.docs.agentsDirs.map(x),
    knowledgeDirs: c.docs.knowledgeDirs.map(x),
    mcpConfigFiles: c.docs.mcpConfigFiles.map(x),
    detected: [],
  };
  if (c.docs.autoDetect) {
    const found = (list: string[], path: string) => {
      if (!list.includes(path) && exists(path)) {
        list.push(path);
        out.detected.push(path);
      }
    };
    const userClaude = join(ctx.home, '.claude');
    found(out.skillsDirs, join(userClaude, 'skills'));
    found(out.agentsDirs, join(userClaude, 'agents'));
    if (exists(join(userClaude, 'CLAUDE.md'))) found(out.claudeMdRoots, userClaude);
    const projects = [...c.projects.roots.map(x), ...c.projects.repos.map((r) => x(r.path))];
    for (const dir of uniq(projects)) {
      if (exists(join(dir, 'CLAUDE.md'))) found(out.claudeMdRoots, dir);
      found(out.skillsDirs, join(dir, '.claude/skills'));
      found(out.agentsDirs, join(dir, '.claude/agents'));
      found(out.rulesDirs, join(dir, '.claude/rules'));
      found(out.knowledgeDirs, join(dir, '.claude/knowledge-base'));
      found(out.mcpConfigFiles, join(dir, '.mcp.json'));
    }
  }
  return out;
}
