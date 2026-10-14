import { ContractError } from '../shared/contract';
import { AccountInputError, ACCOUNTS_MAX, cleanAccount, providerKey } from '../shared/accounts';
import type { ExternalAccount } from '../shared/config/types';
import { t } from '../shared/i18n';
import { recordWrite } from './auditoria';
import { configAuditEntry } from './configAudit';
import { readGrants, revokeForAccount } from './effectGrants';
import type { Module } from './module';
import { viaOf } from './rpc';
import { secrets } from './secrets';
import { getConfig, updateConfig } from './workspaceConfig';

// The registry of the external accounts Coxia acts in (#200), kept in the workspace's configuration. The person opens every account; the registry only says which ones exist,
// which secret references they use (and whether those resolve, never their values), what they cost and which grants of autonomy are tied to them.

export const accounts = (): ExternalAccount[] => getConfig().accounts ?? [];

/**
 * Throws unless `provider` is in the registry. The door of every integration that acts in an external provider (provisioning, email, DNS ...) before it reaches for a credential:
 * an agent cannot act on a provider the person did not list. The code host of a workspace is listed by the migration, so it keeps working.
 */
export function assertAccount(provider: string): ExternalAccount {
  const key = providerKey(String(provider ?? ''));
  const found = key ? accounts().find((a) => a.provider === key) : undefined;
  if (!found) throw new ContractError('forbidden', t('main.accounts.unknownProvider', { provider: key || '?' }));
  return found;
}

/** The account of the registry with this id, or a `forbidden` refusal: the door of a request for an effect that names the account it acts in. */
export function assertAccountId(id: string): ExternalAccount {
  const found = accounts().find((a) => a.id === id);
  if (!found) throw new ContractError('forbidden', t('main.accounts.unknownAccountId', { id: String(id).slice(0, 64) }));
  return found;
}

export interface AccountView extends ExternalAccount {
  /** For each reference: whether it resolves right now. Never the value. */
  refs: { ref: string; resolves: boolean }[];
  /** The grants of autonomy tied to the account. */
  grants: { id: string; kind: string }[];
}

export function listAccounts(): AccountView[] {
  const store = secrets();
  const grants = readGrants();
  return accounts().map((a) => ({
    ...a,
    refs: a.secretRefs.map((ref) => ({ ref, resolves: store.check(ref).ok })),
    grants: grants.filter((g) => g.accountId === a.id).map((g) => ({ id: g.id, kind: g.kind })),
  }));
}

/** The registry as a file a person keeps or shares: references and everything else, never a value. */
export function exportAccounts(): { version: 1; exportedAt: string; accounts: ExternalAccount[] } {
  return { version: 1, exportedAt: new Date().toISOString(), accounts: accounts().map((a) => ({ ...a, secretRefs: [...a.secretRefs] })) };
}

function clean(input: unknown): ExternalAccount {
  try {
    return cleanAccount(input);
  } catch (e) {
    if (e instanceof AccountInputError) throw new ContractError('invalid-input', t('main.accounts.invalid', { field: e.field }));
    throw e;
  }
}

function audit(op: string, a: Pick<ExternalAccount, 'id' | 'provider'>, extra: Record<string, string> = {}): void {
  recordWrite({ kind: 'config', issue: 0, target: `accounts:${op}:${a.id}`, via: viaOf(), fields: { op, account: a.id, provider: a.provider, ...extra }, ok: true, code: null, result: '', origin: { actionId: '', kind: 'accounts', key: `${op}:${a.id}`, summary: null }, by: null });
}

function save(change: (list: ExternalAccount[]) => ExternalAccount[]): void {
  const before = getConfig();
  updateConfig((c) => ({ ...c, accounts: change(c.accounts ?? []) }));
  try {
    const line = configAuditEntry(before, getConfig(), { op: 'save', via: viaOf() });
    if (line) recordWrite(line);
  } catch (e) {
    console.error('[accounts] audit', e instanceof Error ? e.message : e);
  }
}

const notPersona = (): void => {
  if (viaOf() === 'persona') throw new ContractError('forbidden', t('main.accounts.personaRefused'));
};

export const accountsModule: Module = (ctx) => {
  ctx.handle('accounts:list', () => listAccounts());
  ctx.handle('accounts:export', () => exportAccounts());
  // For an external client that acts in a provider (coxia-provision): the registered account of the provider, or `forbidden`. It carries the references and never their values, and
  // nothing else of the registry, so the client does not see every account.
  ctx.handle('accounts:assert', (input: unknown) => {
    notPersona();
    const provider = typeof input === 'object' && input !== null ? (input as { provider?: unknown }).provider : undefined;
    if (typeof provider !== 'string' || !provider.trim() || provider.length > 120) throw new ContractError('invalid-input', t('main.accounts.invalid', { field: 'provider' }));
    const a = assertAccount(provider);
    return { id: a.id, provider: a.provider, secretRefs: [...a.secretRefs] };
  });
  // Opening an account in the registry decides which credentials may be used against which provider, so a paired browser is asked for the passkey of kind `secret` (STEP_UP in
  // webPolicy.ts); the window and the admin socket are not, and the persona never has these channels.
  ctx.handle('accounts:add', (input: unknown) => {
    notPersona();
    const a = clean(input);
    if (accounts().length >= ACCOUNTS_MAX) throw new ContractError('invalid-input', t('main.accounts.tooMany'));
    if (accounts().some((x) => x.id === a.id)) throw new ContractError('conflict', t('main.accounts.exists', { id: a.id }));
    save((list) => [...list, a]);
    audit('add', a);
    ctx.emit({ type: 'module', name: 'accounts:changed', payload: { id: a.id } });
    return listAccounts().find((x) => x.id === a.id);
  });
  ctx.handle('accounts:update', (id: unknown, patch: unknown) => {
    notPersona();
    const current = accounts().find((x) => x.id === id);
    if (!current) throw new ContractError('not-found', t('main.accounts.missing', { id: String(id) }));
    const next = clean({ ...current, ...(typeof patch === 'object' && patch !== null ? patch : {}), id: current.id });
    save((list) => list.map((x) => (x.id === current.id ? next : x)));
    audit('update', next);
    ctx.emit({ type: 'module', name: 'accounts:changed', payload: { id: next.id } });
    return listAccounts().find((x) => x.id === next.id);
  });
  ctx.handle('accounts:remove', (id: unknown) => {
    notPersona();
    const current = accounts().find((x) => x.id === id);
    if (!current) throw new ContractError('not-found', t('main.accounts.missing', { id: String(id) }));
    // Taking an account away takes the autonomy tied to it away first, at once and audited; then the account goes.
    const dropped = revokeForAccount(current.id);
    save((list) => list.filter((x) => x.id !== current.id));
    audit('remove', current, dropped.length ? { revoked: dropped.map((g) => `grant:${g.id}`).join(',') } : {});
    ctx.emit({ type: 'module', name: 'accounts:changed', payload: { id: current.id } });
    return { removed: true, revoked: dropped.map((g) => ({ id: g.id, kind: g.kind })) };
  });
};
