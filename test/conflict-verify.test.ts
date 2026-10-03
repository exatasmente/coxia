import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config/defaults';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { DESKTOP_ONLY } from '../src/main/webPolicy';

// The data folder is the one test/setup.ts made for this file; the other workspace and the mirrors are created below, in temp folders.
const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { isTestWorkspace } = await import('../src/main/workspace');
const { saveConfig } = await import('../src/main/workspaceConfig');
const { register, saveVerifyCommands, verifyCommandFor, verifyCommands, verifyConfig } = await import('../src/main/conflictVerify');
const { VERIFY_FILE, VERIFY_UNCLAIMED_FILE } = await import('../src/main/verify-move');
const { createWorkspace, setTestFlag, workspaceDir } = await import('../src/main/workspaces-core');

const repo = (id: string, projectPath: string) => ({ id, path: `~/work/${id}`, remoteUrl: null, vcsId: null, projectPath });
let mirrors: string;

function configure(change: (c: WorkspaceConfig) => void): void {
  const c = neutralConfig();
  change(c);
  saveConfig(c);
}

beforeEach(() => {
  mirrors = mkdtempSync(join(tmpdir(), 'cerimonias-mirrors-'));
  rmSync(join(DATA_ROOT, VERIFY_UNCLAIMED_FILE), { force: true });
  configure(() => undefined);
});

afterEach(() => rmSync(mirrors, { recursive: true, force: true }));

describe('the conflict flow reads the active workspace', () => {
  it('has no command until the workspace has one, and a blank one is none', () => {
    expect(verifyCommandFor('acme/web')).toBeNull();
    saveVerifyCommands({ 'acme/web': '   ' });
    expect(verifyCommandFor('acme/web')).toBeNull();
    saveVerifyCommands({ 'acme/web': '  npm test  ' });
    expect(verifyCommandFor('acme/web')).toBe('npm test');
    expect(verifyCommands()).toEqual({ 'acme/web': 'npm test' });
  });

  it('is not changed by the old shared file or by another workspace', () => {
    writeFileSync(join(DATA_ROOT, VERIFY_FILE), JSON.stringify({ 'acme/web': 'from the shared file' }));
    const reg = createWorkspace(DATA_ROOT, { name: 'Other', copySettings: false }, { log: () => undefined });
    const other = reg.list[reg.list.length - 1].id;
    const c = neutralConfig();
    c.projects.verifyCommands = { 'acme/web': 'from the other workspace' };
    writeFileSync(join(workspaceDir(DATA_ROOT, other), 'config.json'), JSON.stringify(c));
    expect(verifyCommandFor('acme/web')).toBeNull();
    rmSync(join(DATA_ROOT, VERIFY_FILE));
  });

  it('is stored in the workspace config file, with the rest of the config intact', () => {
    configure((c) => { c.projects.repos = [repo('web', 'acme/web')]; c.userName = 'Ana'; });
    saveVerifyCommands({ 'acme/web': 'npm test' });
    const stored = JSON.parse(readFileSync(join(ATAS, 'config.json'), 'utf8')) as WorkspaceConfig;
    expect(stored.projects.verifyCommands).toEqual({ 'acme/web': 'npm test' });
    expect(stored.projects.repos.map((r) => r.id)).toEqual(['web']);
    expect(stored.userName).toBe('Ana');
  });
});

