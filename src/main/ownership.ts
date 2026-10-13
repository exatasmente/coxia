import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { AuditEntry } from '../shared/auditoria';
import { t } from '../shared/i18n';

// One owner per workspace (#209). The owner is the only instance that runs the runner, the scheduler and every external effect of the workspace; any other instance that opens it
// stays a client. Ownership is a lease in the workspace's folder (`owner.json`): who owns it and until when, renewed by the owner. A file lock (`owner.lock`, created exclusive)
// serialises the read-modify-write of the lease, so two processes on one machine cannot both win. Across machines on a shared folder this is best effort: exclusive creation
// is not reliable on every network filesystem, and a clock that differs by more than the lease's life can make a live lease look expired. Run one owner per folder.

/** How long a lease holds without a renewal. */
export const LEASE_TTL_MS = 30_000;
/** How often the owner renews: a few renewals fit in one life, so a missed one is not a loss. */
export const LEASE_RENEW_MS = 10_000;
/** How often the timer looks at the lease (renewing, or watching a handover). */
export const LEASE_TICK_MS = 2_000;
/** How long a lease marked as handing over waits for the new owner to claim it, before the old owner takes it back. */
export const HANDOVER_CLAIM_MS = 120_000;
/** How long the new owner has, from its claim, to pass its health check and confirm, before the old owner takes the workspace back. */
export const HANDOVER_CONFIRM_MS = 60_000;
/** The safe point the old owner gives a running stage before it hands over. */
export const HANDOVER_PAUSE_MS = 10_000;

const LEASE_FILE = 'owner.json';
const LOCK_FILE = 'owner.lock';
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 2_000;

export interface Lease {
  instanceId: string;
  /** The machine's name, nothing of its user. */
  host: string;
  pid: number;
  startedAt: string;
  renewedAt: string;
  expiresAt: string;
  /** The owner stopped its work and waits for `to` to claim; it keeps the lease until the claim is confirmed. */
  handingOver?: { to: string; at: string; until: string };
  /** Set by an instance that took the workspace from `from` in a handover: the old owner lets go when `confirmedAt` is set, and takes it back after `confirmBy` if it never is. */
  claim?: { from: string; at: string; confirmBy: string; confirmedAt: string | null };
}

export interface OwnershipStatus {
  /** Who holds the lease; null when nobody does. */
  owner: { instanceId: string; host: string; pid: number } | null;
  /** This instance's own id, the one `ownership:release` is told to hand over to. */
  self: string;
  expiresAt: string | null;
  role: 'owner' | 'client';
  /** The lease is past its expiry: its owner is gone, and an admin may take the workspace over. */
  expired: boolean;
  /** The instance the owner is handing over to; null when no handover is open. */
  handingOver: string | null;
}

/** A failure of the ownership rules; `code` is of the closed list of the contract. */
export class OwnershipError extends Error {
  constructor(
    readonly code: 'not-owner' | 'forbidden' | 'conflict' | 'invalid-input',
    message: string,
  ) {
    super(message);
    this.name = 'OwnershipError';
  }
}

/** What the instance does with the work it owns; the core gives them, so this file knows nothing of the runner or the scheduler. */
export interface OwnershipHooks {
  /** Stops the runner and the scheduler at a safe point within the deadline; what a run was doing is left for the next owner to resume. */
  pause(deadlineMs: number): Promise<void>;
  /** Starts the runner and the scheduler, and takes over the runs the last owner left working. */
  resume(): void;
  /** Whether this instance can serve as the owner right now; asked of a new owner before it confirms. */
  health(): Promise<boolean>;
}

export interface OwnershipOptions {
  /** The workspace's data folder, where the lease lives. */
  dir: string;
  instanceId: string;
  hooks: OwnershipHooks;
  /** One line of the audit log per claim, release and takeover. */
  audit?: (entry: Omit<AuditEntry, 'at' | 'chain' | 'tampered'>) => void;
  now?: () => Date;
  host?: string;
  pid?: number;
  /** For a test: the intervals of the timer, the claim and the confirmation. */
  timings?: Partial<{ ttl: number; renew: number; tick: number; claim: number; confirm: number }>;
}

