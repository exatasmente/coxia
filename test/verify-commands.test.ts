import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config/defaults';
import { migrateConfig } from '../src/shared/config/migrations';
import { CONFIG_SCHEMA } from '../src/shared/config/schema';
import { collectCommands, parseImport, buildExport } from '../src/shared/config/transfer';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';
import { validateConfig } from '../src/shared/config/validate';
import { VERIFY_COMMAND_MAX, activeVerifyCommands, isVerifyProject, ownVerifyProjects, repoProjectPath } from '../src/shared/verifyCommands';

const repo = (over: Partial<{ projectPath: string | null; remoteUrl: string | null }>) => ({ projectPath: null, remoteUrl: null, ...over });

describe('the project key', () => {
  it.each([['acme/web'], ['acme/sub/web'], ['a.b/c_d-e'], ['Acme/Web']])('accepts %s', (key) => expect(isVerifyProject(key)).toBe(true));
  it.each([['web'], ['../x'], ['acme/../web'], ['acme/'], ['/acme/web'], ['acme/we b'], [''], ['acme\\web']])('refuses %j', (key) => expect(isVerifyProject(key)).toBe(false));
});

describe('the project of a repository', () => {
  it('is the explicit path when there is one, trimmed and without .git', () => {
    expect(repoProjectPath(repo({ projectPath: ' acme/web.git ', remoteUrl: 'git@example.com:other/thing.git' }))).toBe('acme/web');
  });

  it.each([
    ['git@example.com:acme/web.git', 'acme/web'],
    ['ssh://git@example.com/acme/sub/web.git', 'acme/sub/web'],
    ['https://example.com/acme/web', 'acme/web'],
    ['https://example.com/acme/web/', 'acme/web'],
  ])('is derived from the remote %s', (remoteUrl, expected) => {
    expect(repoProjectPath(repo({ remoteUrl }))).toBe(expected);
  });

  it('is null for a repo with no usable remote', () => {
    expect(repoProjectPath(repo({}))).toBeNull();
    expect(repoProjectPath(repo({ remoteUrl: '/srv/git/web.git' }))).toBeNull();
    expect(repoProjectPath(repo({ projectPath: 'web' }))).toBeNull();
  });
});

describe('what a workspace owns', () => {
  it('is its repositories plus the mirrors, once each and sorted', () => {
    const c = neutralConfig();
    c.projects.repos = [
      { id: 'web', path: '~/w', remoteUrl: 'git@example.com:acme/web.git', vcsId: null, projectPath: null },
      { id: 'api', path: '~/a', remoteUrl: null, vcsId: null, projectPath: 'acme/api' },
      { id: 'local', path: '~/l', remoteUrl: null, vcsId: null, projectPath: null },
    ];
    expect(ownVerifyProjects(c, ['acme/web', 'acme/tools', 'not-a-project'])).toEqual(['acme/api', 'acme/tools', 'acme/web']);
  });

  it('drops blank commands and trims the others', () => {
    const c = neutralConfig();
    c.projects.verifyCommands = { 'acme/web': '  npm test  ', 'acme/api': '   ' };
    expect(activeVerifyCommands(c)).toEqual({ 'acme/web': 'npm test' });
  });
});

describe('the field in the config', () => {
  it('has an empty default and is part of the schema', () => {
    expect(neutralConfig().projects.verifyCommands).toEqual({});
    expect(CONFIG_SCHEMA.properties?.projects.properties?.verifyCommands).toBeDefined();
  });

  it('is filled in by the defaults when a current file does not have it', () => {
    const doc = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    delete doc.projects.verifyCommands;
    const r = validateConfig(doc);
    expect(r.ok).toBe(true);
    expect(r.config?.projects.verifyCommands).toEqual({});
  });

  it('accepts commands and refuses a bad key, a NUL, a long value and a non-string', () => {
    const ok = neutralConfig();
    ok.projects.verifyCommands = { 'acme/web': 'npm test', 'acme/sub/api': 'make check' };
    expect(validateConfig(ok).errors).toEqual([]);

    const badKey = neutralConfig();
    badKey.projects.verifyCommands = { '../x': 'true' };
    expect(validateConfig(badKey).errors).toEqual([{ path: 'projects.verifyCommands', message: expect.stringContaining('not a project path') }]);

    const nul = neutralConfig();
    nul.projects.verifyCommands = { 'acme/web': 'a\0b' };
    expect(validateConfig(nul).errors.map((e) => e.path)).toEqual(['projects.verifyCommands.acme/web']);

    const long = neutralConfig();
    long.projects.verifyCommands = { 'acme/web': 'x'.repeat(VERIFY_COMMAND_MAX + 1) };
    expect(validateConfig(long).errors.map((e) => e.path)).toEqual(['projects.verifyCommands.acme/web']);

    const notString = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    notString.projects.verifyCommands = { 'acme/web': 5 };
    expect(validateConfig(notString).ok).toBe(false);
  });
});

