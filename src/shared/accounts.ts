import { SECRET_REF } from './secrets';
import type { ExternalAccount } from './config/types';

// The registry of external accounts (#200): what a person may put in it. Pure; the storage (the workspace config) and the channels are in main/accounts.ts.

export const ACCOUNT_ID = /^[a-z][a-z0-9-]{0,39}$/;
export const ACCOUNTS_MAX = 100;
export const ACCOUNT_LIMITS = { provider: 120, purpose: 300, notes: 1000, secretRefs: 20 } as const;

/** A problem with an account, as a code the caller words (a message key suffix). */
export class AccountInputError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = 'AccountInputError';
  }
}

const text = (v: unknown, field: string, max: number, required: boolean): string => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new AccountInputError(field);
    return '';
  }
  if (typeof v !== 'string' || v.length > max || v.includes('\0')) throw new AccountInputError(field);
  return v.trim();
};

/** The provider's name as it is compared: trimmed and lowercase. */
export const providerKey = (provider: string): string => provider.trim().toLowerCase();

/** An account as the registry keeps it, from what a client sent. Throws `AccountInputError` naming the field. */
export function cleanAccount(input: unknown): ExternalAccount {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ACCOUNT_ID.test(o.id)) throw new AccountInputError('id');
  const provider = providerKey(text(o.provider, 'provider', ACCOUNT_LIMITS.provider, true));
  const purpose = text(o.purpose, 'purpose', ACCOUNT_LIMITS.purpose, true);
  const refsIn = o.secretRefs === undefined ? [] : o.secretRefs;
  if (!Array.isArray(refsIn) || refsIn.length > ACCOUNT_LIMITS.secretRefs) throw new AccountInputError('secretRefs');
  const secretRefs = [...new Set(refsIn.map((r) => (typeof r === 'string' && SECRET_REF.test(r) ? r : (() => { throw new AccountInputError('secretRefs'); })())))];
  const account: ExternalAccount = { id: o.id, provider, purpose, secretRefs };
  if (o.monthlyCost !== undefined && o.monthlyCost !== null) {
    if (typeof o.monthlyCost !== 'number' || !Number.isFinite(o.monthlyCost) || o.monthlyCost < 0 || o.monthlyCost > 1e9) throw new AccountInputError('monthlyCost');
    account.monthlyCost = Math.round(o.monthlyCost * 100) / 100;
  }
  const notes = text(o.notes, 'notes', ACCOUNT_LIMITS.notes, false);
  if (notes) account.notes = notes;
  return account;
}
