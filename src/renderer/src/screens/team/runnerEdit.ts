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
  timeoutMinutes: number;
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
    timeoutMinutes: r.stageTimeoutMs / 60_000,
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
    stageTimeoutMs: Math.round(d.timeoutMinutes * 60_000),
    identity: { name: d.identityName.trim(), email: d.identityEmail.trim() },
    commitMessage: d.commitMessage,
  };
}

export type RunnerField = 'triggerLabel' | 'maxConcurrentRuns' | 'commands' | 'timeout' | 'identity' | 'commitMessage';

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

export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 360;

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
  if (!(d.timeoutMinutes >= MIN_TIMEOUT_MINUTES && d.timeoutMinutes <= MAX_TIMEOUT_MINUTES)) error('timeout', 'ui.runner.err.timeout', { min: String(MIN_TIMEOUT_MINUTES), max: String(MAX_TIMEOUT_MINUTES) });
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
  if (d.commandsMode === 'custom' && d.commands.length === 0) out.push({ severity: 'warning', field: 'commands', key: 'ui.runner.warn.noCommands' });
  return out;
}
