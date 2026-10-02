import type { DocsConfig } from './config/types';

// "Preparar agentes": what the app finds in the user's projects that an agent can use as context, and the docs configuration that follows.
// The scan only lists and reads names and the first lines of documentation files; it never reads a secret file (.env, keys, settings with
// permissions) and never an MCP server's environment: only its name.

/** A folder an agent would read, with a sample of what is in it. */
export interface FolderScan {
  dir: string;
  /** Total entries (files for rules and knowledge, skill folders for skills, agent files for agents). */
  count: number;
  /** The first names, capped (see NAMES_SHOWN). */
  names: string[];
}

export interface ProjectScan {
  /** The repo id from the config when there is one, else the folder name. */
  id: string;
  path: string;
  exists: boolean;
  isGitRepo: boolean;
  /** The folder's own name, a package or module name and a description when a manifest says so. */
  name: string;
  /** CLAUDE.md of the project (absolute path), when there is one. */
  claudeMd: string | null;
  skills: FolderScan | null;
  rules: FolderScan | null;
  agents: FolderScan | null;
  commands: FolderScan | null;
  /** Knowledge bases: .claude/knowledge-base, knowledge-base, knowledge. */
  knowledge: FolderScan | null;
  /** A plain docs folder: offered, but not added to the proposal on its own. */
  docs: FolderScan | null;
  /** .mcp.json of the project, and the names of its servers (never their settings). */
  mcpConfig: string | null;
  mcpServers: string[];
  /** A folder with one subfolder per issue (.specs, specs). */
  specsDir: FolderScan | null;
  /** Languages and frameworks recognised from manifests. */
  stack: string[];
  /** One or two sentences from CLAUDE.md or README, or empty. */
  purpose: string;
  /** The short summary shown to the person (built from the facts above, no model involved). */
  summary: string;
  /** Set by the optional model call: replaces `summary` on screen. */
  modelSummary?: string;
}

/** What ~/.claude offers on this machine. */
export interface UserScan {
  claudeMd: string | null;
  skills: FolderScan | null;
  agents: FolderScan | null;
  commands: FolderScan | null;
}

export interface ScanResult {
  generatedAt: string;
  user: UserScan;
  projects: ProjectScan[];
  /** Folders that were asked for but are not there. */
  missing: string[];
}

/** The docs configuration the scan proposes. Paths use "~/" under the home folder, as the config does. */
export type ProposedDocs = Pick<DocsConfig, 'claudeMdRoots' | 'skillsDirs' | 'rulesDirs' | 'agentsDirs' | 'knowledgeDirs' | 'mcpConfigFiles' | 'specsDir'>;

export interface DocsProposal {
  docs: ProposedDocs;
  /** What was left out and why, in the language of the workspace. */
  notes: string[];
}

export const NAMES_SHOWN = 12;
