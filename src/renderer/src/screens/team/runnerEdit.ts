import type { RunnerConfig } from '../../../../shared/config/types';

// The runner settings, as pure functions: the draft a person types into, the checks shown while typing (the ones the config validator holds, in words of this
// screen), and the config the draft makes.

export interface RunnerDraft {
  enabled: boolean;
  triggerLabel: string;
  maxConcurrentRuns: number;
  /** Empty: the worktrees folder of the workspace's data folder. */
  worktreesDir: string;
  /** `repo`: the test and typecheck scripts the repository declares. `custom`: only the commands listed. */
  commandsMode: 'repo' | 'custom';
  commands: string[];
  /** How long the agent may show no sign of life. */
  idleMinutes: number;
  /** The cap on a stage, whatever the agent shows. */
  maxMinutes: number;
  /** Steps an agent that only reads may take in a pass, and one that changes files. */
  turnsRead: number;
  turnsWrite: number;
  identityName: string;
  identityEmail: string;
  commitMessage: string;
}

export function draftOfRunner(r: RunnerConfig): RunnerDraft {
  return {
    enabled: r.enabled,
    triggerLabel: r.triggerLabel,
    maxConcurrentRuns: r.maxConcurrentRuns,
    worktreesDir: r.worktreesDir ?? '',
    commandsMode: r.commands === null ? 'repo' : 'custom',
    commands: [...(r.commands ?? [])],
    idleMinutes: r.stageIdleMs / 60_000,
    maxMinutes: r.stageMaxMs / 60_000,
    turnsRead: r.turns.read,
    turnsWrite: r.turns.write,
    identityName: r.identity.name,
    identityEmail: r.identity.email,
    commitMessage: r.commitMessage,
  };
}

export function runnerOf(d: RunnerDraft): RunnerConfig {
  return {
    enabled: d.enabled,
    triggerLabel: d.triggerLabel.trim(),
    maxConcurrentRuns: d.maxConcurrentRuns,
    worktreesDir: d.worktreesDir.trim() || null,
    commands: d.commandsMode === 'repo' ? null : d.commands,
    stageIdleMs: Math.round(d.idleMinutes * 60_000),
    stageMaxMs: Math.round(d.maxMinutes * 60_000),
    turns: { read: d.turnsRead, write: d.turnsWrite },
    identity: { name: d.identityName.trim(), email: d.identityEmail.trim() },
    commitMessage: d.commitMessage,
  };
}

/**
 * The runner the draft makes when the screen is open in a paired browser: the commands an agent may run, the folder of the worktrees and the identity of
 * the commits are the stored ones whatever the draft says, because only the computer changes them (the save is refused otherwise).
 */
export function runnerOfWeb(d: RunnerDraft, stored: RunnerConfig): RunnerConfig {
  return { ...runnerOf(d), worktreesDir: stored.worktreesDir, commands: stored.commands, identity: { ...stored.identity } };
}

export type RunnerField = 'triggerLabel' | 'maxConcurrentRuns' | 'commands' | 'idle' | 'max' | 'turns' | 'identity' | 'commitMessage';

export interface RunnerProblem {
  severity: 'error' | 'warning';
  field: RunnerField;
  /** A catalog key of this screen. */
  key: string;
  params?: Record<string, string>;
}

// One plain command: no pipe, `;`, `&&`, redirect, substitution or line break (the same rule the config validator holds).
const COMMAND_OPERATORS = /[;&|<>`$\\\n\r]/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+$/;

export const MIN_IDLE_MINUTES = 1;
export const MAX_IDLE_MINUTES = 360;
export const MIN_TURNS = 1;
export const MAX_TURNS = 500;
export const MIN_CAP_MINUTES = 1;
export const MAX_CAP_MINUTES = 1440;

/** Adds a command to the list: trimmed, and not twice. */
export function withCommand(commands: string[], text: string): string[] {
  const c = text.trim();
  return c && !commands.includes(c) ? [...commands, c] : commands;
}

export function runnerProblems(d: RunnerDraft, cycleIsFlow: boolean): RunnerProblem[] {
  const out: RunnerProblem[] = [];
  const error = (field: RunnerField, key: string, params?: Record<string, string>): void => void out.push({ severity: 'error', field, key, params });
  if (d.enabled && !d.triggerLabel.trim()) error('triggerLabel', 'ui.runner.err.trigger');
  if (!Number.isInteger(d.maxConcurrentRuns) || d.maxConcurrentRuns < 1 || d.maxConcurrentRuns > 10) error('maxConcurrentRuns', 'ui.runner.err.concurrent');
  if (!(d.idleMinutes >= MIN_IDLE_MINUTES && d.idleMinutes <= MAX_IDLE_MINUTES)) error('idle', 'ui.runner.err.idle', { min: String(MIN_IDLE_MINUTES), max: String(MAX_IDLE_MINUTES) });
  if (!(d.maxMinutes >= MIN_CAP_MINUTES && d.maxMinutes <= MAX_CAP_MINUTES)) error('max', 'ui.runner.err.max', { min: String(MIN_CAP_MINUTES), max: String(MAX_CAP_MINUTES) });
  for (const n of [d.turnsRead, d.turnsWrite]) if (!Number.isInteger(n) || n < MIN_TURNS || n > MAX_TURNS) error('turns', 'ui.runner.err.turns', { min: String(MIN_TURNS), max: String(MAX_TURNS) });
  if (d.commandsMode === 'custom') {
    d.commands.forEach((c) => {
      if (!c.trim() || c !== c.trim()) error('commands', 'ui.runner.err.commandBlank');
      else if (COMMAND_OPERATORS.test(c)) error('commands', 'ui.runner.err.commandPlain', { command: c });
      else if (c.length > 300) error('commands', 'ui.runner.err.commandLong', { command: c });
    });
    if (d.commands.length > 20) error('commands', 'ui.runner.err.commandCount');
  }
  const name = d.identityName.trim();
  const email = d.identityEmail.trim();
  if (!!name !== !!email) error('identity', 'ui.runner.err.identityPair');
  else if (email && !EMAIL.test(email)) error('identity', 'ui.runner.err.email');
  if (!d.commitMessage.includes('{summary}')) error('commitMessage', 'ui.runner.err.commitSummary');
  if (/[\n\r]/.test(d.commitMessage)) error('commitMessage', 'ui.runner.err.commitLine');
  if (d.commitMessage.length > 200) error('commitMessage', 'ui.runner.err.commitLong');
  if (d.enabled && !cycleIsFlow) out.push({ severity: 'warning', field: 'triggerLabel', key: 'ui.runner.warn.notFlow' });
  if (d.idleMinutes > d.maxMinutes) out.push({ severity: 'warning', field: 'idle', key: 'ui.runner.warn.idleLonger' });
  if (d.commandsMode === 'custom' && d.commands.length === 0) out.push({ severity: 'warning', field: 'commands', key: 'ui.runner.warn.noCommands' });
  return out;
}
