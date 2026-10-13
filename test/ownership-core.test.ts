// The core with a workspace that another instance owns (#209): it serves, but it runs nothing and writes nothing outside the machine.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorCodeOf } from '../src/shared/contract';
import { webAccess } from '../src/main/webPolicy';

vi.setConfig({ testTimeout: 60_000 });

let dataDir = '';
beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(join(tmpdir(), 'cerimonias-owner-core-'));
});

const load = async () => ({ ...(await import('../src/main/core')), env: await import('../src/main/env'), rpc: await import('../src/main/rpc'), workspace: await import('../src/main/workspace') });

const foreign = (expiresInMs: number, extra: Record<string, unknown> = {}) => ({
  instanceId: 'ffffffff-0000-4000-8000-000000000000',
  host: 'other-machine',
  pid: 4242,
  startedAt: new Date().toISOString(),
  renewedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  ...extra,
});

const plant = (dir: string, lease: unknown): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'owner.json'), JSON.stringify(lease));
};

describe('a core on a workspace another instance owns', () => {
  it('is a client: it names the owner, runs no scheduler, and refuses an external write with not-owner', async () => {
    const { createCoxia, env, rpc, workspace } = await load();
    const core = createCoxia({ dataDir });
    plant(env.atasDir(), foreign(60_000));
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    await core.start();
    try {
      expect(core.ownership()).toMatchObject({ role: 'client', owner: { host: 'other-machine', pid: 4242 }, expired: false });
      // No scheduler timers and no runner resume timer: nothing is started for the workspace.
      expect(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length).toBe(before);
      expect(await rpc.invokeAdmin('ownership:status', [])).toMatchObject({ role: 'client', owner: { host: 'other-machine' } });
      // The channels answer: a client is a viewer.
      expect(rpc.hasChannel('runs:list')).toBe(true);

      let refused: unknown;
      try {
        workspace.assertExternalWrite('a push');
      } catch (e) {
        refused = e;
      }
      expect(errorCodeOf(refused)).toBe('not-owner');
      expect((refused as Error).message).toContain('other-machine');
      // The lease of the owner is untouched.
      expect(JSON.parse(readFileSync(join(env.atasDir(), 'owner.json'), 'utf8')).instanceId).toBe('ffffffff-0000-4000-8000-000000000000');
    } finally {
      await core.stop({ deadlineMs: 500 });
    }
    expect(JSON.parse(readFileSync(join(env.atasDir(), 'owner.json'), 'utf8')).instanceId).toBe('ffffffff-0000-4000-8000-000000000000');
  });

  it('takes an expired lease over through the claim channel, audited', async () => {
    const { createCoxia, env, rpc } = await load();
    const core = createCoxia({ dataDir });
    plant(env.atasDir(), foreign(-5_000));
    await core.start();
    try {
      expect(core.ownership()).toMatchObject({ role: 'client', expired: true });
      expect(await rpc.invokeAdmin('ownership:claim', [])).toMatchObject({ role: 'owner' });
      expect(core.ownership()?.role).toBe('owner');
      const log = readFileSync(join(env.atasDir(), 'auditoria.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; target: string; fields: Record<string, string> });
      expect(log.filter((l) => l.kind === 'ownership').map((l) => l.target)).toEqual(['ownership takeover']);
      expect(log.find((l) => l.kind === 'ownership')?.fields.fromHost).toBe('other-machine');
    } finally {
      await core.stop({ deadlineMs: 500 });
    }
  });

  it('owns a free workspace, and releases the lease on a clean stop', async () => {
    const { createCoxia, env } = await load();
    const core = createCoxia({ dataDir });
    await core.start();
    expect(core.ownership()).toMatchObject({ role: 'owner' });
    expect(JSON.parse(readFileSync(join(env.atasDir(), 'owner.json'), 'utf8')).instanceId).toBe(core.ownership()?.self.split(':')[0]);
    await core.stop({ deadlineMs: 500 });
    expect(() => readFileSync(join(env.atasDir(), 'owner.json'))).toThrow();
  });
});

describe('the web policy of the ownership channels', () => {
  it('lets a paired browser read the status and nothing else', () => {
    expect(webAccess('ownership:status')).toBe('allow');
    expect(webAccess('ownership:claim')).toBe('deny');
    expect(webAccess('ownership:release')).toBe('deny');
    expect(webAccess('ownership:anything-later')).toBe('deny');
  });
});
