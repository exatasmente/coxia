import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { type EffectEvent, type EffectGrant, type EffectKind, type EffectStatus, type KindRecord, AMOUNT_KINDS, DEFAULT_OFFER_AFTER, EFFECT_KINDS, EVENTS_MAX, HOUR_MS, THRESHOLD_MAX, effectOfAction, emptyRecord, isEffectKind, offerOf, stepUpOfEffect } from '../shared/effects';
import type { SpendRequest } from '../shared/budget';
import type { ReleaseAction } from '../shared/types';
import { ContractError } from '../shared/contract';
import { t } from '../shared/i18n';
import { recordWrite } from './auditoria';
import { checkSpend } from './budget';
import { atasDir } from './env';
import type { Module } from './module';
import { requireSensitive } from './passkeyStepUp';
import { viaOf } from './rpc';
import type { Notice } from './scheduler';
import { getConfig, updateConfig } from './workspaceConfig';

// Autonomy per kind of external effect (#199). Every kind asks until the person grants it; the app keeps each kind's track record and offers a grant once it is earned.
// Both files are read from the disk at every decision and never cached, so a revocation stops the very next action, also when another client made it.
//
// A switch of the configuration from before grants (`runner.autonomy.push` / `.pullRequest`, with `cycle`) is read as a grant of that kind by the person (`legacy`): it is
// not copied anywhere, so nothing that goes out by itself today stops, and revoking it turns the switch off.

const dir = (): string => join(atasDir(), 'autonomy');
const GRANTS = (): string => join(dir(), 'grants.json');
const RECORD = (): string => join(dir(), 'record.json');

interface RecordFile {
  version: 1;
  kinds: Partial<Record<EffectKind, KindRecord>>;
  events: EffectEvent[];
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {}
  return fallback;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 1), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

const readRecord = (): RecordFile => {
  const r = readJson<Partial<RecordFile>>(RECORD(), {});
  return { version: 1, kinds: r.kinds ?? {}, events: Array.isArray(r.events) ? r.events : [] };
};
const writeRecord = (r: RecordFile): void => writeJson(RECORD(), { ...r, events: r.events.slice(-EVENTS_MAX) });
const recOf = (r: RecordFile, kind: EffectKind): KindRecord => ({ ...emptyRecord(), ...(r.kinds[kind] ?? {}) });

export const readGrants = (): EffectGrant[] => {
  const g = readJson<{ grants?: EffectGrant[] }>(GRANTS(), {}).grants;
  return Array.isArray(g) ? g.filter((x) => isEffectKind(x?.kind)) : [];
};
const writeGrants = (grants: EffectGrant[]): void => writeJson(GRANTS(), { version: 1, grants });

/** N for a kind: its own entry, else the workspace's, else 5. */
export function offerAfterFor(kind: EffectKind): number {
  const e = getConfig().effects;
  return e?.perKind?.[kind] ?? e?.offerAfter ?? DEFAULT_OFFER_AFTER;
}

// ---- the configuration's own switches, read as grants ----------------------------------------------------------------------------------------------------------------------

const LEGACY: Partial<Record<EffectKind, 'push' | 'pullRequest'>> = { push: 'push', 'pull-request': 'pullRequest' };

/** The blocks of the configuration that can let a run push or open a pull request by itself: the workspace's and the flows that decide for themselves. */
function legacyBlocks(): { cycle: boolean; push: boolean; pullRequest: boolean }[] {
  const c = getConfig();
  const flows = Object.values(c.devCycle.autonomy ?? {}).filter((b) => b && b.useWorkspace === false);
  return [c.runner.autonomy, ...flows];
}

function legacyGrant(kind: EffectKind): EffectGrant | null {
  const field = LEGACY[kind];
  if (!field) return null;
  if (!legacyBlocks().some((b) => b.cycle === true && b[field] === true)) return null;
  return { id: `legacy-${kind}`, kind, grantedAt: null, grantedBy: 'person', via: 'config', legacy: true };
}

