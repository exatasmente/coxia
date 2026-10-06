import type { RunnerConfig, RunnerSandbox } from '../../../../shared/config/types';
import { soleMaintainerOf } from '../../../../shared/release';
import { MAX_READ_ONLY_PATHS, MAX_REGISTRY_HOSTS, SANDBOX_LIMIT_RANGES, isRegistryHost, readOnlyPathProblem } from '../../../../shared/sandboxPaths';

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
  /** What the sandbox of an agent set to run commands in one may reach and use (desktop only). */
  sandbox: RunnerSandbox;
  linkDependencies: boolean;
  /** The person is the repository's only maintainer: their yes on a merge of a release stands for the review (desktop only). */
  soleMaintainer: boolean;
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
    sandbox: structuredClone(r.sandbox),
    linkDependencies: r.linkDependencies !== false,
    soleMaintainer: soleMaintainerOf(r),
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
    sandbox: { ...d.sandbox, registryHosts: d.sandbox.registryHosts.map((h) => h.trim().toLowerCase()), readOnlyPaths: d.sandbox.readOnlyPaths.map((p) => p.trim()), browsersPath: d.sandbox.browsersPath?.trim() || null, display: d.sandbox.display === true },
    commitMessage: d.commitMessage,
    linkDependencies: d.linkDependencies,
    release: { soleMaintainer: d.soleMaintainer },
  };
}

/**
 * The runner the draft makes when the screen is open in a paired browser: the commands an agent may run, the folder of the worktrees, the identity of the commits and
 * whether the person's yes stands for a review are the stored ones whatever the draft says, because only the computer changes them (the save is refused otherwise).
 */
export function runnerOfWeb(d: RunnerDraft, stored: RunnerConfig): RunnerConfig {
  return { ...runnerOf(d), worktreesDir: stored.worktreesDir, commands: stored.commands, identity: { ...stored.identity }, sandbox: structuredClone(stored.sandbox), release: stored.release && { ...stored.release } };
}

export type RunnerField = 'triggerLabel' | 'maxConcurrentRuns' | 'commands' | 'idle' | 'max' | 'turns' | 'identity' | 'commitMessage' | 'sandboxHosts' | 'sandboxPaths' | 'sandboxBrowsers' | 'sandboxLimits';

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
  for (const h of d.sandbox.registryHosts) if (!isRegistryHost(h.trim().toLowerCase())) error('sandboxHosts', 'ui.runner.err.sandboxHost', { host: h });
  if (d.sandbox.registryHosts.length > MAX_REGISTRY_HOSTS) error('sandboxHosts', 'ui.runner.err.sandboxHostCount', { max: String(MAX_REGISTRY_HOSTS) });
  for (const p of d.sandbox.readOnlyPaths) {
    const why = readOnlyPathProblem(p);
    if (why) error('sandboxPaths', why === 'secret' ? 'ui.runner.err.sandboxPathSecret' : 'ui.runner.err.sandboxPath', { path: p });
  }
  if (d.sandbox.readOnlyPaths.length > MAX_READ_ONLY_PATHS) error('sandboxPaths', 'ui.runner.err.sandboxPathCount', { max: String(MAX_READ_ONLY_PATHS) });
  // The browsers folder is bound like a read-only folder: the same guards, the same messages.
  const browsers = d.sandbox.browsersPath?.trim();
  if (browsers) {
    const why = readOnlyPathProblem(browsers);
    if (why) error('sandboxBrowsers', why === 'secret' ? 'ui.runner.err.sandboxPathSecret' : 'ui.runner.err.sandboxPath', { path: browsers });
  }
  for (const [key, [min, max]] of Object.entries(SANDBOX_LIMIT_RANGES)) {
    const v = d.sandbox.limits[key as keyof typeof d.sandbox.limits];
    if (!Number.isInteger(v) || v < min || v > max) error('sandboxLimits', 'ui.runner.err.sandboxLimit', { min: String(min), max: String(max) });
  }
  if (d.sandbox.network === 'registry') out.push({ severity: 'warning', field: 'sandboxHosts', key: 'ui.runner.warn.registryOn' });
  if (d.enabled && !cycleIsFlow) out.push({ severity: 'warning', field: 'triggerLabel', key: 'ui.runner.warn.notFlow' });
  if (d.idleMinutes > d.maxMinutes) out.push({ severity: 'warning', field: 'idle', key: 'ui.runner.warn.idleLonger' });
  if (d.commandsMode === 'custom' && d.commands.length === 0) out.push({ severity: 'warning', field: 'commands', key: 'ui.runner.warn.noCommands' });
  return out;
}
