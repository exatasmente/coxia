import type { DocsKey } from '../wizard';
import type { HarnessKind } from './format';

// What Settings › Documentation shows per repository. Built in the main process (`src/main/harness/status.ts`), read by the window; nothing here touches the disk.

/** Why a file counts as not checked: the cited code moved (`stale`), the comparison could not be made (`unverified`), or the header is not valid (`invalid`). */
export type UncheckedState = 'stale' | 'unverified' | 'invalid';

export interface UncheckedFile {
  /** Relative to `.coxia/`. */
  path: string;
  kind: HarnessKind;
  state: UncheckedState;
  /** `stale`: how many cited files changed and the first of them. `unverified`: git, timeout or outside-history. `invalid`: the reason from the parser. */
  reason: string;
  changed: string[];
  total: number;
  /** The commit and the day the header says the file was checked; null for an invalid header. */
  commit: string | null;
  date: string | null;
}

export interface DocsRepoStatus {
  repo: string;
  /** The repository has a `.coxia/` folder. */
  exists: boolean;
  overview: boolean;
  rules: number;
  skills: number;
  roles: number;
  unchecked: UncheckedFile[];
  /** Files in `.coxia/` the app does not read. */
  ignored: string[];
  /** The commit (short) and the day of the `HEAD` of the checkout the screen read; null when git could not say. */
  head: { commit: string; date: string } | null;
  /** The repository has a `CLAUDE.md` or a `.claude/` folder: Claude Code's, which the agents of the app do not read. */
  claude: boolean;
  /** The documentation run going for this repository, if any. */
  run: { id: string } | null;
}

export interface DocsStatus {
  repos: DocsRepoStatus[];
  /** The workspace has the documentation flow; without it the first click adds it (after the person says yes). */
  flow: boolean;
  /** The most characters of this documentation a call hands an agent (less for a model that declares a small context window). */
  budget: number;
}

/** Whether a source the person listed points at Claude Code's own files: a `CLAUDE.md` root, or a path inside a `.claude` folder. MCP configs stay as they are. */
export function isClaudeSource(key: DocsKey, path: string): boolean {
  if (key === 'mcpConfigFiles') return false;
  if (key === 'claudeMdRoots') return true;
  return /(^|\/)\.claude(\/|$)/.test(path.replace(/\\/g, '/')) || /(^|\/)CLAUDE\.md$/.test(path.replace(/\\/g, '/'));
}
