import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config/defaults';
import { validateConfig } from '../src/shared/config/validate';
import { VERIFY_COMMAND_MAX } from '../src/shared/verifyCommands';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { CONFIG_FILE, bootstrapConfigs, readConfigFile, writeConfigFile } from '../src/main/config-bootstrap';
import { VERIFY_BACKUP_FILE, VERIFY_FILE, VERIFY_UNCLAIMED_FILE, moveVerifyCommands, readUnclaimed, type MoveDeps } from '../src/main/verify-move';
import { createWorkspace, ensureWorkspaces, workspaceDir } from '../src/main/workspaces-core';

// Every root is a fresh temporary folder: nothing here reads or writes the real data folder.

let root: string;
let logs: string[];
const at = new Date('2026-10-03T12:00:00Z');
const quiet = { log: () => undefined, now: () => at };

const repo = (id: string, projectPath: string) => ({ id, path: `~/work/${id}`, remoteUrl: null, vcsId: null, projectPath });
const deps = (over: Partial<MoveDeps> = {}): MoveDeps => ({ root, home: '/home/ana', now: () => at, log: (m) => logs.push(m), ...over });
const writeOld = (commands: Record<string, unknown>) => writeFileSync(join(root, VERIFY_FILE), JSON.stringify(commands, null, 2));
const commandsOf = (id: string): Record<string, string> => (readConfigFile(workspaceDir(root, id)) as WorkspaceConfig).projects.verifyCommands;
const configBytes = (id: string): string => readFileSync(join(workspaceDir(root, id), CONFIG_FILE), 'utf8');

function setConfig(id: string, change: (c: WorkspaceConfig) => void): void {
  const c = neutralConfig();
  change(c);
  writeConfigFile(workspaceDir(root, id), c);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cerimonias-verify-move-'));
  logs = [];
  ensureWorkspaces(root, quiet);
  createWorkspace(root, { name: 'Second', copySettings: false }, quiet);
  bootstrapConfigs({ root, existingInstall: false, ...quiet });
});

