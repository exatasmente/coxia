export type AuditKind = 'gitlab' | 'github' | 'bitbucket' | 'graphql' | 'sync' | 'publish' | 'note-edit' | 'push' | 'minutes' | 'exec' | 'release' | 'worktree' | 'plugin-write' | 'plugin-request' | 'screen-open' | 'screen-close' | 'screen-hold' | 'screen-confirm' | 'screen-use' | 'procedure' | 'screen-handoff' | 'test-env';

/** The kinds an agent's virtual screen writes: its opening and closing, a step held for the person, a confirmation the agent asked for, the person's use of the screen, and the agent handing the screen over. */
export const SCREEN_AUDIT_KINDS = ['screen-open', 'screen-close', 'screen-hold', 'screen-confirm', 'screen-use', 'screen-handoff'] as const satisfies readonly AuditKind[];

export interface AuditEntry {
  at: string;
  kind: AuditKind;
  issue: number;
  // HTTP method + endpoint, or the CLI command; never a token.
  target: string;
  via: string;
  fields: Record<string, string>;
  ok: boolean;
  code: number | null;
  result: string;
  origin: { actionId: string; kind: string; key: string; summary: string | null };
  /** Who wrote it when no person approved it first: the id of the agent whose autonomy let it go out. Absent for what a person approved. */
  by?: string | null;
  /** Hash of the body of a comment, so the log says which text went out without keeping it. */
  bodyHash?: string | null;
}
