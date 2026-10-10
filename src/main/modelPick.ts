// Which model of a role's pool starts a call. The open engine moves between its own models inside a session (`engine/open/pool.ts`); this is the other half, the one
// that also reaches the Claude SDK: it picks the model a call opens its session with, skipping the ones that rest, and when the SDK says its model was busy before
// any tool ran, starts the call again on the next one. Nothing here changes a role with one model.
import type { EngineId } from '../shared/config/types';
import type { ResolvedRole } from './config-resolve';
import { EngineBusyError, MaxTurnsError, type PoolNotice, ProviderBusyError, type Run } from './engine/contract';
import { normalizeBaseUrl, restKey, restRegistry } from './engine/open';
import type { RestRegistry } from './engine/open/rest';

/**
 * What the rest of a model is kept under: the server (or the provider, for a model of the SDK that has no address of its own), the model and the key, the same
 * identity the open engine rests by, so a refusal seen by one engine is known to every run.
 */
export function memberKey(t: ResolvedRole): string {
  return restKey({ baseUrl: t.baseUrl ? normalizeBaseUrl(t.baseUrl) : `sdk:${t.providerId}`, model: t.model, secretRef: t.secretRef });
}

/** A resolved model without its pool, for the places that hold one model. */
export function withoutPool(r: ResolvedRole): ResolvedRole {
  const { pool: _pool, ...rest } = r;
  return rest;
}

/** The models a call may open with, in order: the `write` list when the role has one (the start of a stage is `write`), else the role's model and its spares. */
export function startList(r: ResolvedRole): ResolvedRole[] {
  if (!r.pool) return [r];
  return r.pool.activities.write ?? [withoutPool(r), ...r.pool.fallbacks];
}

/** The member as the target of a call: it keeps the whole pool (the role's model among its spares), so the open engine still has everywhere to move to. */
function asTarget(role: ResolvedRole, member: ResolvedRole): ResolvedRole {
  if (!role.pool) return member;
  const key = memberKey(member);
  const order = [withoutPool(role), ...role.pool.fallbacks].filter((m) => memberKey(m) !== key);
  return { ...member, pool: { fallbacks: order, activities: role.pool.activities } };
}

export interface StartOptions {
  /** The engine of the session a round continues: a session of one engine is not one the other knows, so the round stays on it. */
  resume?: EngineId;
  /** Members that refused during this call. */
  skip?: ReadonlySet<string>;
  registry?: RestRegistry;
}

/** Why `pickStart` found nobody: every member of the list rests (or refused during this call). */
export interface Exhausted {
  members: ResolvedRole[];
}

/**
 * The model that opens the call: the first of the list that is not resting. A round that continues a session takes the first of the engine that holds it. A role
 * with one model is its own answer (a round on another engine only changes the engine, as it always did). The notice is set when the first of the list was left
 * for resting.
 */
export function pickStart(role: ResolvedRole, o: StartOptions = {}): { target: ResolvedRole; notice: PoolNotice | null } | Exhausted {
  const registry = o.registry ?? restRegistry;
  if (!role.pool) return { target: o.resume && o.resume !== role.engine ? { ...role, engine: o.resume } : role, notice: null };
  const list = startList(role).filter((m) => !o.resume || m.engine === o.resume);
  // Nothing of the engine that holds the session in the pool: the round goes on as the role alone.
  if (!list.length) return { target: o.resume && o.resume !== role.engine ? { ...withoutPool(role), engine: o.resume } : withoutPool(role), notice: null };
  const free = list.filter((m) => !(o.skip?.has(memberKey(m)) || registry.resting(memberKey(m))));
  if (!free.length) return { members: list };
  const [first] = list;
  const pick = free[0];
  const resting = first !== pick && !o.skip?.has(memberKey(first)) ? registry.until(memberKey(first)) : null;
  const notice: PoolNotice | null = resting === null ? null : { from: { label: first.model, provider: first.providerId }, to: { label: pick.model, provider: pick.providerId }, reason: 'resting', until: resting, activity: 'write' };
  return { target: asTarget(role, pick), notice };
}

const exhausted = (x: unknown): x is Exhausted => typeof x === 'object' && x !== null && 'members' in x;

export interface PoolStart {
  resume?: EngineId;
  /** Said when the call opens on another model than the first of the list, or restarts on the next one. */
  notify(notice: PoolNotice): void;
  registry?: RestRegistry;
}

/**
 * Runs a call on the model the pool picks to start it, and returns the result with the engine that answered. A busy refusal of the SDK rests the model for the whole
 * app; when no tool ran yet the call starts again on the next model, else it fails as it always did. A budget refusal is no business of the pool: it passes through
 * and the runner waits on the provider that refused. Every model resting is a failure that names the pool.
 */
export async function withPool<T>(role: ResolvedRole, o: PoolStart, attempt: (target: ResolvedRole) => Promise<Run<T>>): Promise<Run<T>> {
  const registry = o.registry ?? restRegistry;
  const skip = new Set<string>();
  let left: { member: ResolvedRole; kind: PoolNotice['reason']; until: number } | null = null;
  let detail = '';
  for (;;) {
    const start = pickStart(role, { resume: o.resume, skip, registry });
    if (exhausted(start)) {
      const back = start.members.map((m) => registry.until(memberKey(m))).filter((x): x is number => x !== null);
      throw new ProviderBusyError(role.role, role.engine, start.members.map((m) => m.model), back.length ? Math.min(...back) : null, detail);
    }
    const notice: PoolNotice | null = left
      ? { from: { label: left.member.model, provider: left.member.providerId }, to: { label: start.target.model, provider: start.target.providerId }, reason: left.kind, until: left.until, activity: 'write' }
      : start.notice;
    if (notice) o.notify(notice);
    left = null;
    try {
      const r = await attempt(start.target);
      return { ...r, engine: start.target.engine };
    } catch (e) {
      // The wrap-up that resumes a session that ran out of turns has to run on the engine that holds it.
      if (e instanceof MaxTurnsError && e.engine === undefined) e.engine = start.target.engine;
      if (!(e instanceof EngineBusyError) || !role.pool) throw e;
      const until = registry.rest(memberKey(start.target));
      // A tool already ran: what it did is not undone, so the call is not handed to another model.
      if (e.toolUsed) throw e;
      skip.add(memberKey(start.target));
      left = { member: start.target, kind: e.kind, until };
      detail = e.message;
    }
  }
}
