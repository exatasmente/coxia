// Moving a workspace out (#309): the owner steps down for good, the lease says where it went, a restart stays a client, and only the move back (an admin claim of the same
// instance, never a paired browser) returns it.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorCodeOf } from '../src/shared/contract';
import { type Lease, type OwnershipHooks, createOwnership } from '../src/main/ownership';
import { webAccess } from '../src/main/webPolicy';

vi.setConfig({ testTimeout: 30_000 });

const folder = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-move-'));
const leaseOf = (dir: string): Lease => JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')) as Lease;

function hooks(over: Partial<OwnershipHooks> = {}): OwnershipHooks & { log: string[] } {
  const log: string[] = [];
  return { log, pause: async () => void log.push('pause'), resume: () => void log.push('resume'), health: async () => true, ...over };
}

const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
function instance(dir: string, pid: number, h: OwnershipHooks = hooks(), audit?: (e: { target: string; fields: Record<string, string>; ok: boolean }) => void, id = 'same-id') {
  return createOwnership({ dir, instanceId: id, hooks: h, now: () => new Date(clock.t), host: 'machine-a', pid, alive: () => false, audit: audit as never, timings: { tick: 1_000_000 } });
}

describe('ownership:move-out', () => {
  it('pauses the work, writes movedOut in the lease and answers the status', async () => {
    const dir = folder();
    const h = hooks();
    const audit: { target: string; fields: Record<string, string>; ok: boolean }[] = [];
    const a = instance(dir, 100, h, (e) => audit.push(e));
    a.acquire();
    const status = await a.moveOut('vps:example:42', { by: 'admin' });
    expect(h.log).toEqual(['pause']);
    expect(status).toMatchObject({ role: 'client', movedOut: { to: 'vps:example:42' }, expired: false });
    expect(leaseOf(dir).movedOut?.to).toBe('vps:example:42');
    expect(a.running()).toBe(false);
    expect(() => a.require()).toThrow();
    expect(audit.map((e) => e.target)).toEqual(['ownership move-out']);
    expect(audit[0].fields.to).toBe('vps:example:42');
    a.stop();
    // The lease of a client is not removed by a stop: the move stays on disk.
    expect(leaseOf(dir).movedOut?.to).toBe('vps:example:42');
  });

  it('is idempotent for the same target and refuses another one', async () => {
    const dir = folder();
    const h = hooks();
    const a = instance(dir, 100, h);
    a.acquire();
    await a.moveOut('vps:example:42');
    expect(await a.moveOut('vps:example:42')).toMatchObject({ movedOut: { to: 'vps:example:42' } });
    expect(h.log).toEqual(['pause']);
    await expect(a.moveOut('vps:example:43')).rejects.toMatchObject({ code: 'conflict' });
    a.stop();
  });

  it('refuses with not-owner on a client, and with invalid-input on a bad target', async () => {
    const dir = folder();
    const a = instance(dir, 100);
    a.acquire();
    const b = instance(dir, 200, hooks(), undefined, 'other-id');
    b.acquire();
    await expect(b.moveOut('vps:x')).rejects.toMatchObject({ code: 'not-owner' });
    for (const bad of ['', '   ', 'x'.repeat(201)]) await expect(a.moveOut(bad)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(a.running()).toBe(true);
    a.stop();
    b.stop();
  });

  it('keeps the owner when the pause fails', async () => {
    const dir = folder();
    const h = hooks({ pause: async () => Promise.reject(new Error('stage would not stop')) });
    const a = instance(dir, 100, h);
    a.acquire();
    await expect(a.moveOut('vps:x')).rejects.toThrow('stage would not stop');
    expect(a.running()).toBe(true);
    expect(leaseOf(dir).movedOut).toBeUndefined();
    a.stop();
  });

  it('stays a client after a restart, even when the lease is long past its life', async () => {
    const dir = folder();
    const a = instance(dir, 100);
    a.acquire();
    await a.moveOut('vps:example:42');
    a.stop();
    clock.t += 24 * 3_600_000;
    const restarted = instance(dir, 300);
    expect(restarted.acquire()).toMatchObject({ role: 'client', expired: false, movedOut: { to: 'vps:example:42' } });
    expect(restarted.running()).toBe(false);
    restarted.stop();
    expect(leaseOf(dir).movedOut?.to).toBe('vps:example:42');
  });

  it('is not taken over by another instance, even by an admin', async () => {
    const dir = folder();
    const a = instance(dir, 100);
    a.acquire();
    await a.moveOut('vps:x');
    clock.t += 24 * 3_600_000;
    const other = instance(dir, 500, hooks(), undefined, 'other-id');
    expect(other.acquire()).toMatchObject({ role: 'client' });
    await expect(other.claim({ admin: true })).rejects.toMatchObject({ code: 'forbidden' });
    a.stop();
    other.stop();
  });
});

describe('the move back', () => {
  it('is an admin claim by the same instance: it resumes, clears movedOut and is audited as move-back', async () => {
    const dir = folder();
    const audit: { target: string; fields: Record<string, string>; ok: boolean }[] = [];
    const a = instance(dir, 100, hooks(), (e) => audit.push(e));
    a.acquire();
    await a.moveOut('vps:example:42');
    a.stop();
    const h = hooks();
    const restarted = instance(dir, 300, h, (e) => audit.push(e));
    restarted.acquire();
    const back = await restarted.claim({ admin: true, by: 'admin' });
    expect(back).toMatchObject({ role: 'owner', movedOut: null });
    expect(h.log).toEqual(['resume']);
    expect(leaseOf(dir).movedOut).toBeUndefined();
    const last = audit.at(-1);
    expect(last?.target).toBe('ownership move-back');
    expect(last?.fields.movedTo).toBe('vps:example:42');
    restarted.stop();
  });

  it('is refused without admin and to a paired browser, and the workspace stays moved out', async () => {
    const dir = folder();
    const a = instance(dir, 100);
    a.acquire();
    await a.moveOut('vps:x');
    for (const by of ['paired', 'persona']) await expect(a.claim({ admin: true, by })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(a.claim({ admin: false })).rejects.toMatchObject({ code: 'forbidden' });
    expect(leaseOf(dir).movedOut?.to).toBe('vps:x');
    a.stop();
  });

  it('puts the moved-out lease back when the health check fails', async () => {
    const dir = folder();
    const a = instance(dir, 100, hooks({ health: async () => false }));
    a.acquire();
    await a.moveOut('vps:x');
    await expect(a.claim({ admin: true })).rejects.toMatchObject({ code: 'conflict' });
    expect(leaseOf(dir).movedOut?.to).toBe('vps:x');
    expect(a.status().role).toBe('client');
    a.stop();
  });
});

describe('who may call the channel', () => {
  it('is never a paired browser, an admin device included', () => {
    expect(webAccess('ownership:move-out', false)).toBe('deny');
    expect(webAccess('ownership:move-out', true)).toBe('deny');
    expect(errorCodeOf(new Error('x'))).toBe('internal');
  });
});

describe('the core', () => {
  let dataDir = '';
  beforeEach(() => {
    vi.resetModules();
    dataDir = mkdtempSync(join(tmpdir(), 'cerimonias-move-core-'));
  });
  const load = async () => ({ ...(await import('../src/main/core')), rpc: await import('../src/main/rpc') });

  it('keeps a moved-out workspace a client across a restart, and takes it back through the claim channel', async () => {
    let m = await load();
    let core = m.createCoxia({ dataDir });
    await core.start();
    const status = (await m.rpc.invokeAdmin('ownership:move-out', [{ to: 'vps:example:7' }])) as { movedOut: { to: string } | null };
    expect(status.movedOut?.to).toBe('vps:example:7');
    expect(core.ownership()).toMatchObject({ role: 'client' });
    await expect(m.rpc.invokeAdmin('ownership:move-out', [{}])).rejects.toMatchObject({ code: 'invalid-input' });
    await core.stop({ deadlineMs: 500 });

    vi.resetModules();
    m = await load();
    core = m.createCoxia({ dataDir });
    await core.start();
    try {
      expect(core.ownership()).toMatchObject({ role: 'client', expired: false, movedOut: { to: 'vps:example:7' } });
      expect(await m.rpc.invokeAdmin('ownership:claim', [])).toMatchObject({ role: 'owner', movedOut: null });
    } finally {
      await core.stop({ deadlineMs: 500 });
    }
  });
});
