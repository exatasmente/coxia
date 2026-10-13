// One process per workspace: a workspace named at boot runs while the registry's current one stays the desktop's choice, and the test flag
// that refuses external writes is the running workspace's, not the registry's current one.
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root = '';

beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), 'cerimonias-headless-env-'));
});
afterEach(() => vi.resetModules());

/** A data folder with the registry's current workspace "principal" (not a test) and a second one, "lab", made a test workspace. */
async function seed(): Promise<void> {
  const core = await import('../src/main/workspaces-core');
  core.ensureWorkspaces(root);
  const reg = core.createWorkspace(root, { name: 'Lab', copySettings: false });
  const lab = reg.list.find((w) => w.name === 'Lab')?.id as string;
  core.setTestFlag(root, lab, true);
  core.setTestFlag(root, reg.current, false);
}

const registry = (): string => readFileSync(join(root, 'workspaces.json'), 'utf8');

describe('bootEnv with a workspace', () => {
  it('runs the named workspace and leaves the registry as it was', async () => {
    await seed();
    const before = registry();
    const env = await import('../src/main/env');
    env.bootEnv({ dataDir: root, workspace: 'lab' });
    expect(env.workspaceId()).toBe('lab');
    expect(env.atasDir()).toBe(join(root, 'workspaces', 'lab'));
    expect(registry()).toBe(before);
    expect(JSON.parse(before).current).toBe('principal');
  });

  it('refuses an id the registry does not list, before touching anything', async () => {
    await seed();
    const before = registry();
    const folders = readdirSync(join(root, 'workspaces')).sort();
    const env = await import('../src/main/env');
    expect(() => env.bootEnv({ dataDir: root, workspace: 'ghost' })).toThrow(/ghost/);
    expect(registry()).toBe(before);
    expect(readdirSync(join(root, 'workspaces')).sort()).toEqual(folders);
  });

  it('refuses an id a fresh folder does not get either', async () => {
    const env = await import('../src/main/env');
    expect(() => env.bootEnv({ dataDir: root, workspace: 'ghost' })).toThrow(/ghost/);
  });

  it('judges the test flag by the running workspace, not by the registry current one', async () => {
    await seed();
    const env = await import('../src/main/env');
    env.bootEnv({ dataDir: root, workspace: 'lab' });
    const { externalRefusal, isTestWorkspace } = await import('../src/main/workspace');
    // The registry's current workspace is not a test one; the running one is, so the write is refused.
    expect(isTestWorkspace()).toBe(true);
    expect(externalRefusal('a push')).not.toBeNull();
  });

  it('allows the write in a running workspace that is not a test one while the current one is', async () => {
    await seed();
    const core = await import('../src/main/workspaces-core');
    core.setTestFlag(root, 'principal', true);
    core.setTestFlag(root, 'lab', false);
    const env = await import('../src/main/env');
    env.bootEnv({ dataDir: root, workspace: 'lab' });
    const { externalRefusal } = await import('../src/main/workspace');
    expect(externalRefusal('a push')).toBeNull();
  });
});
