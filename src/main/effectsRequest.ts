import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AllowedBy } from '../shared/budget';
import { ContractError, type ErrorCode } from '../shared/contract';
import { type CleanRequest, type EffectRequestResult, type EffectSettleResult, EffectInputError, PROPOSAL_TTL_MS, REQUEST_ID, TICKET_TTL_MS, cleanRequest, cleanSettle, ticketRequestId } from '../shared/externalEffects';
import { t } from '../shared/i18n';
import { assertAccountId } from './accounts';
import { effectRequestOutcome, proposeEffectRequest, withdrawEffectRequest } from './actions';
import { recordWrite } from './auditoria';
import { checkSpend, recordSpend } from './budget';
import { authorize, authorizeSpend, consume, grantRef } from './effectGrants';
import { atasDir } from './env';
import { redact } from './errorlog-core';
import type { Module } from './module';
import { viaOf } from './rpc';
import { assertExternalWrite } from './workspace';
import { getConfig } from './workspaceConfig';

// What an external client (coxia-provision, through the admin socket) asks before an effect and records after it: `effects:request` and `effects:settle`. The decision is the same one
// every effect gets: the budget first (a "yes" never overrides a limit), then a grant of autonomy, then the person's yes in Actions. What it answers is a ticket, single use, kept
// on disk in the workspace so a restart of the core does not lose the purchase it allowed. Nothing here talks to a provider: the client does, and tells the ledger what it cost.

interface Ticketed {
  version: 1;
  requestId: string;
  /** Hash of the request as cleaned: the same id with other arguments is a conflict. */
  hash: string;
  req: CleanRequest;
  provider: string;
  state: 'pending' | 'allowed' | 'refused' | 'settled';
  createdAt: string;
  /** When this record stops mattering: the proposal's time to be answered, then the ticket's, the refusal's or the settlement's time to be read back. */
  until: string;
  proposalId?: string;
  allowedBy?: AllowedBy;
  ticket?: string;
  refusal?: { code: ErrorCode; message: string };
  settledAt?: string;
  entryId?: string | null;
}

const dir = (): string => join(atasDir(), 'effects');
const fileOf = (requestId: string): string => join(dir(), `${requestId}.json`);
const currency = (): string => getConfig().budget?.currency ?? 'USD';
const mask = (text: string): string => redact(text);

function read(requestId: string): Ticketed | null {
  if (!REQUEST_ID.test(requestId)) return null;
  try {
    const file = fileOf(requestId);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Ticketed) : null;
  } catch {
    return null;
  }
}

function write(rec: Ticketed): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const file = fileOf(rec.requestId);
  writeFileSync(`${file}.tmp`, JSON.stringify(rec, null, 1), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** Keeps the folder small: a proposal nobody answered in time is set aside and read back as a refusal; every other record goes when its time is up. */
function prune(now = Date.now()): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir());
  } catch {
    return;
  }
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const rec = read(name.slice(0, -'.json'.length));
    if (!rec) continue;
    if (Date.parse(rec.until) > now) continue;
    if (rec.state === 'pending') {
      if (rec.proposalId) withdrawEffectRequest(rec.proposalId);
      write({ ...rec, state: 'refused', refusal: { code: 'forbidden', message: t('main.effects.expired') }, until: new Date(now + TICKET_TTL_MS).toISOString() });
    } else {
      rmSync(fileOf(rec.requestId), { force: true });
    }
  }
}

const hashOf = (req: CleanRequest): string => createHash('sha256').update(JSON.stringify(req)).digest('hex');

function clean<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof EffectInputError) throw new ContractError('invalid-input', t('main.effects.invalid', { field: e.field }));
    throw e;
  }
}

function notPersona(): void {
  // An agent never asks for its own purchase to be allowed: the persona's door has no such channel and, should a call reach the handler, it is refused here as well.
  if (viaOf() === 'persona') throw new ContractError('forbidden', t('main.effects.personaRefused'));
}