describe('migration v10 to v11', () => {
  const v10 = (): Record<string, any> => {
    const doc = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    delete doc.projects.verifyCommands;
    doc.projects.repos = [{ id: 'web', path: '~/w', remoteUrl: null, vcsId: null, projectPath: 'acme/web' }];
    return { ...doc, schemaVersion: 10 };
  };

  it('adds the empty map and keeps the rest of the projects block', () => {
    const r = migrateConfig(v10(), { legacyInstall: false });
    expect(r.fromVersion).toBe(10);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.projects.verifyCommands).toEqual({});
    expect(r.config.projects.repos.map((x) => x.id)).toEqual(['web']);
  });

  it('is idempotent and keeps a map that is already there', () => {
    const doc = v10();
    doc.projects.verifyCommands = { 'acme/web': 'npm test' };
    const once = migrateConfig(doc, { legacyInstall: false });
    expect(once.config.projects.verifyCommands).toEqual({ 'acme/web': 'npm test' });
    const twice = migrateConfig(once.config, { legacyInstall: false });
    expect(twice.changed).toBe(false);
    expect(twice.config).toEqual(once.config);
  });

  it('gives a file with no projects the version and the defaults', () => {
    const r = migrateConfig({ schemaVersion: 10, language: 'en' }, { legacyInstall: false });
    expect(r.config.language).toBe('en');
    expect(r.config.projects.verifyCommands).toEqual({});
  });

  it('repairs a bad key by resetting only the commands, not the repos', () => {
    const doc = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    doc.projects.repos = [{ id: 'web', path: '~/w', remoteUrl: null, vcsId: null, projectPath: 'acme/web' }];
    doc.projects.verifyCommands = { 'acme/web': 'npm test', '../x': 'true' };
    const r = migrateConfig(doc, { legacyInstall: false });
    expect(r.config.projects.verifyCommands).toEqual({});
    expect(r.config.projects.repos.map((x) => x.id)).toEqual(['web']);
    expect(r.notes.some((n) => n.startsWith('reset projects.verifyCommands'))).toBe(true);
  });
});

describe('export and import', () => {
  const withCommands = () => {
    const c = neutralConfig();
    c.projects.verifyCommands = { 'acme/web': 'npm test -- --token', 'acme/api': '   ' };
    return c;
  };

  it('lists a verification command among the programs the file would run, and not a blank one', () => {
    expect(collectCommands(withCommands()).filter((c) => c.field.startsWith('projects.'))).toEqual([{ field: 'projects.verifyCommands[acme/web]', command: 'npm test -- --token' }]);
  });

  it('round-trips through an export file', () => {
    const file = buildExport(withCommands(), { workspaceName: 'Acme', appVersion: '1.0.0', now: new Date('2026-10-03T12:00:00Z') });
    const parsed = parseImport(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    expect(parsed.config?.projects.verifyCommands['acme/web']).toBe('npm test -- --token');
  });

  it('migrates a v10 export and refuses a bad key in the file', () => {
    const doc = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    delete doc.projects.verifyCommands;
    expect(parseImport(JSON.stringify({ ...doc, schemaVersion: 10 })).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(withCommands())) as Record<string, any>;
    bad.projects.verifyCommands = { 'no-slash': 'true' };
    const r = parseImport(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe('projects.verifyCommands');
  });
});
