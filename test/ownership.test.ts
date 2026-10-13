// One owner per workspace (#209): the lease, the refusal on a client, the handover and the takeover. Two instances are two ownership objects over one folder, each with its own id.
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { errorCodeOf } from '../src/shared/contract';
import { type OwnershipHooks, type Lease, createOwnership, instanceIdOf } from '../src/main/ownership';
import { boot, doc, fakeEngine, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const folder = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-owner-'));
const leaseOf = (dir: string): Lease => JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')) as Lease;

function hooks(over: Partial<OwnershipHooks> = {}): OwnershipHooks & { log: string[] } {
  const log: string[] = [];
  return { log, pause: async () => void log.push('pause'), resume: () => void log.push('resume'), health: async () => true, ...over };
}

function instance(dir: string, id: string, clock: { t: number }, h: OwnershipHooks = hooks(), audit?: (e: { target: string }) => void, host = 'machine-a') {
  return createOwnership({ dir, instanceId: id, hooks: h, now: () => new Date(clock.t), host, pid: 100, audit: audit as never, timings: { tick: 1_000_000 } });
}

describe('the lease', () => {
  it('is taken by the first instance and refused to the second, which names the owner', () => {
    const dir = folder();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    const a = instance(dir, 'aaaaaaaa-1', clock);
    const b = instance(dir, 'bbbbbbbb-2', clock, hooks(), undefined, 'machine-b');
    expect(a.acquire()).toMatchObject({ role: 'owner', self: 'aaaaaaaa-1', owner: { instanceId: 'aaaaaaaa-1', host: 'machine-a' } });
    const second = b.acquire();
    expect(second).toMatchObject({ role: 'client', owner: { instanceId: 'aaaaaaaa-1', host: 'machine-a' }, expired: false });
    expect(b.running()).toBe(false);
    let refused: unknown;
    try {
      b.require();
    } catch (e) {
      refused = e;
    }
    expect(errorCodeOf(refused)).toBe('not-owner');
    expect((refused as Error).message).toContain('machine-a');
    a.stop();
    b.stop();
  });

  it('holds the fields of the format and nothing of the user', () => {
    const dir = folder();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    const a = instance(dir, 'aaaaaaaa-1', clock);
    a.acquire();
    expect(Object.keys(leaseOf(dir)).sort()).toEqual(['expiresAt', 'host', 'instanceId', 'pid', 'renewedAt', 'startedAt']);
    expect(leaseOf(dir).expiresAt).toBe('2026-10-01T10:00:30.000Z');
    a.stop();
  });

  it('is renewed by the owner on its timer, and cleared when it stops', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      const dir = folder();
      const a = createOwnership({ dir, instanceId: 'aaaaaaaa-1', hooks: hooks(), timings: { tick: 2_000, renew: 10_000, ttl: 30_000 } });
      a.acquire();
      expect(leaseOf(dir).renewedAt).toBe('2026-10-01T10:00:00.000Z');
      vi.advanceTimersByTime(12_000);
      expect(leaseOf(dir).renewedAt).toBe('2026-10-01T10:00:10.000Z');
      expect(leaseOf(dir).expiresAt).toBe('2026-10-01T10:00:40.000Z');
      expect(vi.getTimerCount()).toBe(1);
      a.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a restarted process of the same instance takes its own lease again, and a clean stop frees it', () => {
    const dir = folder();
    const clock = { t: 1_000_000_000_000 };
    const first = instance(dir, 'aaaaaaaa-1', clock);
    first.acquire();
    const again = instance(dir, 'aaaaaaaa-1', clock);
    expect(again.acquire().role).toBe('owner');
    again.stop();
    const other = instance(dir, 'bbbbbbbb-2', clock);
    expect(other.acquire().role).toBe('owner');
    other.stop();
    first.stop();
  });

  it('keeps an instance id per data folder and machine', () => {
    const root = folder();
    const id = instanceIdOf(root, 'machine-a');
    expect(instanceIdOf(root, 'machine-a')).toBe(id);
    // The same folder carried to another machine is another instance.
    expect(instanceIdOf(root, 'machine-b')).not.toBe(id);
  });

  it('serialises on an exclusive lock file, and takes one a killed process left behind', () => {
    const dir = folder();
    const lock = join(dir, 'owner.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const a = instance(dir, 'aaaaaaaa-1', { t: Date.now() });
    expect(a.acquire().role).toBe('owner');
    // Released after each step: the next process is not kept out.
    expect(existsSync(lock)).toBe(false);
    a.stop();
  });
});

describe('a lease that expired', () => {
  it('is not taken by a starting instance, and is taken over by an admin, audited', async () => {
    const dir = folder();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    const dead = instance(dir, 'aaaaaaaa-1', clock);
    dead.acquire();
    // The owner is killed: no stop, no renewal.
    clock.t += 31_000;
    const lines: string[] = [];
    const h = hooks();
    const b = instance(dir, 'bbbbbbbb-2', clock, h, (e) => lines.push(e.target), 'machine-b');
    expect(b.acquire()).toMatchObject({ role: 'client', expired: true });

    await expect(b.claim({ admin: false })).rejects.toMatchObject({ code: 'forbidden' });
    expect(b.status().role).toBe('client');

    expect(await b.claim({ admin: true })).toMatchObject({ role: 'owner', owner: { instanceId: 'bbbbbbbb-2' } });
    expect(h.log).toEqual(['resume']);
    expect(lines).toEqual(['ownership takeover']);
    b.stop();
  });

  it('is not taken over while it is alive, nor by a claim nobody handed over', async () => {
    const dir = folder();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    const a = instance(dir, 'aaaaaaaa-1', clock);
    a.acquire();
    const b = instance(dir, 'bbbbbbbb-2', clock);
    b.acquire();
    await expect(b.claim({ admin: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(a.running()).toBe(true);
    a.stop();
  });

  it('an owner that was paused past its lease stops running once it sees another holds it', () => {
    const dir = folder();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const h = hooks();
      const slow = createOwnership({ dir, instanceId: 'aaaaaaaa-1', hooks: h, now: () => new Date(clock.t), timings: { tick: 1_000 } });
      slow.acquire();
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ ...leaseOf(dir), instanceId: 'bbbbbbbb-2' }));
      vi.advanceTimersByTime(1_000);
      expect(slow.running()).toBe(false);
      expect(h.log).toEqual(['pause']);
      slow.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a handover', () => {
  const setup = () => {
    const dir = folder();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const lines: string[] = [];
    const audit = (e: { target: string }): void => void lines.push(e.target);
    const ha = hooks();
    const hb = hooks();
    const make = (id: string, h: OwnershipHooks) => createOwnership({ dir, instanceId: id, hooks: h, now: () => new Date(clock.t), audit: audit as never, host: id, timings: { tick: 1_000, confirm: 60_000, claim: 120_000 } });
    return { dir, clock, lines, ha, hb, a: make('aaaaaaaa-1', ha), b: make('bbbbbbbb-2', hb) };
  };

  it('moves the workspace: the old owner stops, the new one claims and confirms, then the old one lets go', async () => {
    const { clock, lines, ha, hb, a, b, dir } = setup();
    try {
      a.acquire();
      b.acquire();
      await a.release('bbbbbbbb-2');
      expect(ha.log).toEqual(['pause']);
      expect(a.running()).toBe(false);
      expect(leaseOf(dir).handingOver?.to).toBe('bbbbbbbb-2');
      // Not handed to anyone else.
      const c = createOwnership({ dir, instanceId: 'cccccccc-3', hooks: hooks(), now: () => new Date(clock.t) });
      c.acquire();
      await expect(c.claim({ admin: true })).rejects.toMatchObject({ code: 'forbidden' });

      expect(await b.claim({ admin: false })).toMatchObject({ role: 'owner' });
      expect(hb.log).toEqual(['resume']);
      expect(leaseOf(dir)).toMatchObject({ instanceId: 'bbbbbbbb-2', claim: { from: 'aaaaaaaa-1' } });
      expect(leaseOf(dir).claim?.confirmedAt).not.toBeNull();

      // The old owner sees the confirmation and does not take the workspace back.
      vi.advanceTimersByTime(1_000);
      expect(a.running()).toBe(false);
      expect(ha.log).toEqual(['pause']);
      expect(lines).toEqual(['ownership release', 'ownership claim', 'ownership release-confirmed']);
      a.stop();
      b.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the old owner in charge when the new one fails its health check', async () => {
    const { lines, ha, a, b, dir, clock } = setup();
    try {
      const hb = hooks({ health: async () => false });
      const failing = createOwnership({ dir, instanceId: 'bbbbbbbb-2', hooks: hb, now: () => new Date(clock.t), audit: ((e: { target: string }) => lines.push(e.target)) as never, timings: { tick: 1_000 } });
      a.acquire();
      failing.acquire();
      await a.release('bbbbbbbb-2');
      await expect(failing.claim({ admin: false })).rejects.toMatchObject({ code: 'conflict' });
      expect(hb.log).toEqual([]);
      expect(failing.running()).toBe(false);
      expect(leaseOf(dir)).toMatchObject({ instanceId: 'aaaaaaaa-1' });
      expect(leaseOf(dir).handingOver).toBeUndefined();
      // The old owner resumes at its next look.
      vi.advanceTimersByTime(1_000);
      expect(a.running()).toBe(true);
      expect(ha.log).toEqual(['pause', 'resume']);
      expect(lines).toContain('ownership claim-failed');
      a.stop();
      void b;
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the workspace back when the new owner claims and never confirms', async () => {
    const { lines, ha, a, dir, clock } = setup();
    try {
      a.acquire();
      await a.release('bbbbbbbb-2');
      // The new owner wrote its claim and died before it confirmed.
      const lease = leaseOf(dir);
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ ...lease, instanceId: 'bbbbbbbb-2', handingOver: undefined, claim: { from: 'aaaaaaaa-1', at: lease.renewedAt, confirmBy: new Date(clock.t + 60_000).toISOString(), confirmedAt: null } }));
      vi.advanceTimersByTime(1_000);
      expect(a.running()).toBe(false);
      clock.t += 61_000;
      vi.advanceTimersByTime(1_000);
      expect(a.running()).toBe(true);
      expect(leaseOf(dir).instanceId).toBe('aaaaaaaa-1');
      expect(ha.log).toEqual(['pause', 'resume']);
      expect(lines).toContain('ownership take-back');
      a.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the workspace back when nobody claims in time', async () => {
    const { ha, a, clock, dir } = setup();
    try {
      a.acquire();
      await a.release('bbbbbbbb-2');
      clock.t += 121_000;
      vi.advanceTimersByTime(1_000);
      expect(a.running()).toBe(true);
      expect(ha.log).toEqual(['pause', 'resume']);
      expect(leaseOf(dir).handingOver).toBeUndefined();
      a.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the work when the old owner cannot reach a safe point', async () => {
    const { a, ha, dir } = setup();
    try {
      const broken = hooks({ pause: async () => Promise.reject(new Error('stuck')) });
      const x = createOwnership({ dir, instanceId: 'xxxxxxxx-9', hooks: broken, timings: { tick: 1_000 } });
      x.acquire();
      await expect(x.release('bbbbbbbb-2')).rejects.toThrow('stuck');
      expect(x.running()).toBe(true);
      expect(broken.log).toEqual(['resume']);
      x.stop();
      void a;
      void ha;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a run interrupted by a handover', () => {
  it('stops on the old owner and resumes on the new one', async () => {
    const dir = folder();
    const never = (): Promise<never> => new Promise(() => undefined);
    const first = await boot();
    first.engine.script('refiner', () => never());
    const second = await (async () => {
      const engine = fakeEngine();
      engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
      return { engine };
    })();
    const run = await first.runner.start('app#101');
    await vi.waitFor(() => expect(first.engine.calls).toHaveLength(1));

    let next: Awaited<ReturnType<typeof boot>> | null = null;
    const a = createOwnership({ dir, instanceId: 'aaaaaaaa-1', hooks: { pause: (ms) => first.runner.stop(ms), resume: () => undefined, health: async () => true }, timings: { tick: 1_000_000 } });
    const b = createOwnership({
      dir,
      instanceId: 'bbbbbbbb-2',
      hooks: {
        pause: async () => undefined,
        // The new owner's runner is a new one over the same folders, as another process would have.
        resume: () => void next?.runner.resume(),
        health: async () => true,
      },
      timings: { tick: 1_000_000 },
    });
    a.acquire();
    b.acquire();
    await a.release('bbbbbbbb-2', { deadlineMs: 20 });
    expect(first.runner.get(run.id)).toMatchObject({ status: 'working', stage: 'refine' });

    next = await boot({ repo: first.repo, dir: first.dir, engine: second.engine, issues: first.issues });
    await b.claim({ admin: false });
    await next.settle();
    expect(next.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(first.engine.calls).toHaveLength(1);
    a.stop();
    b.stop();
  });
});