/** The grant that stands for a kind now, or null: it asks. */
export const grantFor = (kind: EffectKind): EffectGrant | null => readGrants().find((g) => g.kind === kind) ?? legacyGrant(kind);

/** How the audit names a grant. */
export const grantRef = (g: Pick<EffectGrant, 'id'>): string => `grant:${g.id}`;

// ---- the track record ---------------------------------------------------------------------------------------------------------------------------------------------------

function bump(kind: EffectKind, change: (r: KindRecord) => void, event?: EffectEvent): void {
  try {
    const file = readRecord();
    const r = recOf(file, kind);
    change(r);
    file.kinds[kind] = r;
    if (event) file.events.push(event);
    writeRecord(file);
  } catch (e) {
    // The record is a figure for the person; failing to keep it never stops or lets through an action.
    console.error('[autonomy] record', e instanceof Error ? e.message : e);
  }
}

export const noteProposed = (kind: EffectKind): void => bump(kind, (r) => void r.proposed++);

export function noteDecision(kind: EffectKind, id: string, decision: 'approved' | 'refused'): void {
  bump(
    kind,
    (r) => {
      if (decision === 'approved') {
        r.approved++;
        r.streak++;
      } else {
        r.refused++;
      }
      r.proposed = Math.max(r.proposed, r.approved + r.refused);
    },
    { id, kind, outcome: decision, at: new Date().toISOString() },
  );
}

/** The kind an action of Actions is, for the figures; null for one that leaves nothing outside. */
export const effectOf = (a: ReleaseAction): EffectKind | null => effectOfAction(a);

// ---- the decision at the exit ----------------------------------------------------------------------------------------------------------------------------------------

export type Authorization = { ok: true; grant: EffectGrant } | { ok: false; reason: 'no-grant' | 'threshold' | 'budget' };

/**
 * Whether an action of `kind` runs without asking now. No grant: it asks. A grant runs it only inside its threshold: for `spend` the amount of the action and the budget
 * (`checkSpend`), for the others the number of autonomous actions of the kind in the last hour. Anything unreadable asks.
 */
export function authorize(kind: EffectKind, opts: { amount?: number; category?: string; now?: number } = {}): Authorization {
  try {
    const grant = grantFor(kind);
    if (!grant) return { ok: false, reason: 'no-grant' };
    const now = opts.now ?? Date.now();
    if (AMOUNT_KINDS.includes(kind)) {
      const amount = opts.amount ?? Number.POSITIVE_INFINITY;
      if (grant.threshold === undefined || amount > grant.threshold) return { ok: false, reason: 'threshold' };
      if (!checkSpend({ category: opts.category ?? 'infrastructure', amount }, { now }).ok) return { ok: false, reason: 'budget' };
    } else if (grant.threshold !== undefined) {
      const recent = readRecord().events.filter((e) => e.kind === kind && e.outcome === 'autonomous' && now - Date.parse(e.at) < HOUR_MS).length;
      if (recent >= grant.threshold) return { ok: false, reason: 'threshold' };
    }
    return { ok: true, grant };
  } catch (e) {
    console.error('[autonomy] authorize', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'no-grant' };
  }
}

/** Counts an action that went out under a grant. Called right before it runs, so a burst of them meets the threshold. */
export const consume = (kind: EffectKind, id: string, grant: Pick<EffectGrant, 'id'>): void =>
  bump(kind, (r) => void r.autonomous++, { id, kind, outcome: 'autonomous', at: new Date().toISOString(), grant: grant.id });

/** The exit for a spend: `allowedBy` for the ledger when a grant covers it, else it asks. A spend that the budget refuses is never allowed by a grant. */
export function authorizeSpend(req: SpendRequest, id: string): { ok: true; allowedBy: `grant:${string}` } | { ok: false; reason: 'no-grant' | 'threshold' | 'budget' } {
  const a = authorize('spend', { amount: req.amount, category: req.category });
  if (!a.ok) return a;
  consume('spend', id, a.grant);
  return { ok: true, allowedBy: grantRef(a.grant) as `grant:${string}` };
}