describe('moving the old shared file into the workspaces', () => {
  it('does nothing when there is no old file', () => {
    expect(moveVerifyCommands(deps())).toMatchObject({ status: 'none', copied: {}, unclaimed: [], deferred: [] });
    expect(existsSync(join(root, VERIFY_BACKUP_FILE))).toBe(false);
  });

  it('gives each command to the workspace that owns the project, and only to it', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    setConfig('second', (c) => { c.projects.repos = [repo('api', 'acme/api')]; });
    writeOld({ 'acme/web': 'npm test', 'acme/api': 'make check' });
    const r = moveVerifyCommands(deps());
    expect(r.status).toBe('moved');
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'npm test' });
    expect(commandsOf('second')).toEqual({ 'acme/api': 'make check' });
    expect(r.copied).toEqual({ principal: ['acme/web'], second: ['acme/api'] });
    expect(r.unclaimed).toEqual([]);
  });

  it('takes the project of a repo from its remote when it has no explicit path', () => {
    setConfig('principal', (c) => { c.projects.repos = [{ id: 'web', path: '~/work/web', remoteUrl: 'git@example.com:acme/sub/web.git', vcsId: null, projectPath: null }]; });
    writeOld({ 'acme/sub/web': 'npm test' });
    moveVerifyCommands(deps());
    expect(commandsOf('principal')).toEqual({ 'acme/sub/web': 'npm test' });
  });

  it('copies a command into every workspace that owns the project', () => {
    for (const id of ['principal', 'second']) setConfig(id, (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    writeOld({ 'acme/web': 'npm test' });
    expect(moveVerifyCommands(deps()).copied).toEqual({ principal: ['acme/web'], second: ['acme/web'] });
    expect(commandsOf('principal')).toEqual(commandsOf('second'));
  });

  it('claims the projects of the release mirrors of a workspace that has the release tool on', () => {
    const seen: string[] = [];
    setConfig('principal', (c) => { c.externalTools.releaseSync = { enabled: true, command: '~/bin/sync', cwd: null, mirrorsDir: '~/mirrors' }; });
    setConfig('second', (c) => { c.externalTools.releaseSync = { enabled: false, command: '~/bin/sync', cwd: null, mirrorsDir: '~/mirrors' }; });
    writeOld({ 'acme/tools': 'make' });
    moveVerifyCommands(deps({ mirrors: (dir) => { seen.push(dir); return ['acme/tools']; } }));
    expect(seen).toEqual(['/home/ana/mirrors']);
    expect(commandsOf('principal')).toEqual({ 'acme/tools': 'make' });
    expect(commandsOf('second')).toEqual({});
  });

  it('never replaces a command the workspace already has', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web'), repo('api', 'acme/api')]; c.projects.verifyCommands = { 'acme/web': 'mine' }; });
    writeOld({ 'acme/web': 'old', 'acme/api': 'old api' });
    moveVerifyCommands(deps());
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'mine', 'acme/api': 'old api' });
  });

  it('ignores blank and non-string entries and trims the commands', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web'), repo('api', 'acme/api'), repo('ui', 'acme/ui')]; });
    writeOld({ 'acme/web': '  npm test  ', 'acme/api': '   ', 'acme/ui': 7 });
    moveVerifyCommands(deps());
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'npm test' });
  });

  it('keeps the commands nobody owns: the backup, a sidecar and the log, never a deletion', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    writeOld({ 'acme/web': 'npm test', 'acme/gone': 'make gone', '../bad': 'true' });
    const original = readFileSync(join(root, VERIFY_FILE), 'utf8');
    const r = moveVerifyCommands(deps());
    expect(r.unclaimed).toEqual(['../bad', 'acme/gone']);
    expect(readUnclaimed(root)).toEqual({ 'acme/gone': 'make gone', '../bad': 'true' });
    expect(existsSync(join(root, VERIFY_FILE))).toBe(false);
    expect(readFileSync(join(root, VERIFY_BACKUP_FILE), 'utf8')).toBe(original);
    expect(logs.join('\n')).toContain('acme/gone');
    expect(logs.join('\n')).not.toContain('make gone');
    expect(readFileSync(join(root, 'workspaces', 'migration.log'), 'utf8')).toContain(VERIFY_UNCLAIMED_FILE);
    expect(readdirSync(root).filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('adds to an earlier sidecar instead of replacing it', () => {
    writeFileSync(join(root, VERIFY_UNCLAIMED_FILE), JSON.stringify({ 'acme/older': 'make older' }));
    writeOld({ 'acme/gone': 'make gone' });
    moveVerifyCommands(deps());
    expect(readUnclaimed(root)).toEqual({ 'acme/older': 'make older', 'acme/gone': 'make gone' });
  });

  it('keeps the command already in the sidecar for a project and says a later one was not used', () => {
    writeOld({ 'acme/gone': 'second', 'acme/same': 'x' });
    writeFileSync(join(root, VERIFY_UNCLAIMED_FILE), JSON.stringify({ 'acme/gone': 'first', 'acme/same': 'x' }));
    moveVerifyCommands(deps());
    expect(readUnclaimed(root)).toEqual({ 'acme/gone': 'first', 'acme/same': 'x' });
    expect(logs.filter((l) => l.includes('already has a command for acme/gone'))).toHaveLength(1);
    expect(logs.some((l) => l.includes('acme/same: kept'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, VERIFY_BACKUP_FILE), 'utf8'))['acme/gone']).toBe('second');
  });

  it('sends a value the schema refuses to the unclaimed ones and leaves the workspace config valid, with its own command intact', () => {
    setConfig('principal', (c) => {
      c.projects.repos = [repo('web', 'acme/web'), repo('api', 'acme/api'), repo('ui', 'acme/ui'), repo('ok', 'acme/ok')];
      c.projects.verifyCommands = { 'acme/web': 'mine' };
    });
    writeOld({ 'acme/api': 'x'.repeat(VERIFY_COMMAND_MAX + 1), 'acme/ui': 'a\0b', 'acme/ok': 'x'.repeat(VERIFY_COMMAND_MAX) });
    const r = moveVerifyCommands(deps());
    expect(r.status).toBe('moved');
    expect(r.unclaimed).toEqual(['acme/api', 'acme/ui']);
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'mine', 'acme/ok': 'x'.repeat(VERIFY_COMMAND_MAX) });
    expect(validateConfig(readConfigFile(workspaceDir(root, 'principal'))).ok).toBe(true);
    expect(readUnclaimed(root)).toMatchObject({ 'acme/ui': 'a\0b' });
  });

  it('is safe to run twice: the second run finds nothing and changes nothing', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    writeOld({ 'acme/web': 'npm test', 'acme/gone': 'make gone' });
    expect(moveVerifyCommands(deps()).status).toBe('moved');
    const before = [configBytes('principal'), configBytes('second'), readFileSync(join(root, VERIFY_UNCLAIMED_FILE), 'utf8')];
    expect(moveVerifyCommands(deps()).status).toBe('none');
    expect([configBytes('principal'), configBytes('second'), readFileSync(join(root, VERIFY_UNCLAIMED_FILE), 'utf8')]).toEqual(before);
  });

  it('does not overwrite a backup that exists: a file put back by hand is migrated again under its own name', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    writeOld({ 'acme/web': 'first' });
    moveVerifyCommands(deps());
    writeOld({ 'acme/web': 'second', 'acme/other': 'x' });
    const r = moveVerifyCommands(deps());
    expect(r.backup).not.toBe(join(root, VERIFY_BACKUP_FILE));
    expect(JSON.parse(readFileSync(join(root, VERIFY_BACKUP_FILE), 'utf8'))).toEqual({ 'acme/web': 'first' });
    expect(JSON.parse(readFileSync(r.backup as string, 'utf8'))).toEqual({ 'acme/web': 'second', 'acme/other': 'x' });
    // the first run's value stays: a command already in the workspace is never replaced
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'first' });
  });
});

