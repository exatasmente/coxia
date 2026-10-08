import type { DocsKey } from '../wizard';

export interface DocsRepoStatus {
  repo: string;
  /** The repository has an AGENTS.md at its root. */
  exists: boolean;
  /** The file is a readable, regular AGENTS.md within the size limit. */
  ready: boolean;
  ignored: string[];
  head: { commit: string; date: string } | null;
  /** The repository has Claude Code files, which Coxia agents do not load automatically. */
  claude: boolean;
  run: { id: string } | null;
}

export interface DocsStatus {
  repos: DocsRepoStatus[];
  flow: boolean;
  budget: number;
}

export function isClaudeSource(key: DocsKey, path: string): boolean {
  if (key === 'mcpConfigFiles') return false;
  if (key === 'claudeMdRoots') return true;
  return /(^|\/)\.claude(\/|$)/.test(path.replace(/\\/g, '/')) || /(^|\/)CLAUDE\.md$/.test(path.replace(/\\/g, '/'));
}
