import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RECURRENCES, type AllowedBy, type LedgerEntry, type LedgerKind, type Recurrence } from '../shared/budget';
import { redact } from './errorlog-core';

// The ledger of the operating budget (#198): one JSON line per spend, appended and never rewritten, in the workspace's own folder. The reader skips a line it cannot
// parse, so one damaged line costs that line and not the history. The environment-free half: the folder comes in, so a test points it at a temporary one.

export const LEDGER_DIR = 'budget';
export const LEDGER_FILE = 'ledger.jsonl';
export const LEDGER_LIMITS = { vendor: 80, reason: 300, category: 40 } as const;
const CATEGORY = /^[a-z][a-z0-9-]{0,39}$/;

/** A spend that does not fit the budget. `code` is of the contract's closed list, so every client reads it the same way. */
export class BudgetError extends Error {
  readonly code = 'budget-exceeded' as const;
  constructor(
    message: string,
    readonly detail: { scope: 'category' | 'month'; category: string; limit: number; spent: number; left: number },
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

/** What a caller says about a spend; the id and the time are the ledger's. */
export interface SpendRecord {
  category: string;
  vendor: string;
  amount: number;
  currency: string;
  recurrence?: Recurrence;
  nextChargeAt?: string;
  reason: string;
  allowedBy: AllowedBy;
  auditRef?: string;
  kind: LedgerKind;
  reconciles?: string;
  /** For a test. */
  at?: string;
}

const ALLOWED = /^(person|estimate|grant:[A-Za-z0-9._-]{1,60})$/;

const ledgerPath = (dir: string): string => join(dir, LEDGER_DIR, LEDGER_FILE);

/** Text that goes to the ledger: masked for anything that looks like a credential or an address, one line, bounded. */
const plain = (text: string, max: number): string => redact(String(text)).replace(/\s+/g, ' ').trim().slice(0, max);

/** The line a record becomes. Throws on a record the ledger must not keep (a bad amount, category, currency or origin). */
export function entryOf(r: SpendRecord, now: Date = new Date()): LedgerEntry {
  if (!Number.isFinite(r.amount) || r.amount < 0) throw new Error('budget: the amount must be a number of zero or more');
  if (!CATEGORY.test(r.category)) throw new Error('budget: invalid category');
  if (!/^[A-Z]{3}$/.test(r.currency)) throw new Error('budget: invalid currency');
  if (!ALLOWED.test(r.allowedBy)) throw new Error('budget: invalid origin of the spend');
  const recurrence = r.recurrence ?? 'once';
  if (!RECURRENCES.includes(recurrence)) throw new Error('budget: invalid recurrence');
  if (r.nextChargeAt !== undefined && Number.isNaN(Date.parse(r.nextChargeAt))) throw new Error('budget: invalid next charge');
  const at = r.at ?? now.toISOString();
  return {
    id: randomUUID(),
    at,
    category: r.category,
    vendor: plain(r.vendor, LEDGER_LIMITS.vendor),
    amount: r.amount,
    currency: r.currency,
    recurrence,
    ...(r.nextChargeAt !== undefined && recurrence !== 'once' ? { nextChargeAt: new Date(r.nextChargeAt).toISOString() } : {}),
    reason: plain(r.reason, LEDGER_LIMITS.reason),
    allowedBy: r.allowedBy,
    ...(r.auditRef ? { auditRef: plain(r.auditRef, 80) } : {}),
    kind: r.kind,
    ...(r.reconciles ? { reconciles: plain(r.reconciles, 80) } : {}),
  };
}

export function appendEntry(dir: string, entry: LedgerEntry): void {
  mkdirSync(join(dir, LEDGER_DIR), { recursive: true });
  appendFileSync(ledgerPath(dir), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

export function readLedger(dir: string): LedgerEntry[] {
  const file = ledgerPath(dir);
  if (!existsSync(file)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      if (typeof e.id === 'string' && typeof e.amount === 'number' && typeof e.at === 'string' && typeof e.category === 'string') out.push(e);
    } catch {}
  }
  return out;
}

/** A page of the ledger, newest first. */
export function pageOf(entries: readonly LedgerEntry[], offset: number, limit: number): { entries: LedgerEntry[]; total: number; nextOffset: number | null } {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  const start = Math.max(0, Math.floor(offset) || 0);
  const size = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const slice = sorted.slice(start, start + size);
  return { entries: slice, total: sorted.length, nextOffset: start + size < sorted.length ? start + size : null };
}