describe('the setter', () => {
  it('replaces the whole map, so a project left out loses its command', () => {
    saveVerifyCommands({ 'acme/web': 'a', 'acme/api': 'b' });
    saveVerifyCommands({ 'acme/web': 'a2' });
    expect(verifyCommands()).toEqual({ 'acme/web': 'a2' });
  });

  it.each([[{ '../x': 'true' }], [{ web: 'true' }], [{ 'acme/web': 'x'.repeat(2001) }], [{ 'acme/web': 'a\0b' }]])('refuses %j and keeps what was saved', (bad) => {
    saveVerifyCommands({ 'acme/web': 'keep' });
    expect(() => saveVerifyCommands(bad)).toThrow();
    expect(verifyCommands()).toEqual({ 'acme/web': 'keep' });
  });

  it('is on the desktop-only list, the read is not', () => {
    expect(DESKTOP_ONLY.has('conflicts:verify-set')).toBe(true);
    expect(DESKTOP_ONLY.has('conflicts:verify-get')).toBe(false);
  });

  it('is reached through the module handlers and answers with the fresh listing', () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    register({ handle: (name: string, fn: (...args: never[]) => unknown) => handlers.set(name, fn) } as never);
    const set = handlers.get('conflicts:verify-set') as (c: Record<string, string>) => ReturnType<typeof verifyConfig>;
    expect(set({ 'acme/web': 'npm test' })).toMatchObject({ commands: { 'acme/web': 'npm test' }, projects: ['acme/web'] });
    expect((handlers.get('conflicts:verify-get') as () => ReturnType<typeof verifyConfig>)().commands).toEqual({ 'acme/web': 'npm test' });
  });
});

describe('what the screen lists', () => {
  it('is the repositories and the release mirrors of this workspace, plus the projects that already have a command', () => {
    mkdirSync(join(mirrors, 'acme', 'tools.git'), { recursive: true });
    mkdirSync(join(mirrors, 'acme', 'notes'), { recursive: true });
    configure((c) => {
      c.projects.repos = [repo('web', 'acme/web'), { id: 'api', path: '~/work/api', remoteUrl: 'git@example.com:acme/api.git', vcsId: null, projectPath: null }, repo('local', 'local')];
      c.externalTools.releaseSync = { enabled: true, command: '/bin/true', cwd: null, mirrorsDir: mirrors };
      c.projects.verifyCommands = { 'acme/removed': 'make' };
    });
    expect(verifyConfig().projects).toEqual(['acme/api', 'acme/removed', 'acme/tools', 'acme/web']);
  });

  it('lists no mirror while the release tool is off, and nothing from a workspace with no repositories', () => {
    mkdirSync(join(mirrors, 'acme', 'tools.git'), { recursive: true });
    configure((c) => { c.externalTools.releaseSync = { enabled: false, command: '/bin/true', cwd: null, mirrorsDir: mirrors }; });
    expect(verifyConfig()).toMatchObject({ projects: [], commands: {}, unclaimed: {} });
  });

  it('does not list a project another workspace has a command for', () => {
    writeFileSync(join(DATA_ROOT, VERIFY_FILE), JSON.stringify({ 'acme/elsewhere': 'x' }));
    expect(verifyConfig().projects).toEqual([]);
    rmSync(join(DATA_ROOT, VERIFY_FILE));
  });

  it('offers the unclaimed commands, minus those this workspace has a command for now', () => {
    writeFileSync(join(DATA_ROOT, VERIFY_UNCLAIMED_FILE), JSON.stringify({ 'acme/gone': 'make gone', 'acme/adopted': 'make adopted' }));
    expect(verifyConfig().unclaimed).toEqual({ 'acme/gone': 'make gone', 'acme/adopted': 'make adopted' });
    saveVerifyCommands({ 'acme/adopted': 'make adopted' });
    expect(verifyConfig().unclaimed).toEqual({ 'acme/gone': 'make gone' });
    expect(existsSync(join(DATA_ROOT, VERIFY_UNCLAIMED_FILE))).toBe(true);
  });

  it('keeps a test workspace as it was: reading, writing and the lookup do not look at the flag', () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    try {
      expect(isTestWorkspace()).toBe(true);
      saveVerifyCommands({ 'acme/web': 'npm test' });
      expect(verifyCommandFor('acme/web')).toBe('npm test');
      expect(verifyConfig().commands).toEqual({ 'acme/web': 'npm test' });
    } finally {
      setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    }
  });
});
