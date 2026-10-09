import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import type { RunnerConfig } from '../src/shared/config/types';
import { draftOfRunner, runnerOf, runnerOfWeb, runnerProblems, withCommand, type RunnerDraft } from '../src/renderer/src/screens/team/runnerEdit';

const base = (): RunnerDraft => draftOfRunner(neutralConfig().runner);
const keys = (d: RunnerDraft, flow = true) => runnerProblems(d, flow).map((p) => `${p.severity}:${p.key.split('.').pop()}`);

describe('the runner draft', () => {
  it('round trips the defaults and a configured runner', () => {
    expect(runnerOf(base())).toEqual(neutralConfig().runner);
    const r: RunnerConfig = { enabled: true, triggerLabel: 'agents', maxConcurrentRuns: 3, worktreesDir: '~/work', commands: ['npm test'], stageIdleMs: 15 * 60_000, stageMaxMs: 90 * 60_000, turns: { read: 12, write: 40 }, identity: { name: 'Bot', email: 'bot@example.com' }, sandbox: neutralConfig().runner.sandbox, autonomy: neutralConfig().runner.autonomy, evidence: 'app', procedures: true, commitMessage: 'fix: {summary} {iid}', prTitle: '#{iid} {title}', linkDependencies: true, release: { soleMaintainer: true }, conversations: { roundsPerConversation: 8, perStage: 2 } };
    expect(runnerOf(draftOfRunner(r))).toEqual(r);
    expect(draftOfRunner(r)).toMatchObject({ commandsMode: 'custom', idleMinutes: 15, maxMinutes: 90, turnsRead: 12, turnsWrite: 40 });
  });

  it('carries the dependency link setting both ways, and a config stored without it shows as on', () => {
    expect(runnerOf({ ...base(), linkDependencies: false }).linkDependencies).toBe(false);
    expect(draftOfRunner({ ...neutralConfig().runner, linkDependencies: undefined as unknown as boolean }).linkDependencies).toBe(true);
    expect(runnerOfWeb({ ...base(), linkDependencies: false }, neutralConfig().runner).linkDependencies).toBe(false);
  });

  it('carries the only maintainer switch from the computer, reads a config stored without it as off, and keeps the stored one from a paired browser', () => {
    expect(runnerOf({ ...base(), soleMaintainer: true }).release).toEqual({ soleMaintainer: true });
    const { release: _gone, ...old } = neutralConfig().runner;
    expect(draftOfRunner(old).soleMaintainer).toBe(false);
    // a paired browser cannot turn it on, nor give a config that never had it one (the save would be refused for a path it may not change)
    expect(runnerOfWeb({ ...base(), soleMaintainer: true }, neutralConfig().runner).release).toEqual({ soleMaintainer: false });
    expect(runnerOfWeb({ ...base(), soleMaintainer: true }, old).release).toBeUndefined();
    expect(runnerOfWeb({ ...base(), soleMaintainer: false }, { ...old, release: { soleMaintainer: true } }).release).toEqual({ soleMaintainer: true });
  });

  it('carries the learned procedures switch from the computer, reads a config stored without it as off, and keeps the stored one from a paired browser', () => {
    expect(base().procedures).toBe(true);
    expect(runnerOf({ ...base(), procedures: false }).procedures).toBe(false);
    const { procedures: _gone, ...old } = neutralConfig().runner;
    expect(draftOfRunner(old).procedures).toBe(false);
    // a paired browser can neither turn it on nor off, nor give a config that never had it one
    expect(runnerOfWeb({ ...base(), procedures: false }, neutralConfig().runner).procedures).toBe(true);
    expect(runnerOfWeb({ ...base(), procedures: true }, { ...old, procedures: false }).procedures).toBe(false);
    expect(runnerOfWeb({ ...base(), procedures: true }, old).procedures).toBeUndefined();
  });

  it('no commands list means the repository\'s own scripts, and an empty list means none', () => {
    expect(runnerOf({ ...base(), commandsMode: 'repo', commands: ['x'] }).commands).toBeNull();
    expect(runnerOf({ ...base(), commandsMode: 'custom', commands: [] }).commands).toEqual([]);
  });

  it('trims the text fields and turns an empty folder into the default', () => {
    const r = runnerOf({ ...base(), triggerLabel: ' coxia ', worktreesDir: '  ', identityName: ' A ', identityEmail: ' a@example.com ' });
    expect(r).toMatchObject({ triggerLabel: 'coxia', worktreesDir: null, identity: { name: 'A', email: 'a@example.com' } });
  });
});

