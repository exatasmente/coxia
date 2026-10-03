import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, collectCommands, collectPaths, migrateConfig, neutralConfig, neutralRunner, validateConfig, withConfigDefaults } from '../src/shared/config';
import type { RunnerConfig, WorkspaceConfig } from '../src/shared/config/types';

type Doc = Record<string, any>;

const withRunner = (change: Partial<RunnerConfig>): WorkspaceConfig => ({ ...neutralConfig(), runner: { ...neutralRunner(), ...change } });
const errorsOf = (c: WorkspaceConfig): string[] => validateConfig(c).errors.map((e) => `${e.path}: ${e.message}`);

describe('the runner section', () => {
  it('is off by default, with the label "coxia", one run at a time, the repository\'s own commands and no identity of its own', () => {
    expect(neutralConfig().runner).toEqual({ enabled: false, triggerLabel: 'coxia', maxConcurrentRuns: 1, worktreesDir: null, commands: null, stageTimeoutMs: 1_800_000, identity: { name: '', email: '' }, commitMessage: 'feat: {summary} #{iid}' });
    expect(validateConfig(neutralConfig()).ok).toBe(true);
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
    expect(errorsOf(withRunner({ commitMessage: 'feat: something' }))).toEqual(['runner.commitMessage: must contain {summary}']);
    expect(errorsOf(withRunner({ commitMessage: 'feat: {summary}\n\nmore' }))).toEqual(['runner.commitMessage: must be one line']);
    expect(validateConfig(withRunner({ commitMessage: 'fix: {summary} (#{iid})' })).ok).toBe(true);
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

  it('bounds the concurrency and the stage timeout', () => {
    expect(errorsOf(withRunner({ maxConcurrentRuns: 0 })).join(' ')).toContain('runner.maxConcurrentRuns');
    expect(errorsOf(withRunner({ maxConcurrentRuns: 11 })).join(' ')).toContain('runner.maxConcurrentRuns');
    expect(errorsOf(withRunner({ stageTimeoutMs: 5 })).join(' ')).toContain('runner.stageTimeoutMs');
  });

  it('puts its commands and its folder in what an import preview shows', () => {
    const c = withRunner({ commands: ['npm test'], worktreesDir: '~/work/trees' });
    expect(collectCommands(c)).toContainEqual({ field: 'runner.commands[0]', command: 'npm test' });
    expect(collectPaths(c)).toContainEqual({ field: 'runner.worktreesDir', path: '~/work/trees' });
  });
});

describe('the migration to schema 5', () => {
  const v4 = (change: (c: Doc) => void = () => undefined): Doc => {
    const c = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    c.schemaVersion = 4;
    delete c.runner;
    change(c);
    return c;
  };

  it('adds the runner switched off and touches nothing else', () => {
    const before = v4((c) => (c.language = 'en'));
    const r = migrateConfig(before, { legacyInstall: false });
    expect(r.fromVersion).toBe(4);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(6);
    expect(r.config.runner).toEqual(neutralRunner());
    expect(r.config.language).toBe('en');
    expect(r.notes.join(' ')).toContain('runner');
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('keeps a runner section that is already there', () => {
    const r = migrateConfig(v4((c) => (c.runner = { ...neutralRunner(), enabled: true, triggerLabel: 'auto' })), { legacyInstall: false });
    expect(r.config.runner).toMatchObject({ enabled: true, triggerLabel: 'auto' });
  });

  it('carries a v3 file through both steps', () => {
    const r = migrateConfig({ schemaVersion: 3, language: 'en' }, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(6);
    expect(r.config.runner).toEqual(neutralRunner());
    expect(r.config.agents.team).toHaveLength(5);
  });

  it('does not open a file written by a newer app', () => {
    expect(() => migrateConfig({ schemaVersion: 7 }, { legacyInstall: false })).toThrow(/newer app/);
  });
});
