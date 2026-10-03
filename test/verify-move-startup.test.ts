import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config/defaults';

// An install that already has a workspace with a repository and the old shared file, in a temp folder set before the app modules load:
// the first read of the config is the startup, and it has to bring the command in.
const root = mkdtempSync(join(tmpdir(), 'cerimonias-verify-startup-'));
process.env.CERIMONIAS_DATA_DIR = root;
const at = '2026-10-03T12:00:00.000Z';
const dir = join(root, 'workspaces', 'principal');
mkdirSync(dir, { recursive: true });
writeFileSync(join(root, 'workspaces.json'), JSON.stringify({ current: 'principal', list: [{ id: 'principal', name: 'Principal', createdAt: at, test: false }] }));
writeFileSync(join(root, 'config-migration.json'), JSON.stringify({ version: 1, at, existingInstall: true, legacyWorkspaces: [] }));
const config = neutralConfig();
config.projects.repos = [{ id: 'web', path: '~/work/web', remoteUrl: 'git@example.com:acme/web.git', vcsId: null, projectPath: null }];
writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
writeFileSync(join(root, 'conflict-verify.json'), JSON.stringify({ 'acme/web': 'npm test', 'acme/gone': 'make gone' }));

describe('the first read of the config at startup', () => {
  it('moves the command into the workspace, so the conflict flow finds it, and keeps what nobody owns', async () => {
    const { verifyCommandFor, verifyConfig } = await import('../src/main/conflictVerify');
    expect(verifyCommandFor('acme/web')).toBe('npm test');
    expect(verifyConfig()).toMatchObject({ projects: ['acme/web'], commands: { 'acme/web': 'npm test' }, unclaimed: { 'acme/gone': 'make gone' } });
    expect(existsSync(join(root, 'conflict-verify.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, 'conflict-verify.json.migrated'), 'utf8'))).toEqual({ 'acme/web': 'npm test', 'acme/gone': 'make gone' });
    expect((JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { projects: { verifyCommands: unknown } }).projects.verifyCommands).toEqual({ 'acme/web': 'npm test' });
  });
});