export interface Ownership {
  /** At start: takes the workspace when nobody holds it (or when this instance already did), else stays a client. */
  acquire(): OwnershipStatus;
  status(): OwnershipStatus;
  /** True while this instance owns the workspace and may run its work; false for a client and for an owner that is handing over. */
  running(): boolean;
  /** Refuses with `not-owner`, naming the owner, unless `running()`. */
  require(): void;
  /** The owner stops its work and marks the lease as handed to `to`; it keeps the lease until `to` confirms. */
  release(to: string, options?: { deadlineMs?: number; by?: string }): Promise<OwnershipStatus>;
  /** A client takes the lease: from an owner that marked it for this instance, or, with `admin`, from an owner whose lease expired. */
  claim(options: { admin: boolean; by?: string }): Promise<OwnershipStatus>;
  /** Clears the timer; an owner's lease is removed so the next start takes it at once. */
  stop(): void;
}

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The id of this instance: generated once for this data root on this machine, so a restarted process re-takes its own lease. */
export function instanceIdOf(root: string, host: string = hostname()): string {
  const file = join(root, 'instance.json');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown; host?: unknown };
    // A data folder copied to another machine is another instance there.
    if (typeof saved.id === 'string' && saved.id && saved.host === host) return saved.id;
  } catch {
    // None yet, or unreadable: a new one is made.
  }
  const id = randomUUID();
  mkdirSync(root, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ id, host }));
  renameSync(`${file}.tmp`, file);
  return id;
}