describe('the problems of the runner draft', () => {
  it('is quiet for the defaults, on or off', () => {
    expect(keys(base())).toEqual([]);
    expect(keys({ ...base(), enabled: true })).toEqual([]);
  });

  it('asks for a trigger label only when the runner is on', () => {
    expect(keys({ ...base(), triggerLabel: '' })).toEqual([]);
    expect(keys({ ...base(), enabled: true, triggerLabel: ' ' })).toEqual(['error:trigger']);
  });

  it('keeps the numbers in range', () => {
    expect(keys({ ...base(), maxConcurrentRuns: 0 })).toEqual(['error:concurrent']);
    expect(keys({ ...base(), maxConcurrentRuns: 11 })).toEqual(['error:concurrent']);
    expect(keys({ ...base(), maxConcurrentRuns: 2.5 })).toEqual(['error:concurrent']);
    expect(keys({ ...base(), idleMinutes: 0.5 })).toEqual(['error:idle']);
    expect(keys({ ...base(), idleMinutes: 361 })).toEqual(['error:idle', 'warning:idleLonger']);
    expect(keys({ ...base(), idleMinutes: 360, maxMinutes: 1440 })).toEqual([]);
    expect(keys({ ...base(), maxMinutes: 0.5 })).toEqual(['error:max', 'warning:idleLonger']);
    expect(keys({ ...base(), maxMinutes: 1441 })).toEqual(['error:max']);
    expect(keys({ ...base(), idleMinutes: 30, maxMinutes: 20 })).toEqual(['warning:idleLonger']);
  });

  it('keeps the turn caps whole numbers from 1 to 500', () => {
    expect(keys({ ...base(), turnsRead: 0 })).toEqual(['error:turns']);
    expect(keys({ ...base(), turnsWrite: 501 })).toEqual(['error:turns']);
    expect(keys({ ...base(), turnsWrite: 2.5 })).toEqual(['error:turns']);
    expect(keys({ ...base(), turnsRead: 1, turnsWrite: 500 })).toEqual([]);
    expect(runnerOf({ ...base(), turnsRead: 5, turnsWrite: 9 }).turns).toEqual({ read: 5, write: 9 });
  });

  it('wants plain commands, one each', () => {
    const d = (commands: string[]): RunnerDraft => ({ ...base(), commandsMode: 'custom', commands });
    expect(keys(d(['npm test', 'npm run typecheck']))).toEqual([]);
    for (const bad of ['npm test | tee x', 'a; b', 'a && b', 'a > f', 'echo `x`', 'echo $HOME', 'a\\b']) expect(keys(d([bad])), bad).toEqual(['error:commandPlain']);
    expect(keys(d([' npm test']))).toEqual(['error:commandBlank']);
    expect(keys(d([]))).toEqual(['warning:noCommands']);
    expect(keys({ ...d(['a; b']), commandsMode: 'repo' })).toEqual([]);
  });

  it('wants both halves of an identity, or neither, and an address', () => {
    expect(keys({ ...base(), identityName: 'Bot' })).toEqual(['error:identityPair']);
    expect(keys({ ...base(), identityEmail: 'bot@example.com' })).toEqual(['error:identityPair']);
    expect(keys({ ...base(), identityName: 'Bot', identityEmail: 'nope' })).toEqual(['error:email']);
    expect(keys({ ...base(), identityName: 'Bot', identityEmail: 'bot@example.com' })).toEqual([]);
  });

  it('wants {summary} in one line of at most 200 characters', () => {
    expect(keys({ ...base(), commitMessage: 'feat: stuff' })).toEqual(['error:commitSummary', 'error:commitIssue']);
    expect(keys({ ...base(), commitMessage: 'feat: {summary}\nmore' })).toEqual(['error:commitIssue', 'error:commitLine']);
    expect(keys({ ...base(), commitMessage: `{summary}${'x'.repeat(200)}` })).toEqual(['error:commitIssue', 'error:commitLong']);
  });

  it('warns that the runner works only with a flow cycle', () => {
    expect(keys({ ...base(), enabled: true }, false)).toEqual(['warning:notFlow']);
    expect(keys(base(), false)).toEqual([]);
  });

  it('adds a command trimmed and once', () => {
    expect(withCommand(['a'], ' b ')).toEqual(['a', 'b']);
    expect(withCommand(['a'], 'a')).toEqual(['a']);
    expect(withCommand(['a'], '  ')).toEqual(['a']);
  });

  it('agrees with the config validator about every error', () => {
    const cases: Partial<RunnerDraft>[] = [
      { enabled: true, triggerLabel: '' },
      { commandsMode: 'custom', commands: ['a | b'] },
      { commandsMode: 'custom', commands: [' a'] },
      { identityName: 'x' },
      { identityName: 'x', identityEmail: 'bad' },
      { commitMessage: 'nope' },
      { commitMessage: '{summary}\nx' },
      { commitMessage: 'fix: {summary}' },
      { prTitle: 'nope' },
      { prTitle: '{title}' },
      { prTitle: '{title} {iid}\nx' },
      { maxConcurrentRuns: 0 },
      { idleMinutes: 0.01 },
      { maxMinutes: 0.01 },
      {},
      { enabled: true },
      { commandsMode: 'custom', commands: ['npm test'] },
      { identityName: 'x', identityEmail: 'x@example.com' },
    ];
    for (const over of cases) {
      const d = { ...base(), ...over };
      const c = neutralConfig();
      c.runner = runnerOf(d);
      const mine = runnerProblems(d, true).some((p) => p.severity === 'error');
      const theirs = !validateConfig(c).ok;
      expect(mine, JSON.stringify(over)).toBe(theirs);
    }
  });
});

