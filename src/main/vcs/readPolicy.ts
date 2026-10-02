import type { VcsKind } from '../../shared/config/types';
import { getConfig, rc } from '../workspaceConfig';
import { vcsCliFor, vcsReady } from './index';

// What the ceremony agents may read from the code host, per provider. The shell they get is one command at a time, no flags that write:
//   GitLab   glab api projects/... / glab mr|issue view          (the CLI, when the integration uses it)
//   GitHub   gh api repos/... / gh pr|issue view                 (the CLI, when the integration uses it)
//   Bitbucket, or an integration that uses the API only: no CLI, so the reads go through the app tool `VcsRead` (readTool.ts).
// The regular expressions are the whole policy: a command that does not match one is denied by the hook (agents.ts shellAllowlist).

export const GLAB_RULES = ['Bash(glab api:*)', 'Bash(glab mr view:*)', 'Bash(glab issue view:*)'];

/** The only glab commands a ceremony agent may run: GitLab reads, one command, no flags that write. */
export const GLAB_READ = [
  /^glab api "?projects\/[\w%.-]+\/(merge_requests|issues)\/\d+(\/(discussions|notes|approvals|changes|pipelines))?(\?[\w=&]+)?"?( --paginate)?$/,
  /^glab api "?projects\/[\w%.-]+\/pipelines(\/\d+(\/jobs)?)?(\?[\w=&%./-]+)?"?$/,
  /^glab (mr|issue) view \d+ -R [\w./-]+( --comments)?$/,
];

export const GH_RULES = ['Bash(gh api:*)', 'Bash(gh pr view:*)', 'Bash(gh issue view:*)'];

/**
 * The only gh commands a ceremony agent may run. `gh api` defaults to GET and turns into a write with -f/-F/--input/--method, so the
 * only flag accepted is --paginate; graphql, search and every endpoint outside pulls, issues, commit checks and Actions runs are out.
 */
export const GH_READ = [
  /^gh api "?repos\/[\w.-]+\/[\w.-]+\/(pulls|issues)\/\d+(\/(comments|reviews|files|commits|timeline|requested_reviewers))?(\?[\w=&]+)?"?( --paginate)?$/,
  /^gh api "?repos\/[\w.-]+\/[\w.-]+\/commits\/[0-9a-f]{7,40}\/(check-runs|status)(\?[\w=&]+)?"?$/,
  /^gh api "?repos\/[\w.-]+\/[\w.-]+\/actions\/runs(\/\d+(\/jobs)?)?(\?[\w=&%./-]+)?"?$/,
  /^gh (pr|issue) view \d+ -R [\w.-]+\/[\w.-]+( --comments)?$/,
];

export const GITLAB_HINT =
  '`glab api projects/<grupo%2Frepo>/merge_requests/<iid>/discussions` (discussões de MR), ' +
  '`glab api projects/<grupo%2Frepo>/issues/<iid>/notes` (comentários de issue) ou ' +
  '`glab mr view <iid> -R <grupo/repo> --comments`. O caminho de cada MR está em mrPaths do cartão.';

export const GITHUB_HINT =
  '`gh api repos/<dono>/<repo>/pulls/<n>/comments` (comentários de revisão), ' +
  '`gh api repos/<dono>/<repo>/issues/<n>/comments` (comentários de issue ou do PR) ou ' +
  '`gh pr view <n> -R <dono>/<repo> --comments`. O caminho de cada PR está em mrPaths do cartão.';

export const TOOL_HINT =
  'Use a ferramenta VcsRead (op: issue, issue_comments, mr, mr_threads, mr_comments, mr_changes ou mr_ci; project e iid). ' +
  'O caminho de cada MR está em mrPaths do cartão. Ela só lê.';

export interface VcsReadPolicy {
  via: 'cli' | 'tool' | 'none';
  kind: VcsKind | null;
  /** SDK permission rules for the shell (Bash(...)). */
  rules: string[];
  /** Hook allow-list for the shell. */
  patterns: RegExp[];
  /** What the agent is told it can read, empty when it can read nothing. */
  hint: string;
  /** The commands or tool, without the lead-in: what the shell hook says when it refuses a command. */
  usage: string;
}

const NONE: VcsReadPolicy = { via: 'none', kind: null, rules: [], patterns: [], hint: '', usage: '' };

/** Pure: the policy for an integration given whether its CLI is on and whether its API is usable. */
export function readPolicyFor(kind: VcsKind | null, o: { enabled: boolean; cli: boolean; api: boolean }): VcsReadPolicy {
  if (!kind || !o.enabled) return NONE;
  if (o.cli && kind === 'gitlab') return { via: 'cli', kind, rules: GLAB_RULES, patterns: GLAB_READ, hint: `Para ler o GitLab: ${GITLAB_HINT}`, usage: GITLAB_HINT };
  if (o.cli && kind === 'github') return { via: 'cli', kind, rules: GH_RULES, patterns: GH_READ, hint: `Para ler o GitHub: ${GITHUB_HINT}`, usage: GITHUB_HINT };
  if (o.api) return { via: 'tool', kind, rules: [], patterns: [], hint: `Para ler o host de código: ${TOOL_HINT}`, usage: TOOL_HINT };
  return NONE;
}

/** The read policy of the running workspace's primary integration. */
export function vcsReadPolicy(): VcsReadPolicy {
  const primary = rc().primaryVcs;
  return readPolicyFor(primary?.kind ?? null, { enabled: getConfig().agents.tools.vcsCli, cli: vcsCliFor() !== null, api: vcsReady() });
}

/** Environment variable that points the CLI at the configured host (a CLI outside a checkout falls back to the public host). */
export function vcsShellEnv(): Record<string, string> | undefined {
  const v = rc().primaryVcs;
  if (!v?.host) return undefined;
  if (v.kind === 'gitlab') return { GITLAB_HOST: v.host };
  if (v.kind === 'github' && v.host !== 'github.com') return { GH_HOST: v.host };
  return undefined;
}

/** How the agent sees the changes of an MR, for the prompts that ask it to look at the diff. No trailing punctuation. */
export function mrChangesHint(project: string, iid: number): string {
  const policy = vcsReadPolicy();
  if (policy.via === 'cli' && policy.kind === 'github') return `Para ver o trecho, use gh api repos/${project}/pulls/${iid}/files`;
  if (policy.via === 'tool') return `Para ver o trecho, use a ferramenta VcsRead (op mr_changes, project ${project}, iid ${iid})`;
  return `Para ver o trecho, use glab api projects/${encodeURIComponent(project)}/merge_requests/${iid}/changes ou o MCP do GitLab (get_merge_request_details_and_changes)`;
}

/** How the agent reads the comments of an issue, for the prompts that ask it to look for a note. */
export function issueNotesHint(project: string, iid: string | number): string {
  const policy = vcsReadPolicy();
  if (policy.via === 'cli' && policy.kind === 'github') return `gh api repos/${project}/issues/${iid}/comments`;
  if (policy.via === 'tool') return `a ferramenta VcsRead (op issue_comments, project ${project}, iid ${iid})`;
  return `glab api projects/${encodeURIComponent(project)}/issues/${iid}/notes`;
}