/** A test workspace and a process that does not own the workspace write nothing outside: they are told so before anything is asked or counted. */
function guard(): void {
  try {
    assertExternalWrite(t('main.effects.title'));
  } catch (e) {
    if (e instanceof ContractError || typeof (e as { code?: unknown }).code === 'string') throw e;
    throw new ContractError('forbidden', e instanceof Error ? e.message : String(e));
  }
}

function audit(op: string, rec: Ticketed, fields: Record<string, string>, extra: { grant?: string; ok?: boolean; result?: string } = {}): void {
  recordWrite({
    kind: rec.req.kind === 'spend' ? 'spend' : 'autonomy',
    issue: 0,
    target: `effects:${op}:${rec.req.kind}`,
    via: viaOf(),
    fields: { op, requestId: rec.requestId, kind: rec.req.kind, account: rec.req.accountId, provider: rec.provider, ...(rec.req.target ? { target: rec.req.target } : {}), ...fields },
    ok: extra.ok ?? true,
    code: null,
    result: extra.result ?? '',
    origin: { actionId: rec.proposalId ?? '', kind: 'effect-request', key: rec.requestId, summary: rec.req.summary },
    by: null,
    ...(extra.grant ? { grant: extra.grant } : {}),
  });
}

const allowedResult = (rec: Ticketed): EffectRequestResult => ({ state: 'allowed', allowedBy: rec.allowedBy as AllowedBy, ticket: rec.ticket as string, expiresAt: rec.until });

function issue(rec: Ticketed, allowedBy: AllowedBy): Ticketed {
  const now = Date.now();
  const next: Ticketed = { ...rec, state: 'allowed', allowedBy, ticket: `${rec.requestId}.${randomBytes(18).toString('base64url')}`, until: new Date(now + TICKET_TTL_MS).toISOString() };
  write(next);
  return next;
}

function refuse(rec: Ticketed, code: ErrorCode, message: string): never {
  write({ ...rec, state: 'refused', refusal: { code, message }, until: new Date(Date.now() + TICKET_TTL_MS).toISOString() });
  throw new ContractError(code, message);
}

/** The budget's verdict for a spend, with its coded error; a destroy has no amount to judge. */
function checkBudget(req: CleanRequest): void {
  if (req.kind !== 'spend') return;
  const c = checkSpend({ category: req.category, amount: req.amount as number }, { audit: true });
  if (!c.ok) throw c.error;
}

function resume(rec: Ticketed): EffectRequestResult {
  switch (rec.state) {
    case 'allowed':
      return allowedResult(rec);
    case 'refused':
      throw new ContractError(rec.refusal?.code ?? 'forbidden', rec.refusal?.message ?? t('main.effects.refused'));
    case 'settled':
      throw new ContractError('conflict', t('main.effects.alreadySettled'));
    case 'pending': {
      const outcome = effectRequestOutcome(rec.proposalId ?? '');
      if (outcome === 'pending') return { state: 'pending', proposalId: rec.proposalId as string };
      if (outcome !== 'approved') return refuse(rec, 'forbidden', t('main.effects.refused'));
      // The yes came after the request was made: the budget may have moved since, and a yes does not override a limit.
      try {
        checkBudget(rec.req);
      } catch (e) {
        if (e instanceof Error && (e as { code?: unknown }).code === 'budget-exceeded') return refuse(rec, 'budget-exceeded', e.message);
        throw e;
      }
      const next = issue(rec, 'person');
      audit('ticket', next, { allowedBy: 'person' });
      return allowedResult(next);
    }
  }
}

