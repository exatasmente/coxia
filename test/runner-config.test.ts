import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, collectCommands, collectPaths, migrateConfig, neutralConfig, neutralRunner, validateConfig, withConfigDefaults } from '../src/shared/config';
import { CONFIG_SCHEMA_VERSION, type RunnerConfig, type WorkspaceConfig } from '../src/shared/config/types';

type Doc = Record<string, any>;

const withRunner = (change: Partial<RunnerConfig>): WorkspaceConfig => ({ ...neutralConfig(), runner: { ...neutralRunner(), ...change } });
const errorsOf = (c: WorkspaceConfig): string[] => validateConfig(c).errors.map((e) => `${e.path}: ${e.message}`);

describe('the runner section', () => {
  it('is off by default, with the label "coxia", one run at a time, the repository\'s own commands and no identity of its own', () => {
    expect(neutralConfig().runner).toEqual({ enabled: false, triggerLabel: 'coxia', maxConcurrentRuns: 1, worktreesDir: null, commands: null, stageIdleMs: 600_000, stageMaxMs: 7_200_000, turns: { read: 30, write: 80 }, identity: { name: '', email: '' }, sandbox: { network: 'off', registryHosts: ['registry.npmjs.org', 'registry.yarnpkg.com'], readOnlyPaths: [], browsersPath: null, display: false, limits: { commandMs: 300_000, stageMs: 1_800_000, memoryMb: 2048, processes: 256, fileMb: 256, copyMb: 2048 } }, autonomy: { cycle: false, hostCommands: false, gates: false, push: false, pullRequest: false, board: false }, evidence: 'app', procedures: true, flex: true, unconfined: false, sharedMemory: true, commitMessage: 'feat: {summary} #{iid}', prTitle: '{title} #{iid}', linkDependencies: true, release: { soleMaintainer: false }, conversations: { roundsPerConversation: 6, perStage: 3 } });
    expect(validateConfig(neutralConfig()).ok).toBe(true);
  });

  it('bounds the turn caps, and a file that has none gets the caps the runner always had', () => {
    expect(errorsOf(withRunner({ turns: { read: 0, write: 80 } })).join(' ')).toContain('runner.turns.read');
    expect(errorsOf(withRunner({ turns: { read: 30, write: 501 } })).join(' ')).toContain('runner.turns.write');
    expect(withConfigDefaults({ runner: { enabled: true } } as unknown as Doc).runner.turns).toEqual({ read: 30, write: 80 });
    expect(withConfigDefaults({ runner: { turns: { write: 120 } } } as unknown as Doc).runner.turns).toEqual({ read: 30, write: 120 });
  });

  it('links the dependencies of the clone by default, and a stored file without the setting reads as on, with no schema version change', () => {
    expect(neutralConfig().runner.linkDependencies).toBe(true);
    expect(withConfigDefaults({ runner: { enabled: true } } as unknown as Doc).runner.linkDependencies).toBe(true);
    expect(withConfigDefaults({ runner: { linkDependencies: false } } as unknown as Doc).runner.linkDependencies).toBe(false);
    expect(CONFIG_SCHEMA.properties?.runner?.required).toBeUndefined();
    expect(validateConfig(withRunner({ linkDependencies: false })).ok).toBe(true);
    expect(validateConfig(withRunner({ linkDependencies: 'yes' as unknown as boolean })).ok).toBe(false);
    const { linkDependencies: _omitted, ...stored } = neutralRunner();
    expect(validateConfig({ ...neutralConfig(), runner: stored as RunnerConfig }).ok).toBe(true);
  });

  it('fills what a stored file leaves out, field by field', () => {
    const c = withConfigDefaults({ runner: { enabled: true, identity: { name: 'Dev' } } } as unknown as Doc);
    expect(c.runner).toMatchObject({ enabled: true, triggerLabel: 'coxia', identity: { name: 'Dev', email: '' } });
  });

  it('is described in the JSON Schema with the same fields as the type', () => {
    const runner = CONFIG_SCHEMA.properties?.runner;
    expect(Object.keys(runner?.properties ?? {}).sort()).toEqual(Object.keys(neutralRunner()).sort());
  });

  it('accepts an empty list of commands (none), a list, and null (the repository\'s own)', () => {
    for (const commands of [[], ['npm test', 'npm run typecheck'], null]) expect(validateConfig(withRunner({ commands })).ok).toBe(true);
  });

  it('refuses a command that is not one plain command', () => {
    for (const bad of ['npm test && rm -rf x', 'npm test | tee log', 'npm test; ls', 'cat < file', 'echo `id`', 'echo $HOME', ' npm test']) {
      expect(errorsOf(withRunner({ commands: [bad] })).join(' '), bad).toContain('runner.commands[0]');
    }
  });

  it('needs {summary} in the commit message, on one line', () => {
    expect(errorsOf(withRunner({ commitMessage: 'feat: something' }))).toEqual(['runner.commitMessage: must contain {summary}', 'runner.commitMessage: must contain {iid}: every commit of a run carries the issue number']);
    expect(errorsOf(withRunner({ commitMessage: 'feat: {summary}\n\nmore' }))).toEqual(['runner.commitMessage: must contain {iid}: every commit of a run carries the issue number', 'runner.commitMessage: must be one line']);
    expect(validateConfig(withRunner({ commitMessage: 'fix: {summary} (#{iid})' })).ok).toBe(true);
  });

  it('refuses a template that would leave the issue number out, in either of the two', () => {
    expect(errorsOf(withRunner({ commitMessage: 'fix: {summary}' }))).toContain('runner.commitMessage: must contain {iid}: every commit of a run carries the issue number');
    expect(errorsOf(withRunner({ commitMessage: 'feat: {summary} {iid}' })).join(' ')).not.toContain('runner.commitMessage');
    const noTitle = errorsOf(withRunner({ prTitle: 'release {iid}' }));
    expect(noTitle).toContain('runner.prTitle: must contain {title}');
    expect(noTitle.join(' ')).not.toContain('runner.prTitle: must contain {iid}');
    expect(errorsOf(withRunner({ prTitle: 'the whole title' }))).toEqual(['runner.prTitle: must contain {title}', 'runner.prTitle: must contain {iid}: every pull request of a run carries the issue number']);
    expect(errorsOf(withRunner({ prTitle: '{title}\nmore' }))).toContain('runner.prTitle: must be one line');
    expect(validateConfig(withRunner({ prTitle: '#{iid} {title}' })).ok).toBe(true);
    expect(errorsOf(withRunner({ prTitle: '' })).join(' ')).toContain('runner.prTitle');
  });

  it('fills the title template of a stored file that has none, before checking it', () => {
    const { prTitle: _gone, ...stored } = neutralRunner();
    const c = withConfigDefaults({ runner: stored as RunnerConfig } as unknown as Doc);
    expect(c.runner.prTitle).toBe('{title} #{iid}');
    expect(validateConfig({ ...neutralConfig(), runner: stored as RunnerConfig }).ok).toBe(true);
  });

  it('needs both halves of the identity, or neither, and an email that looks like one', () => {
    expect(errorsOf(withRunner({ identity: { name: 'Dev', email: '' } }))).toEqual(['runner.identity: needs both a name and an email, or neither']);
    expect(errorsOf(withRunner({ identity: { name: 'Dev', email: 'not an email' } }))).toEqual(['runner.identity.email: is not an email address']);
    expect(validateConfig(withRunner({ identity: { name: 'Dev', email: 'dev@example.com' } })).ok).toBe(true);
  });

  it('needs a trigger label when it is on, and warns when the cycle is not the agent cycle', () => {
    expect(errorsOf(withRunner({ enabled: true, triggerLabel: ' ' }))).toEqual(['runner.triggerLabel: is empty but the runner is enabled']);
    const r = validateConfig(withRunner({ enabled: true }));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path)).toContain('runner.enabled');
  });

  it('bounds the concurrency and the stage limits, and warns when the silence limit is longer than the cap', () => {
    expect(errorsOf(withRunner({ maxConcurrentRuns: 0 })).join(' ')).toContain('runner.maxConcurrentRuns');
    expect(errorsOf(withRunner({ maxConcurrentRuns: 11 })).join(' ')).toContain('runner.maxConcurrentRuns');
    expect(errorsOf(withRunner({ stageIdleMs: 5 })).join(' ')).toContain('runner.stageIdleMs');
    expect(errorsOf(withRunner({ stageMaxMs: 5 })).join(' ')).toContain('runner.stageMaxMs');
    expect(errorsOf(withRunner({ stageMaxMs: 90_000_000 })).join(' ')).toContain('runner.stageMaxMs');
    expect(validateConfig(withRunner({ stageIdleMs: 3_600_000, stageMaxMs: 600_000 })).warnings.map((w) => w.path)).toContain('runner.stageIdleMs');
    expect(validateConfig(neutralConfig()).warnings.map((w) => w.path)).not.toContain('runner.stageIdleMs');
  });

  it('puts its commands and its folder in what an import preview shows', () => {
    const c = withRunner({ commands: ['npm test'], worktreesDir: '~/work/trees' });
    expect(collectCommands(c)).toContainEqual({ field: 'runner.commands[0]', command: 'npm test' });
    expect(collectPaths(c)).toContainEqual({ field: 'runner.worktreesDir', path: '~/work/trees' });
  });
});

