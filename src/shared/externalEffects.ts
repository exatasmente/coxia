import { CURRENCY, RECURRENCES, type AllowedBy, type Recurrence } from './budget';
import type { EffectKind } from './effects';

// What an external client (coxia-provision, through the local admin socket) says to ask before an effect and to record what it cost: `effects:request`, `effects:settle` and
// `accounts:assert`. Pure: the disk, the budget, the grants and the proposals are in main/effectsRequest.ts.

/** The kinds a client may ask for. The others join when their step-up and their settle are defined. */
export const REQUESTABLE_KINDS = ['spend', 'destroy'] as const satisfies readonly EffectKind[];
export type RequestableKind = (typeof REQUESTABLE_KINDS)[number];

export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const CATEGORY = /^[a-z][a-z0-9-]{0,39}$/;
export const REQUEST_LIMITS = { summary: 200, target: 120, reference: 120, account: 64 } as const;

/** How long the person has to answer a proposal, and how long a ticket (or a refusal) is kept after it was issued. A client that asks again with the same id after that starts over. */
export const PROPOSAL_TTL_MS = 3_600_000;
export const TICKET_TTL_MS = 3_600_000;

export interface EffectRequestArgs {
  requestId: string;
  kind: RequestableKind;
  accountId: string;
  summary: string;
  amount?: number;
  currency?: string;
  category?: string;
  recurrence?: Recurrence;
  target?: string;
}

export type EffectRequestResult =
  | { state: 'allowed'; allowedBy: AllowedBy; ticket: string; expiresAt: string }
  | { state: 'pending'; proposalId: string };

export interface EffectSettleArgs {
  ticket: string;
  actual: { amount: number; currency: string; kind?: 'estimated' | 'reconciled'; reference?: string };
}

export interface EffectSettleResult {
  entryId: string | null;
  overrun: boolean;
}

export interface AccountAssertResult {
  id: string;
  provider: string;
  secretRefs: string[];
}

/** A request with every default filled in, the shape that is hashed for idempotency and kept on the ticket. */
export interface CleanRequest {
  requestId: string;
  kind: RequestableKind;
  accountId: string;
  summary: string;
  amount: number | null;
  currency: string | null;
  category: string;
  recurrence: Recurrence;
  target: string | null;
}

/** A field of a request or a settlement that is not valid, named so the caller words it. */
export class EffectInputError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = 'EffectInputError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneLine = (v: unknown, field: string, max: number, required: boolean): string | null => {
  if (v === undefined || v === null) {
    if (required) throw new EffectInputError(field);
    return null;
  }
  if (typeof v !== 'string' || v.includes('\0') || v.length > max) throw new EffectInputError(field);
  const text = v.replace(/\s+/g, ' ').trim();
  if (required && !text) throw new EffectInputError(field);
  return text || null;
};

/** The amount of a settlement or a request: a finite number of zero or more. */
export function amountOf(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new EffectInputError(field);
  return v;
}

/**
 * A request as the core keeps it, in the currency it is priced in. `accepts` says whether the workspace's budget can take a price in a currency (its own, or one it has a rate
 * for); a price in another is refused, never taken at 1:1. `mask` hides what looks
 * like a credential in the free text, so the person is never shown one and the ledger never keeps one.
 */
export function cleanRequest(input: unknown, accepts: (currency: string) => boolean, mask: (text: string) => string = (x) => x): CleanRequest {
  if (!isObject(input)) throw new EffectInputError('args');
  const requestId = input.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new EffectInputError('requestId');
  const kind = input.kind;
  if (typeof kind !== 'string' || !(REQUESTABLE_KINDS as readonly string[]).includes(kind)) throw new EffectInputError('kind');
  const accountId = oneLine(input.accountId, 'accountId', REQUEST_LIMITS.account, true) as string;
  const summary = mask(oneLine(input.summary, 'summary', REQUEST_LIMITS.summary, true) as string);
  const target = oneLine(input.target, 'target', REQUEST_LIMITS.target, false);
  const category = input.category === undefined ? 'infrastructure' : input.category;
  if (typeof category !== 'string' || !CATEGORY.test(category)) throw new EffectInputError('category');
  const recurrence = input.recurrence === undefined ? 'once' : input.recurrence;
  if (typeof recurrence !== 'string' || !(RECURRENCES as readonly string[]).includes(recurrence)) throw new EffectInputError('recurrence');
  let amount: number | null = null;
  let currency: string | null = null;
  if (kind === 'spend') {
    amount = amountOf(input.amount, 'amount');
    if (typeof input.currency !== 'string' || !CURRENCY.test(input.currency) || !accepts(input.currency)) throw new EffectInputError('currency');
    currency = input.currency;
  } else if (input.amount !== undefined || input.currency !== undefined) {
    // A destroy costs nothing to ask: what it saves or frees is not a spend.
    throw new EffectInputError('amount');
  }
  return { requestId, kind: kind as RequestableKind, accountId, summary: summary, amount, currency, category, recurrence: recurrence as Recurrence, target: target === null ? null : mask(target) };
}

export interface CleanSettle {
  ticket: string;
  amount: number;
  currency: string;
  kind: 'estimated' | 'reconciled';
  reference: string | null;
}

/** A settlement as the core keeps it, in the currency it was charged in; `accepts` as for `cleanRequest`. Whether it is the currency of the request is the caller's to check. */
export function cleanSettle(input: unknown, accepts: (currency: string) => boolean, mask: (text: string) => string = (x) => x): CleanSettle {
  if (!isObject(input)) throw new EffectInputError('args');
  const ticket = input.ticket;
  if (typeof ticket !== 'string' || ticket.length < 10 || ticket.length > 160) throw new EffectInputError('ticket');
  const actual = input.actual;
  if (!isObject(actual)) throw new EffectInputError('actual');
  const amount = amountOf(actual.amount, 'amount');
  if (typeof actual.currency !== 'string' || !CURRENCY.test(actual.currency) || !accepts(actual.currency)) throw new EffectInputError('currency');
  const currency = actual.currency;
  const kind = actual.kind === undefined ? 'estimated' : actual.kind;
  if (kind !== 'estimated' && kind !== 'reconciled') throw new EffectInputError('kind');
  const reference = oneLine(actual.reference, 'reference', REQUEST_LIMITS.reference, false);
  return { ticket, amount, currency, kind, reference: reference === null ? null : mask(reference) };
}

/** The ticket of a request: its id, a dot and a random part, so the core finds the file at once. The random part is what makes it a secret of the client. */
export const ticketRequestId = (ticket: string): string | null => {
  const i = ticket.lastIndexOf('.');
  const id = i > 0 ? ticket.slice(0, i) : '';
  return REQUEST_ID.test(id) ? id : null;
};