// ---- grants, revocations and incidents ----------------------------------------------------------------------------------------------------------------------------

let notifier: ((n: Notice) => void) | null = null;
let emitter: ((kind: EffectKind | null) => void) | null = null;

function audit(op: string, kind: EffectKind, fields: Record<string, string>): void {
  recordWrite({ kind: 'autonomy', issue: 0, target: `autonomy:${op}:${kind}`, via: viaOf(), fields: { op, kind, ...fields }, ok: true, code: null, result: '', origin: { actionId: '', kind: 'autonomy', key: `${op}:${kind}`, summary: null }, by: null });
}

function dropLegacy(kind: EffectKind): void {
  const field = LEGACY[kind];
  if (!field) return;
  updateConfig((c) => ({
    ...c,
    runner: { ...c.runner, autonomy: { ...c.runner.autonomy, [field]: false } },
    devCycle: { ...c.devCycle, autonomy: Object.fromEntries(Object.entries(c.devCycle.autonomy ?? {}).map(([k, b]) => [k, { ...b, [field]: false }])) },
  }));
}

/** Takes the grant of a kind away at once (also the configuration's switch that stood for one). The streak starts over. Returns whether something stood. */
export function revokeKind(kind: EffectKind, why: 'revoke' | 'incident' | 'account', note = ''): boolean {
  const grants = readGrants();
  const explicit = grants.filter((g) => g.kind === kind);
  const legacy = legacyGrant(kind);
  if (explicit.length) writeGrants(grants.filter((g) => g.kind !== kind));
  if (legacy) dropLegacy(kind);
  const had = explicit.length > 0 || !!legacy;
  bump(kind, (r) => {
    r.streak = 0;
    if (had) r.lastRevokedAt = new Date().toISOString();
  });
  audit(why, kind, { grant: [...explicit.map(grantRef), ...(legacy ? [grantRef(legacy)] : [])].join(','), ...(note ? { note: note.slice(0, 300) } : {}) });
  emitter?.(kind);
  return had;
}

/** Revokes every grant tied to an account of the registry (#200). */
export function revokeForAccount(accountId: string): EffectKind[] {
  const tied = readGrants().filter((g) => g.accountId === accountId);
  const kinds = [...new Set(tied.map((g) => g.kind))];
  for (const k of kinds) revokeKind(k, 'account', `account ${accountId}`);
  return kinds;
}

function incident(kind: EffectKind, note: string): boolean {
  const had = revokeKind(kind, 'incident', note);
  notifier?.({ title: t('main.autonomy.incidentTitle', { kind }), body: t(had ? 'main.autonomy.incidentRevoked' : 'main.autonomy.incidentNoGrant', { kind, note: note.slice(0, 200) }), onClick: { type: 'navigate', to: 'settings' } });
  return had;
}

function markReverted(id: string): EffectKind {
  const file = readRecord();
  const ev = file.events.find((e) => e.id === id && e.outcome !== 'refused');
  if (!ev) throw new ContractError('not-found', t('main.autonomy.unknownAction', { id }));
  if (ev.reverted) return ev.kind;
  ev.reverted = true;
  const r = recOf(file, ev.kind);
  r.reverted++;
  r.streak = 0;
  file.kinds[ev.kind] = r;
  writeRecord(file);
  audit('reverted', ev.kind, { action: id, ...(ev.grant ? { grant: `grant:${ev.grant}` } : {}) });
  // An action that went out under a grant and was reverted is an incident of its kind.
  if (ev.outcome === 'autonomous' || grantFor(ev.kind)) incident(ev.kind, t('main.autonomy.revertedNote', { id }));
  else emitter?.(ev.kind);
  return ev.kind;
}

export function statusOf(): EffectStatus[] {
  const file = readRecord();
  return EFFECT_KINDS.map((kind) => {
    const record = recOf(file, kind);
    const grant = grantFor(kind);
    const offerAfter = offerAfterFor(kind);
    return { kind, record, offerAfter, offered: offerOf(record, offerAfter, !!grant), grant, stepUp: stepUpOfEffect(kind), amountThreshold: AMOUNT_KINDS.includes(kind) };
  });
}