describe('when something cannot be moved', () => {
  it('leaves a workspace with an invalid config untouched, keeps the file, and finishes at the next start', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    writeFileSync(join(workspaceDir(root, 'second'), CONFIG_FILE), JSON.stringify({ ...neutralConfig(), language: 'fr' }));
    const broken = configBytes('second');
    writeOld({ 'acme/web': 'npm test', 'acme/api': 'make check' });

    const first = moveVerifyCommands(deps());
    expect(first).toMatchObject({ status: 'deferred', deferred: ['second'] });
    expect(configBytes('second')).toBe(broken);
    expect(existsSync(join(root, VERIFY_FILE))).toBe(true);
    expect(existsSync(join(root, VERIFY_BACKUP_FILE))).toBe(false);
    expect(existsSync(join(root, VERIFY_UNCLAIMED_FILE))).toBe(false);
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'npm test' });

    setConfig('second', (c) => { c.projects.repos = [repo('api', 'acme/api')]; });
    const second = moveVerifyCommands(deps());
    expect(second.status).toBe('moved');
    expect(commandsOf('second')).toEqual({ 'acme/api': 'make check' });
    expect(commandsOf('principal')).toEqual({ 'acme/web': 'npm test' });
    expect(existsSync(join(root, VERIFY_UNCLAIMED_FILE))).toBe(false);
  });

  it('does not block on a workspace folder that has no config yet', () => {
    const folder = join(root, 'workspaces', 'empty');
    mkdirSync(folder, { recursive: true });
    const reg = JSON.parse(readFileSync(join(root, 'workspaces.json'), 'utf8'));
    reg.list.push({ id: 'empty', name: 'Empty', createdAt: at.toISOString(), test: false });
    writeFileSync(join(root, 'workspaces.json'), JSON.stringify(reg));
    writeOld({ 'acme/gone': 'x' });
    expect(moveVerifyCommands(deps()).status).toBe('moved');
  });

  it('treats a config.json that is not JSON as invalid, not as empty', () => {
    writeFileSync(join(workspaceDir(root, 'second'), CONFIG_FILE), '{ not json');
    writeOld({ 'acme/gone': 'x' });
    expect(moveVerifyCommands(deps())).toMatchObject({ status: 'deferred', deferred: ['second'] });
    expect(readFileSync(join(workspaceDir(root, 'second'), CONFIG_FILE), 'utf8')).toBe('{ not json');
  });

  it('keeps the bytes of an old file that is not a JSON object and moves on', () => {
    writeFileSync(join(root, VERIFY_FILE), '{ broken');
    const r = moveVerifyCommands(deps());
    expect(r.status).toBe('unusable');
    expect(existsSync(join(root, VERIFY_FILE))).toBe(false);
    expect(readFileSync(r.backup as string, 'utf8')).toBe('{ broken');
    writeFileSync(join(root, VERIFY_FILE), '["a"]');
    expect(moveVerifyCommands(deps()).status).toBe('unusable');
  });

  it('waits, keeping the file, when the old file cannot be read', () => {
    mkdirSync(join(root, VERIFY_FILE));
    const r = moveVerifyCommands(deps());
    expect(r.status).toBe('deferred');
    expect(existsSync(join(root, VERIFY_FILE))).toBe(true);
    expect(existsSync(join(root, VERIFY_BACKUP_FILE))).toBe(false);
    expect(logs.join('\n')).toContain('cannot be read');
  });

  it('waits when the workspaces registry cannot be read', () => {
    writeFileSync(join(root, 'workspaces.json'), '{ nope');
    writeOld({ 'acme/web': 'npm test' });
    expect(moveVerifyCommands(deps()).status).toBe('deferred');
    expect(existsSync(join(root, VERIFY_FILE))).toBe(true);
  });

  it('does not throw when a config cannot be written, and keeps the file', () => {
    setConfig('principal', (c) => { c.projects.repos = [repo('web', 'acme/web')]; });
    writeOld({ 'acme/web': 'npm test' });
    // a directory where the config tmp file goes makes the write fail
    mkdirSync(join(workspaceDir(root, 'principal'), `${CONFIG_FILE}.tmp-${process.pid}`));
    const r = moveVerifyCommands(deps());
    expect(r.status).toBe('deferred');
    expect(r.deferred).toEqual(['principal']);
    expect(existsSync(join(root, VERIFY_FILE))).toBe(true);
  });
});

describe('the unclaimed sidecar', () => {
  it('reads nothing from a missing or malformed file', () => {
    expect(readUnclaimed(root)).toEqual({});
    writeFileSync(join(root, VERIFY_UNCLAIMED_FILE), '[1]');
    expect(readUnclaimed(root)).toEqual({});
    writeFileSync(join(root, VERIFY_UNCLAIMED_FILE), '{ nope');
    expect(readUnclaimed(root)).toEqual({});
  });
});
