export type AuditKind = 'gitlab' | 'github' | 'bitbucket' | 'graphql' | 'sync' | 'publish' | 'note-edit' | 'push' | 'minutes' | 'exec' | 'release' | 'worktree' | 'plugin-write' | 'plugin-request' | 'plugin-call' | 'screen-open' | 'screen-close' | 'screen-hold' | 'screen-confirm' | 'screen-use' | 'procedure' | 'screen-handoff' | 'test-env' | 'memory' | 'auto-step' | 'decision' | 'policy-change';

/** The kinds the autonomy policy writes: a step it let go out with no "yes" (a stage start, a host command, a gate), the person's decision on a held step, and a change of the policy itself. */
export const AUTONOMY_AUDIT_KINDS = ['auto-step', 'decision', 'policy-change'] as const satisfies readonly AuditKind[];

/** The level a policy came from. Only `levelOf` in the autonomy module names it, so the levels of a finer policy change one place. */
export type AuditPolicyLevel = 'workspace' | 'flow';

/** The autonomy policy in effect when a step went out: its choices, the level it came from and the flow that decided (`''` the main flow, a squad id, `release`). */
export interface AuditPolicy {
  cycle: boolean;
  hostCommands: boolean;
  gates: boolean;
  push: boolean;
  pullRequest: boolean;
  /** The workspace's own choice for the board; present only on a write of the board. */
  board?: boolean;
  level: AuditPolicyLevel;
  flow: string;
}

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
  /** The autonomy policy in effect when the step went out with no "yes". Absent on what a person approved, on plugins and on entries older than the field. */
  policy?: AuditPolicy | null;
  /** Hash of the previous line's `chain` and this line's body: a line edited or removed afterwards breaks it. Absent on entries older than the field. */
  chain?: string;
  /** Set by the reader, never written: a line whose chain does not close (it was edited, or the line before it was removed). */
  tampered?: boolean;
}