const kindArg = (v: unknown): EffectKind => {
  if (!isEffectKind(v)) throw new ContractError('invalid-input', t('main.autonomy.badKind'));
  return v;
};

function grant(kindIn: unknown, thresholdIn: unknown, extra: { accountId?: string } = {}): EffectGrant {
  // An agent never grants itself autonomy: the persona's door does not carry this channel and, should a call reach it, it is refused here as well.
  if (viaOf() === 'persona') throw new ContractError('forbidden', t('main.autonomy.personaRefused'));
  const kind = kindArg(kindIn);
  // Asked for at this moment on an admin device, with the passkey of the kind (spend and budget: budget; DNS and deploys: infrastructure; the rest: permission).
  requireSensitive(stepUpOfEffect(kind), kind);
  if (grantFor(kind)) throw new ContractError('conflict', t('main.autonomy.alreadyGranted', { kind }));
  const status = statusOf().find((s) => s.kind === kind);
  if (!status?.offered) throw new ContractError('forbidden', t('main.autonomy.notOffered', { kind, n: status?.offerAfter ?? 0 }));
  let threshold: number | undefined;
  if (thresholdIn !== undefined && thresholdIn !== null) {
    if (typeof thresholdIn !== 'number' || !Number.isFinite(thresholdIn) || thresholdIn < 0 || thresholdIn > THRESHOLD_MAX) throw new ContractError('invalid-input', t('main.autonomy.badThreshold'));
    threshold = AMOUNT_KINDS.includes(kind) ? Math.round(thresholdIn * 100) / 100 : Math.floor(thresholdIn);
  }
  if (AMOUNT_KINDS.includes(kind) && threshold === undefined) throw new ContractError('invalid-input', t('main.autonomy.amountNeeded'));
  const via = viaOf();
  const g: EffectGrant = { id: randomBytes(5).toString('hex'), kind, ...(threshold !== undefined ? { threshold } : {}), ...(extra.accountId ? { accountId: extra.accountId } : {}), grantedAt: new Date().toISOString(), grantedBy: 'person', via: via === 'persona' ? 'window' : via };
  writeGrants([...readGrants(), g]);
  audit('grant', kind, { grant: grantRef(g), ...(threshold !== undefined ? { threshold: String(threshold) } : {}), ...(g.accountId ? { account: g.accountId } : {}), via });
  emitter?.(kind);
  return g;
}

export const effectGrantsModule: Module = (ctx) => {
  notifier = ctx.notify;
  emitter = (kind) => ctx.emit({ type: 'module', name: 'autonomy:changed', payload: { kind } });
  ctx.handle('autonomy:status', () => statusOf());
  ctx.handle('autonomy:grant', (kind: unknown, threshold?: unknown) => grant(kind, threshold));
  // Taking autonomy back is asked for like the grant (STEP_UP in webPolicy.ts): the window and the admin socket are never asked.
  ctx.handle('autonomy:revoke', (kind: unknown) => {
    if (viaOf() === 'persona') throw new ContractError('forbidden', t('main.autonomy.personaRefused'));
    return { revoked: revokeKind(kindArg(kind), 'revoke') };
  });
  ctx.handle('autonomy:incident', (kind: unknown, note?: unknown) => {
    if (viaOf() === 'persona') throw new ContractError('forbidden', t('main.autonomy.personaRefused'));
    return { revoked: incident(kindArg(kind), typeof note === 'string' ? note : '') };
  });
  ctx.handle('autonomy:mark-reverted', (actionId: unknown) => {
    if (viaOf() === 'persona') throw new ContractError('forbidden', t('main.autonomy.personaRefused'));
    return { kind: markReverted(String(actionId ?? '')) };
  });
};

/** For a test and for the accounts registry: the same grant path with an account attached. */
export const grantForAccount = (kind: unknown, threshold: unknown, accountId: string): EffectGrant => grant(kind, threshold, { accountId });