export function createOwnership(options: OwnershipOptions): Ownership {
  const { dir, instanceId: self, hooks } = options;
  const now = (): Date => options.now?.() ?? new Date();
  const host = options.host ?? hostname();
  const pid = options.pid ?? process.pid;
  const ttl = options.timings?.ttl ?? LEASE_TTL_MS;
  const renewEvery = options.timings?.renew ?? LEASE_RENEW_MS;
  const tickEvery = options.timings?.tick ?? LEASE_TICK_MS;
  const claimWindow = options.timings?.claim ?? HANDOVER_CLAIM_MS;
  const confirmWindow = options.timings?.confirm ?? HANDOVER_CONFIRM_MS;
  const leaseFile = join(dir, LEASE_FILE);
  const lockFile = join(dir, LOCK_FILE);

  // 'handing' is an owner that stopped its work for a handover and has not been told it is over: it keeps renewing, and runs nothing.
  let state: 'client' | 'owner' | 'handing' = 'client';
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  // The pause of a handover that is still unwinding: the lease is not marked before the work is safe.
  let pausing: Promise<void> | null = null;

  const iso = (ms: number): string => new Date(ms).toISOString();
  const at = (): number => now().getTime();

  function read(): Lease | null {
    try {
      const raw = JSON.parse(readFileSync(leaseFile, 'utf8')) as Partial<Lease>;
      if (typeof raw.instanceId !== 'string' || typeof raw.expiresAt !== 'string') return null;
      return raw as Lease;
    } catch {
      return null;
    }
  }

  function write(lease: Lease): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${leaseFile}.tmp`, JSON.stringify(lease, null, 1));
    renameSync(`${leaseFile}.tmp`, leaseFile);
  }

  // Exclusive creation is what two processes racing on one machine cannot both win; a lock left by a killed process is taken after a few seconds.
  function locked<T>(fn: () => T): T {
    mkdirSync(dir, { recursive: true });
    const until = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        closeSync(openSync(lockFile, 'wx'));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          if (Date.now() - statSync(lockFile).mtimeMs > LOCK_STALE_MS) rmSync(lockFile, { force: true });
        } catch {
          // Gone between the two calls: the next try creates it.
        }
        // i18n-ignore: developer error: the lock of the lease could not be taken
        if (Date.now() > until) throw new Error(`could not lock ${lockFile}`);
        sleep(10);
      }
    }
    try {
      return fn();
    } finally {
      rmSync(lockFile, { force: true });
    }
  }

  const fresh = (extra: Partial<Lease> = {}, startedAt = iso(at())): Lease => ({ instanceId: self, host, pid, startedAt, renewedAt: iso(at()), expiresAt: iso(at() + ttl), ...extra });
  const expired = (lease: Lease): boolean => Date.parse(lease.expiresAt) <= at();
  const who = (lease: Lease): string => `${lease.host} (${lease.instanceId.slice(0, 8)}, pid ${lease.pid})`;

  function audit(op: string, fields: Record<string, string>, ok = true, result = '', by = 'ownership'): void {
    try {
      options.audit?.({ kind: 'ownership', issue: 0, target: `ownership ${op}`, via: 'ownership', fields: { instance: self, ...fields }, ok, code: null, result, origin: { actionId: '', kind: 'ownership', key: op, summary: null }, by });
    } catch {
      // A failing log does not undo the move.
    }
  }

  function status(): OwnershipStatus {
    const lease = read();
    return {
      owner: lease ? { instanceId: lease.instanceId, host: lease.host, pid: lease.pid } : null,
      self,
      expiresAt: lease?.expiresAt ?? null,
      role: state === 'owner' ? 'owner' : 'client',
      expired: lease ? expired(lease) : false,
      handingOver: lease?.handingOver?.to ?? null,
    };
  }

  const notOwner = (): OwnershipError => {
    const lease = read();
    return new OwnershipError('not-owner', lease && lease.instanceId !== self ? t('main.ownership.notOwner', { owner: who(lease) }) : t('main.ownership.notOwnerNone'));
  };

  function beat(): void {
    if (timer || stopped) return;
    timer = setInterval(tick, tickEvery);
    timer.unref();
  }
  function unbeat(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // What the instance does on each beat: renew as the owner, or, once it handed over, watch for the new owner's confirmation.
  function tick(): void {
    try {
      locked(() => {
        const lease = read();
        if (state === 'owner') {
          // Another instance holds the lease (this one was paused too long and the lease passed): the work stops, so two owners never run at once.
          if (!lease || lease.instanceId !== self) {
            state = 'client';
            unbeat();
            void hooks.pause(0).catch(() => undefined);
            audit('lost', { owner: lease?.instanceId ?? '' }, false, t('main.ownership.lost'));
            return;
          }
          if (at() - Date.parse(lease.renewedAt) >= renewEvery) write({ ...lease, renewedAt: iso(at()), expiresAt: iso(at() + ttl) });
          return;
        }
        if (state !== 'handing' || pausing) return;
        if (lease?.instanceId === self) {
          if (lease.handingOver && Date.parse(lease.handingOver.until) <= at()) {
            // Nobody claimed in time: the handover is off and the work goes on here.
            const { handingOver: _gone, ...own } = lease;
            write({ ...own, renewedAt: iso(at()), expiresAt: iso(at() + ttl) });
            return back('handover-expired', {});
          }
          if (!lease.handingOver) return back('handover-cancelled', {});
          if (at() - Date.parse(lease.renewedAt) >= renewEvery) write({ ...lease, renewedAt: iso(at()), expiresAt: iso(at() + ttl) });
          return;
        }
        if (lease?.claim?.from === self) {
          if (lease.claim.confirmedAt) {
            // The new owner passed its health check: only now does this instance let go.
            state = 'client';
            unbeat();
            audit('release-confirmed', { to: lease.instanceId });
            return;
          }
          if (Date.parse(lease.claim.confirmBy) <= at() || expired(lease)) {
            // The new owner did not confirm: the workspace comes back, with nothing changed since the pause.
            write(fresh({}, undefined));
            audit('take-back', { from: lease.instanceId }, true, t('main.ownership.neverConfirmed', { owner: who(lease) }));
            return back('', {});
          }
          return;
        }
        // The lease is gone or belongs to someone this instance did not hand to: nothing to watch for any more.
        state = 'client';
        unbeat();
      });
    } catch (e) {
      console.error('[ownership] tick', e instanceof Error ? e.message : e);
    }
  }

  function back(op: string, fields: Record<string, string>): void {
    state = 'owner';
    if (op) audit(op, fields);
    hooks.resume();
  }

  return {
    acquire() {
      if (stopped) return status();
      locked(() => {
        const lease = read();
        if (!lease || lease.instanceId === self) {
          // A process of this instance that restarts takes its own lease again, whatever was left in it.
          write(fresh({}, lease && lease.instanceId === self ? lease.startedAt : undefined));
          state = 'owner';
        } else state = 'client';
      });
      if (state === 'owner') beat();
      return status();
    },
    status,
    running: () => state === 'owner',
    require() {
      if (state !== 'owner') throw notOwner();
    },
    async release(to, o = {}) {
      if (typeof to !== 'string' || !to || to === self) throw new OwnershipError('invalid-input', t('main.ownership.badTarget'));
      if (state !== 'owner') throw notOwner();
      // The work stops first and the lease is marked after: the new owner cannot start while a stage of this one is still going.
      state = 'handing';
      pausing = hooks.pause(o.deadlineMs ?? HANDOVER_PAUSE_MS);
      try {
        await pausing;
      } catch (e) {
        pausing = null;
        state = 'owner';
        hooks.resume();
        audit('release', { to }, false, e instanceof Error ? e.message : String(e), o.by);
        throw e;
      }
      pausing = null;
      locked(() => {
        const lease = read();
        if (!lease || lease.instanceId !== self) throw notOwner();
        write({ ...lease, renewedAt: iso(at()), expiresAt: iso(at() + ttl), handingOver: { to, at: iso(at()), until: iso(at() + claimWindow) } });
      });
      audit('release', { to }, true, '', o.by);
      return status();
    },
    async claim(o) {
      let previous: Lease | null = null;
      let kind = 'free' as 'handover' | 'takeover' | 'free';
      locked(() => {
        const lease = read();
        if (lease && lease.instanceId === self) throw new OwnershipError('conflict', t('main.ownership.alreadyOwner'));
        if (lease && lease.handingOver?.to === self && Date.parse(lease.handingOver.until) > at() && !expired(lease)) kind = 'handover';
        else if (lease && expired(lease)) {
          // The owner is gone: only an admin takes the workspace (a paired device has passed the passkey at the web door before it gets here).
          if (!o.admin) throw new OwnershipError('forbidden', t('main.ownership.adminOnly', { owner: who(lease) }));
          kind = 'takeover';
        } else if (lease) throw new OwnershipError('forbidden', t('main.ownership.notHandedToYou', { owner: who(lease) }));
        previous = lease;
        write(fresh(kind === 'handover' && lease ? { claim: { from: lease.instanceId, at: iso(at()), confirmBy: iso(at() + confirmWindow), confirmedAt: null } } : {}));
      });
      const from = (previous as Lease | null)?.instanceId ?? '';
      audit(kind === 'takeover' ? 'takeover' : 'claim', { from, ...(previous ? { fromHost: (previous as Lease).host, expiredAt: (previous as Lease).expiresAt } : {}) }, true, '', o.by);

      let healthy = false;
      try {
        healthy = await hooks.health();
      } catch {
        healthy = false;
      }
      if (!healthy) {
        // The old owner keeps the workspace: its own lease goes back, with the handover cleared, and it resumes on its next look.
        locked(() => {
          const lease = read();
          if (lease?.instanceId !== self) return;
          if (kind === 'handover' && previous) {
            const { handingOver: _gone, claim: _claim, ...old } = previous;
            write({ ...old, renewedAt: iso(at()), expiresAt: iso(at() + ttl) });
          } else rmSync(leaseFile, { force: true });
        });
        audit('claim-failed', { from }, false, t('main.ownership.unhealthy'), o.by);
        throw new OwnershipError('conflict', t('main.ownership.unhealthy'));
      }
      state = 'owner';
      hooks.resume();
      locked(() => {
        const lease = read();
        if (lease?.instanceId === self && lease.claim) write({ ...lease, claim: { ...lease.claim, confirmedAt: iso(at()) } });
      });
      beat();
      return status();
    },
    stop() {
      stopped = true;
      unbeat();
      if (state !== 'owner') return;
      state = 'client';
      try {
        locked(() => {
          if (read()?.instanceId === self) rmSync(leaseFile, { force: true });
        });
      } catch {
        // The lease expires by itself.
      }
    },
  };
}

// The ownership of this process, set once by the core. Absent (a test of a module on its own): every instance is the owner of what it runs.
let current: Ownership | null = null;
export const setOwnership = (o: Ownership | null): void => {
  current = o;
};
export const ownership = (): Ownership | null => current;
/** Whether this instance may run the work of its workspace: the runner, the scheduler and the effects that leave the machine. */
export const ownsWorkspace = (): boolean => current?.running() ?? true;
/** Throws `not-owner` on an instance that is a client. */
export const requireOwner = (): void => current?.require();
