import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '../src/shared/contract';
import { cleanAccount } from '../src/shared/accounts';
import { STEP_UP, webAccess } from '../src/main/webPolicy';

// The registry of external accounts (#200): listed with whether each secret reference resolves and never a value, removing one revokes the grants tied to it, the export holds no
// secret, and a provider that is not listed is refused by assertAccount.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-accounts-'));
process.env.CERIMONIAS_DATA_DIR = DATA;
const SECRET_VALUE = 'zk-live-0123456789abcdefSECRETVALUE';
process.env.COXIA_ACCOUNTS_TEST_KEY = SECRET_VALUE;

const { atasDir } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { accountsModule, assertAccount, exportAccounts, listAccounts } = await import('../src/main/accounts');
const { effectGrantsModule, grantFor, noteDecision, noteProposed } = await import('../src/main/effectGrants');
const { secrets } = await import('../src/main/secrets');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');
const { listAudit } = await import('../src/main/auditoria');
const { invoke, handle } = await import('../src/main/rpc');

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const mod = { handle: (c: string, fn: unknown) => void (handlers.set(c, fn as Handler), handle(c, fn as never)), notify: () => undefined, emit: () => undefined, job: () => undefined };
accountsModule(mod);
effectGrantsModule(mod);
const call = (c: string, ...a: unknown[]) => handlers.get(c)?.(...a);

const dns = { id: 'registrar', provider: 'Example-Registrar', purpose: 'domains and DNS', secretRefs: ['reg.key', 'reg.missing'], monthlyCost: 1.25 };

beforeEach(() => {
  rmSync(join(atasDir(), 'autonomy'), { recursive: true, force: true });
  updateConfig((c) => ({ ...c, accounts: [], effects: { offerAfter: 1, perKind: {} } }));
  secrets().set({ ref: 'reg.key', source: 'env', name: 'COXIA_ACCOUNTS_TEST_KEY' });
});

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

describe('the registry', () => {
  it('adds an account and lists it with whether each reference resolves, never a value', () => {
    call('accounts:add', dns);
    const [a] = listAccounts();
    expect(a).toMatchObject({ id: 'registrar', provider: 'example-registrar', purpose: 'domains and DNS', monthlyCost: 1.25 });
    expect(a.refs).toEqual([{ ref: 'reg.key', resolves: true }, { ref: 'reg.missing', resolves: false }]);
    expect(JSON.stringify(call('accounts:list'))).not.toContain(SECRET_VALUE);
    expect(listAudit().some((l) => l.target === 'accounts:add:registrar')).toBe(true);
  });

  it('refuses a duplicate, a bad id and a reference that is not one', () => {
    call('accounts:add', dns);
    expect(() => call('accounts:add', dns)).toThrow();
    expect(() => call('accounts:add', { ...dns, id: 'Bad Id' })).toThrow();
    expect(() => call('accounts:add', { ...dns, id: 'other', secretRefs: ['has a space'] })).toThrow();
    expect(() => cleanAccount({ ...dns, monthlyCost: -1 })).toThrow();
    expect(getConfig().accounts).toHaveLength(1);
  });

  it('updates and removes', () => {
    call('accounts:add', dns);
    call('accounts:update', 'registrar', { purpose: 'domains', monthlyCost: 2 });
    expect(getConfig().accounts?.[0]).toMatchObject({ purpose: 'domains', monthlyCost: 2, provider: 'example-registrar' });
    expect(() => call('accounts:update', 'nope', {})).toThrow();
    call('accounts:remove', 'registrar');
    expect(getConfig().accounts).toEqual([]);
  });

  it('exports every field without any secret value', () => {
    call('accounts:add', { ...dns, notes: 'billing contact is the maintainer' });
    const out = JSON.stringify(exportAccounts());
    expect(out).toContain('reg.key');
    expect(out).not.toContain(SECRET_VALUE);
    expect(out).toContain('billing contact');
  });
});

describe('assertAccount', () => {
  it('refuses a provider that is not in the registry and accepts one that is, in any case', () => {
    expect(() => assertAccount('example-registrar')).toThrow(/registry|registro/);
    call('accounts:add', dns);
    expect(assertAccount('EXAMPLE-registrar ').id).toBe('registrar');
    expect(() => assertAccount('another-provider')).toThrow();
    expect(() => assertAccount('')).toThrow();
  });
});

describe('grants tied to an account', () => {
  const earn = (kind: 'dns' | 'comment') => {
    noteProposed(kind);
    noteDecision(kind, `a-${kind}`, 'approved');
  };

  it('removing the account revokes every grant tied to it, audited, and leaves the others', () => {
    call('accounts:add', dns);
    call('accounts:add', { id: 'monitoring', provider: 'example-monitor', purpose: 'alerts', secretRefs: [] });
    earn('dns');
    earn('comment');
    const tied = call('autonomy:grant', 'dns', undefined, 'registrar') as { id: string; accountId: string };
    const other = call('autonomy:grant', 'comment', undefined, 'monitoring') as { id: string };
    expect(tied.accountId).toBe('registrar');
    expect(listAccounts().find((a) => a.id === 'registrar')?.grants).toEqual([{ id: tied.id, kind: 'dns' }]);
    const out = call('accounts:remove', 'registrar') as { revoked: { id: string }[] };
    expect(out.revoked).toEqual([{ id: tied.id, kind: 'dns' }]);
    expect(grantFor('dns')).toBeNull();
    expect(grantFor('comment')?.id).toBe(other.id);
    expect(listAudit().some((l) => l.kind === 'autonomy' && l.fields.op === 'account' && l.fields.account === 'registrar')).toBe(true);
  });

  it('a grant whose account left the registry some other way (a config save) no longer stands', () => {
    call('accounts:add', dns);
    earn('dns');
    call('autonomy:grant', 'dns', undefined, 'registrar');
    expect(grantFor('dns')).not.toBeNull();
    updateConfig((c) => ({ ...c, accounts: [] }));
    expect(grantFor('dns')).toBeNull();
  });

  it('refuses a grant tied to an account that is not there', () => {
    earn('dns');
    expect(() => call('autonomy:grant', 'dns', undefined, 'ghost')).toThrow();
  });
});

describe('who may call', () => {
  it('has the channels in the contract; a paired browser reads, an admin device writes with the secret passkey', async () => {
    for (const c of ['accounts:add', 'accounts:update', 'accounts:remove', 'accounts:list', 'accounts:export']) expect(CHANNELS).toContain(c);
    expect(webAccess('accounts:list')).toBe('allow');
    expect(webAccess('accounts:export')).toBe('allow');
    for (const c of ['accounts:add', 'accounts:update', 'accounts:remove', 'accounts:other']) {
      expect(webAccess(c)).toBe('deny');
      expect(webAccess(c, true)).toBe('allow');
    }
    expect(STEP_UP.get('accounts:add')).toBe('secret');
    expect(STEP_UP.get('accounts:remove')).toBe('secret');
    expect(await invoke('accounts:list', [], 'dev-1')).toEqual([]);
  });
});
