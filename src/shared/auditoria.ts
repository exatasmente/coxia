/** How a call reached the app: the window, a paired browser, or the persona acting on the person's behalf. One name for what `callOrigin()` says, whichever audit line or answer carries it. */
export type Through = 'window' | 'paired' | 'persona';

export type AuditKind = 'gitlab' | 'github' | 'bitbucket' | 'graphql' | 'sync' | 'publish' | 'note-edit' | 'push' | 'minutes' | 'exec' | 'release' | 'worktree' | 'plugin-write' | 'plugin-request' | 'plugin-call' | 'screen-open' | 'screen-close' | 'screen-hold' | 'screen-confirm' | 'screen-use' | 'procedure' | 'screen-handoff' | 'test-env' | 'memory' | 'turn-limit' | 'persona' | 'config' | 'secret' | 'plugin-decision' | 'act' | 'auto-step' | 'decision' | 'policy-change' | 'screen-autonomous' | 'screen-policy';

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
export const SCREEN_AUDIT_KINDS = ['screen-open', 'screen-close', 'screen-hold', 'screen-confirm', 'screen-use', 'screen-handoff', 'screen-autonomous'] as const satisfies readonly AuditKind[];

/**
 * What the persona had in front of it when it decided a write, bounded and masked: the `subject` is what the app itself puts before a person to decide (read by the app at the
 * moment of the act, never taken from the model), `reads` are up to eight of the persona's own tool results of that answer, newest first, and `message` is the sequence number
 * of the person's message the answer began from.
 */
export interface AuditBasis {
  subject: string;
  reads: { tool: string; op: string; target: string; excerpt: string }[];
  message: number | null;
}

/** The bounds of a `basis`: the reads kept, an excerpt, a read's name and target, and the whole once written as JSON. */
export const BASIS_LIMITS = { reads: 8, excerpt: 240, name: 40, target: 120, subject: 300, total: 2000, said: 300 } as const;

/** The kinds whose line is written for every origin: the person's own change of the configuration, a secret or a plugin decision, and the persona's act that wrote nothing else. */
export const WHO_AUDIT_KINDS = ['config', 'secret', 'plugin-decision', 'act'] as const satisfies readonly AuditKind[];

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
  /**
   * Who acted, when it was not a person: `persona`. Absent on a line written before, and for the person's own acts, which every old line reads as. It never means the agent whose
   * autonomy let a write go out (that is `by`). Stamped by the writer while a persona act is open, never by the handler.
   */
  actor?: 'persona';
  /** The door the message that made the persona act came by: `window` or `paired`; open to more values. */
  door?: string;
  /** The id of the persona's act, shared by every line the act wrote; the chat links to it. */
  id?: string;
  /** The persona's own one-sentence reason: its claim, kept as it said it. */
  said?: string;
  /** What the persona had read when it decided. */
  basis?: AuditBasis;
  /** An approval of an action that the same persona proposed. */
  proposedBy?: 'persona';
}