function begin(req: CleanRequest, hash: string, provider: string): EffectRequestResult {
  checkBudget(req);
  guard();
  const base: Ticketed = { version: 1, requestId: req.requestId, hash, req, provider, state: 'pending', createdAt: new Date().toISOString(), until: '' };
  const covered =
    req.kind === 'spend'
      ? authorizeSpend({ category: req.category, amount: req.amount as number }, req.requestId, { accountId: req.accountId })
      : (() => {
          const a = authorize(req.kind, { accountId: req.accountId });
          if (!a.ok) return a;
          consume(req.kind, req.requestId, a.grant);
          return { ok: true as const, allowedBy: grantRef(a.grant) as `grant:${string}` };
        })();
  if (covered.ok) {
    const rec = issue(base, covered.allowedBy);
    audit('allow', rec, { allowedBy: covered.allowedBy, ...(req.amount === null ? {} : { amount: String(req.amount), currency: req.currency ?? '' }) }, { grant: covered.allowedBy });
    return allowedResult(rec);
  }
  const due = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString();
  const action = proposeEffectRequest({
    requestId: req.requestId,
    summary: req.summary,
    unit: { effect: req.kind, requestId: req.requestId, accountId: req.accountId, provider, amount: req.amount, currency: req.currency, category: req.category, recurrence: req.recurrence, target: req.target, due },
    notify: { title: t(req.kind === 'destroy' ? 'main.effects.notifyDestroyTitle' : 'main.effects.notifySpendTitle'), body: req.summary },
  });
  const rec: Ticketed = { ...base, proposalId: action.id, until: due };
  write(rec);
  audit('propose', rec, { reason: covered.reason, ...(req.amount === null ? {} : { amount: String(req.amount), currency: req.currency ?? '' }) });
  return { state: 'pending', proposalId: action.id };
}

export function requestEffect(raw: unknown): EffectRequestResult {
  notPersona();
  const req = clean(() => cleanRequest(raw, currency(), mask));
  const account = assertAccountId(req.accountId);
  prune();
  const hash = hashOf(req);
  const have = read(req.requestId);
  if (have) {
    if (have.hash !== hash) throw new ContractError('conflict', t('main.effects.otherArgs', { id: req.requestId }));
    return resume(have);
  }
  return begin(req, hash, account.provider);
}

const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cents = (n: number): number => Math.round(n * 100);

export function settleEffect(raw: unknown): EffectSettleResult {
  notPersona();
  const s = clean(() => cleanSettle(raw, currency(), mask));
  prune();
  const id = ticketRequestId(s.ticket);
  const rec = id ? read(id) : null;
  if (!rec || rec.state === 'pending' || rec.state === 'refused' || !rec.ticket || !same(rec.ticket, s.ticket)) throw new ContractError('not-found', t('main.effects.unknownTicket'));
  if (rec.state === 'settled') throw new ContractError('conflict', t('main.effects.alreadySettled'));
  const authorized = rec.req.amount ?? 0;
  const overrun = cents(s.amount) > cents(authorized);
  // The ticket is closed before the ledger is written: a second settle that races this one finds it settled and no spend is recorded twice. A ledger that cannot take the line reopens it.
  const now = new Date().toISOString();
  write({ ...rec, state: 'settled', settledAt: now, entryId: null, until: new Date(Date.now() + TICKET_TTL_MS).toISOString() });
  let entryId: string | null = null;
  if (s.amount > 0) {
    try {
      entryId = recordSpend({ category: rec.req.category, vendor: rec.provider, amount: s.amount, currency: s.currency, recurrence: rec.req.recurrence, reason: rec.req.summary, allowedBy: rec.allowedBy as AllowedBy, kind: s.kind }).id;
    } catch (e) {
      write(rec);
      throw e;
    }
    write({ ...rec, state: 'settled', settledAt: now, entryId, until: new Date(Date.now() + TICKET_TTL_MS).toISOString() });
  }
  audit('settle', rec, { amount: String(s.amount), currency: s.currency, authorized: String(authorized), overrun: String(overrun), entryKind: s.kind, entry: entryId ?? '', ...(s.reference ? { reference: s.reference } : {}) }, { result: overrun ? 'overrun' : '', ...(rec.allowedBy?.startsWith('grant:') ? { grant: rec.allowedBy } : {}) });
  return { entryId, overrun };
}

export const effectsRequestModule: Module = (ctx) => {
  // Desktop and the local admin socket only (webPolicy.ts): a paired browser is denied even with a passkey, and the persona's door does not carry them.
  ctx.handle('effects:request', (input: unknown) => requestEffect(input));
  ctx.handle('effects:settle', (input: unknown) => settleEffect(input));
};
