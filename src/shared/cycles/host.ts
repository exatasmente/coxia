import { LLM_ROLES, type EngineId, type LlmRole, type VcsKind, type WorkspaceConfig } from '../config/types';
import { hostWords } from '../i18n/terms';
import { VCS_CAPS } from '../vcsCaps';
import { configuredCli, primaryIntegration } from './terms';

// What the configured code host, the agents' tools and the engines can do, as plain data for the screens: a feature the workspace does not have
// is hidden instead of renamed. The predicates that use it are in view.ts, so they are tested without a screen.

export interface HostFacts {
  kind: VcsKind | null;
  /** "GitLab", "GitHub", "Bitbucket" or a neutral phrase (the same word as `{vcsName}`). */
  name: string;
  /** The host has an issue status of its own and the cycle has rules to move it: the Quick actions screen shows the status block. */
  issueStatus: boolean;
  /** CI jobs that wait for a person exist on this host. */
  manualJobs: boolean;
  /** Choosing another reviewer replaces the current ones (GitLab); elsewhere reviewers are added. */
  reviewerReplaces: boolean;
  /** There is an integration for the agents' read switch to govern. */
  readSwitch: boolean;
  /** The command that switch governs (glab, gh); null: the app's own read tool (`VcsRead`), or nothing when there is no integration. */
  cli: string | null;
  /** A tracker MCP server is configured, so its switch does something. */
  trackerMcp: boolean;
  /** The agent loop that serves each role. */
  engines: Record<LlmRole, EngineId>;
}

export function hostFacts(config: WorkspaceConfig): HostFacts {
  const primary = primaryIntegration(config);
  const kind = primary?.kind ?? null;
  const caps = kind ? VCS_CAPS[kind] : null;
  const engineOf = (role: LlmRole): EngineId => {
    const modelRole = config.agents.roles[role]?.modelRole ?? role;
    const provider = config.llm.providers.find((p) => p.id === (config.llm.roles[modelRole] ?? config.llm.roles[role]).provider);
    return provider?.engine ?? 'claude-sdk';
  };
  return {
    kind,
    name: hostWords(kind, config.language).vcsName,
    // The app moves a status only on GitLab (gitlabQuick.ts); a host that has one but no rule for it has nothing to show.
    issueStatus: kind === 'gitlab' && !!caps?.issueStatus && config.devCycle.quickTransitions.length > 0,
    manualJobs: !!caps?.manualJobs,
    reviewerReplaces: kind === 'gitlab',
    readSwitch: primary !== null,
    cli: primary ? configuredCli(primary) : null,
    trackerMcp: config.agents.tools.trackerMcpServer.trim() !== '',
    engines: Object.fromEntries(LLM_ROLES.map((r) => [r, engineOf(r)])) as Record<LlmRole, EngineId>,
  };
}