describe('the runner saved from a paired browser', () => {
  const stored: RunnerConfig = { ...neutralConfig().runner, worktreesDir: '~/work', commands: ['npm test'], identity: { name: 'Bot', email: 'bot@example.com' } };

  it('takes the plain settings from the draft and the folder, the commands and the identity from the stored runner, whatever the draft says', () => {
    const draft: RunnerDraft = { ...draftOfRunner(stored), enabled: true, maxConcurrentRuns: 4, worktreesDir: '/etc', commandsMode: 'custom', commands: ['curl example.com'], identityName: 'Mallory', identityEmail: 'm@example.com' };
    const made = runnerOfWeb(draft, stored);
    expect(made).toMatchObject({ enabled: true, maxConcurrentRuns: 4, worktreesDir: '~/work', commands: ['npm test'], identity: { name: 'Bot', email: 'bot@example.com' } });
  });

  it('keeps a runner that uses the repository\'s scripts and the default folder as it is', () => {
    const plain = neutralConfig().runner;
    expect(runnerOfWeb({ ...draftOfRunner(plain), commandsMode: 'custom', commands: ['x'], worktreesDir: 'y' }, plain)).toEqual(plain);
  });
});

describe('the sandbox block of the runner draft', () => {
  it('round trips the defaults, trims and lowercases hosts, and keeps the stored sandbox for a paired browser', () => {
    const d = base();
    expect(runnerOf(d).sandbox).toEqual(neutralConfig().runner.sandbox);
    const edited = { ...d, sandbox: { ...d.sandbox, network: 'registry' as const, registryHosts: [' Registry.Example.com '], readOnlyPaths: [' ~/tools/node '] } };
    expect(runnerOf(edited).sandbox).toMatchObject({ network: 'registry', registryHosts: ['registry.example.com'], readOnlyPaths: ['~/tools/node'] });
    expect(runnerOfWeb(edited, neutralConfig().runner).sandbox).toEqual(neutralConfig().runner.sandbox);
  });

  it('says what is wrong with a host, a folder and a limit, and warns that the registry is on', () => {
    const d = base();
    const bad = { ...d, sandbox: { ...d.sandbox, network: 'registry' as const, registryHosts: ['https://x.example.com'], readOnlyPaths: ['~/.ssh', 'relative'], limits: { ...d.sandbox.limits, memoryMb: 1 } } };
    expect(keys(bad)).toEqual(expect.arrayContaining(['error:sandboxHost', 'error:sandboxPathSecret', 'error:sandboxPath', 'error:sandboxLimit', 'warning:registryOn']));
    expect(keys(base())).toEqual([]);
  });
});