describe('the migration to schema 6', () => {
  const v5 = (change: (c: Doc) => void = () => undefined): Doc => {
    const c = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    c.schemaVersion = 5;
    delete c.runner;
    change(c);
    return c;
  };

  it('adds the runner switched off and touches nothing else', () => {
    const before = v5((c) => (c.language = 'en'));
    const r = migrateConfig(before, { legacyInstall: false });
    expect(r.fromVersion).toBe(5);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    // A file of schema 5 is a workspace that existed: the learned procedures are off for it.
    expect(r.config.runner).toEqual({ ...neutralRunner(), procedures: false, sharedMemory: false });
    expect(r.config.language).toBe('en');
    expect(r.notes.join(' ')).toContain('runner');
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('keeps a runner section that is already there', () => {
    const r = migrateConfig(v5((c) => (c.runner = { ...neutralRunner(), enabled: true, triggerLabel: 'auto' })), { legacyInstall: false });
    expect(r.config.runner).toMatchObject({ enabled: true, triggerLabel: 'auto' });
  });

  it('carries a v3 file through every step', () => {
    const r = migrateConfig({ schemaVersion: 3, language: 'en' }, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.runner).toEqual({ ...neutralRunner(), procedures: false, sharedMemory: false });
    expect(r.config.agents.team).toHaveLength(5);
  });

  it('does not open a file written by a newer app', () => {
    expect(() => migrateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION + 1 }, { legacyInstall: false })).toThrow(/newer app/);
  });
});
