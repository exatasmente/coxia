// The data folder is given at boot. Two boots against two folders, each in a fresh set of modules, write only in their own folder, and a
// process booted once refuses another folder.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fresh = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-boot-'));

afterEach(() => vi.resetModules());

async function bootAndWrite(dir: string): Promise<string> {
  vi.resetModules();
  const env = await import('../src/main/env');
  env.bootEnv({ dataDir: dir });
  const { recordWrite } = await import('../src/main/auditoria');
  recordWrite({ kind: 'test-env', issue: 0, target: 'test-env:boot', via: 'config', fields: { ref: 'boot' }, ok: true, code: null, result: 'revoked', origin: { actionId: '', kind: 'test-env-confirm', key: 'boot', summary: null }, by: null });
  return env.atasDir();
}

describe('the data folder given at boot', () => {
  it('is where each boot writes, and nowhere else', async () => {
    const a = fresh();
    const b = fresh();
    const atasA = await bootAndWrite(a);
    expect(atasA.startsWith(a)).toBe(true);
    expect(existsSync(join(atasA, 'auditoria.jsonl'))).toBe(true);
    const before = readdirSync(a, { recursive: true }).sort();
    expect(readdirSync(b)).toEqual([]);

    const atasB = await bootAndWrite(b);
    expect(atasB.startsWith(b)).toBe(true);
    expect(existsSync(join(atasB, 'auditoria.jsonl'))).toBe(true);
    // The first folder is as the first boot left it.
    expect(readdirSync(a, { recursive: true }).sort()).toEqual(before);
  });

  it('wins over CERIMONIAS_DATA_DIR, and a second folder in the same process is refused', async () => {
    const given = fresh();
    const fromEnv = process.env.CERIMONIAS_DATA_DIR as string;
    vi.resetModules();
    const env = await import('../src/main/env');
    env.bootEnv({ dataDir: given });
    expect(env.dataRoot()).toBe(given);
    expect(existsSync(join(given, 'workspaces.json'))).toBe(true);
    expect(() => env.bootEnv({ dataDir: given })).not.toThrow();
    expect(() => env.bootEnv({ dataDir: fresh() })).toThrow(/already/);
    expect(env.dataRoot()).not.toBe(fromEnv);
  });

  it('is the default folder at the first read when the process never booted, never at import', async () => {
    const dir = fresh();
    process.env.CERIMONIAS_DATA_DIR = dir;
    vi.resetModules();
    const env = await import('../src/main/env');
    expect(readdirSync(dir)).toEqual([]);
    expect(env.dataRoot()).toBe(dir);
    expect(existsSync(join(dir, 'workspaces.json'))).toBe(true);
  });
});
