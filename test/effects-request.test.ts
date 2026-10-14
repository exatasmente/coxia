import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditKind } from '../src/shared/auditoria';
import { CHANNELS, isErrorCode } from '../src/shared/contract';
import { stepUpOfEffect, isEffectKind } from '../src/shared/effects';
import { cleanRequest, ticketRequestId } from '../src/shared/externalEffects';
import { webAccess } from '../src/main/webPolicy';

// What an external client (coxia-provision, through the admin socket) asks before an effect and records after it (#199): effects:request, effects:settle and accounts:assert. The
// budget answers first, then a grant, then the person in Actions; a ticket is single use, kept on disk, and a settlement over what was allowed is recorded and audited, never refused.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-effects-request-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { atasDir, dataRoot, workspaceId } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { accountsModule } = await import('../src/main/accounts');
const { effectGrantsModule, noteDecision, noteProposed, statusOf } = await import('../src/main/effectGrants');
const { effectsRequestModule } = await import('../src/main/effectsRequest');
const { ledger, recordSpend } = await import('../src/main/budget');
const { listAudit } = await import('../src/main/auditoria');
const { handle, invoke, invokeAdmin, invokePersona } = await import('../src/main/rpc');
const { newActId, runAct } = await import('../src/main/persona/act');
const { setPasskeyHooks } = await import('../src/main/passkeyStepUp');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const mod = { handle: (c: string, fn: unknown) => void (handlers.set(c, fn as Handler), handle(c, fn as never)), notify: () => undefined, emit: () => undefined, job: () => undefined };
accountsModule(mod);
effectGrantsModule(mod);
effectsRequestModule(mod);
handle('actions:approve', ((id: string) => actions.approveAction(id)) as never);
handle('actions:skip', ((id: string) => actions.skipAction(id)) as never);
const call = (c: string, ...a: unknown[]) => handlers.get(c)?.(...a);
const request = (args: Record<string, unknown>) => call('effects:request', args) as { state: string; ticket?: string; allowedBy?: string; proposalId?: string; expiresAt?: string };
const settle = (ticket: string, actual: Record<string, unknown>) => call('effects:settle', { ticket, actual }) as { entryId: string | null; overrun: boolean };

const asReal = () => writeRegistry(dataRoot(), { current: workspaceId(), list: [{ id: workspaceId(), name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
const effectsDir = () => join(atasDir(), 'effects');
const spend = (id: string, extra: Record<string, unknown> = {}) => ({ requestId: id, kind: 'spend', accountId: 'hosting', summary: 'a small server for the demo', amount: 5, currency: 'USD', recurrence: 'monthly', ...extra });
const destroy = (id: string, extra: Record<string, unknown> = {}) => ({ requestId: id, kind: 'destroy', accountId: 'hosting', summary: 'remove the demo server', target: 'srv-42', ...extra });
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: unknown }).code);
  }
  return 'did not throw';
};
const pending = () => actions.listActions().filter((a) => a.kind === 'effect-request' && a.state === 'pending');

/** A track record that earns the offer for a kind, then the grant of the person. */
function grant(kind: 'spend' | 'destroy', threshold?: number, accountId?: string): { id: string } {
  for (let i = 0; i < 2; i++) {
    noteProposed(kind);
    noteDecision(kind, `earn-${kind}-${i}-${Math.random()}`, 'approved');
  }
  return call('autonomy:grant', kind, threshold, accountId) as { id: string };
}

beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(atasDir(), f), { force: true });
  for (const d of ['autonomy', 'effects', 'budget']) rmSync(join(atasDir(), d), { recursive: true, force: true });
  asReal();
  setPasskeyHooks(null);
  updateConfig((c) => ({
    ...c,
    effects: { offerAfter: 1, perKind: {} },
    budget: { currency: 'USD', monthly: 100, categories: {} },
    accounts: [
      { id: 'hosting', provider: 'example-cloud', purpose: 'servers', secretRefs: ['cloud.key'] },
      { id: 'registrar', provider: 'example-registrar', purpose: 'domains', secretRefs: ['reg.key'] },
    ],
  }));
});

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

describe('a request a grant covers', () => {
  it('is allowed at once with a ticket bound to the request, and the grant is named', () => {
    const g = grant('spend', 20, 'hosting');
    const a = request(spend('req-grant-1'));
    expect(a).toMatchObject({ state: 'allowed', allowedBy: `grant:${g.id}` });
    expect(a.ticket).toMatch(/^req-grant-1\./);
    expect(ticketRequestId(a.ticket as string)).toBe('req-grant-1');
    expect(Date.parse(a.expiresAt as string) - Date.now()).toBeGreaterThan(3_500_000);
    expect(Date.parse(a.expiresAt as string) - Date.now()).toBeLessThanOrEqual(3_600_000);
    expect(pending()).toHaveLength(0);
    const line = listAudit().find((l) => l.target === 'effects:allow:spend');
    expect(line).toMatchObject({ grant: `grant:${g.id}`, fields: { requestId: 'req-grant-1', provider: 'example-cloud' } });
    expect(statusOf().find((s) => s.kind === 'spend')?.record.autonomous).toBe(1);
  });

  it('asks again when the amount is over the grant, or the grant is tied to another account', () => {
    grant('spend', 20, 'registrar');
    expect(request(spend('req-other-acct')).state).toBe('pending');
    expect(request(spend('req-over', { accountId: 'registrar', amount: 25 })).state).toBe('pending');
    expect(request(spend('req-inside', { accountId: 'registrar', amount: 20 })).state).toBe('allowed');
  });

  it('covers a destroy with a grant of its own kind, a count per hour', () => {
    const g = grant('destroy', 1);
    expect(request(destroy('req-destroy-1'))).toMatchObject({ state: 'allowed', allowedBy: `grant:${g.id}` });
    expect(request(destroy('req-destroy-2')).state).toBe('pending');
  });
});

describe('a request nothing covers', () => {
  it('waits in Actions, is allowed after the person approves and a ticket comes with the next call', async () => {
    const first = request(spend('req-ask-1'));
    expect(first.state).toBe('pending');
    const [card] = pending();
    expect(card).toMatchObject({ id: first.proposalId, kind: 'effect-request', summary: 'a small server for the demo' });
    expect(card.unit).toMatchObject({ effect: 'spend', amount: 5, provider: 'example-cloud' });
    expect(request(spend('req-ask-1'))).toEqual(first);
    expect(pending()).toHaveLength(1);
    await actions.approveAction(card.id);
    const done = request(spend('req-ask-1'));
    expect(done).toMatchObject({ state: 'allowed', allowedBy: 'person' });
    expect(request(spend('req-ask-1'))).toEqual(done);
    expect(listAudit().some((l) => l.kind === 'decision' && l.origin.actionId === card.id)).toBe(true);
    expect(statusOf().find((s) => s.kind === 'spend')?.record).toMatchObject({ proposed: 1, approved: 1 });
  });

  it('is refused for good after the person says no', async () => {
    const { proposalId } = request(spend('req-no-1'));
    await actions.skipAction(proposalId as string);
    expect(codeOf(() => request(spend('req-no-1')))).toBe('forbidden');
    expect(codeOf(() => request(spend('req-no-1')))).toBe('forbidden');
    expect(statusOf().find((s) => s.kind === 'spend')?.record.refused).toBe(1);
  });

  it('is set aside when nobody answers in time, without counting as a refusal of the person', () => {
    const { proposalId } = request(spend('req-late-1'));
    const file = join(effectsDir(), 'req-late-1.json');
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...rec, until: new Date(Date.now() - 1000).toISOString() }));
    expect(codeOf(() => request(spend('req-late-1')))).toBe('forbidden');
    expect(actions.listActions().find((a) => a.id === proposalId)?.state).toBe('skipped');
    expect(statusOf().find((s) => s.kind === 'spend')?.record.refused).toBe(0);
  });
});

describe('the budget comes first', () => {
  it('refuses a spend that does not fit before anyone is asked, and audits the scope', () => {
    updateConfig((c) => ({ ...c, budget: { currency: 'USD', monthly: 10, categories: {} } }));
    expect(codeOf(() => request(spend('req-big-1', { amount: 20 })))).toBe('budget-exceeded');
    expect(pending()).toHaveLength(0);
    expect(existsSync(effectsDir())).toBe(false);
    expect(listAudit().find((l) => l.kind === 'spend' && l.result === 'budget-exceeded')?.fields.scope).toBe('month');
  });

  it('is not overridden by a grant', () => {
    grant('spend', 50, 'hosting');
    updateConfig((c) => ({ ...c, budget: { currency: 'USD', monthly: 10, categories: {} } }));
    expect(codeOf(() => request(spend('req-big-2', { amount: 20 })))).toBe('budget-exceeded');
  });

  it('is not overridden by the person: a yes that comes after the limit was reached is a refusal', async () => {
    updateConfig((c) => ({ ...c, budget: { currency: 'USD', monthly: 10, categories: {} } }));
    const { proposalId } = request(spend('req-late-yes', { amount: 8 }));
    recordSpend({ category: 'infrastructure', vendor: 'someone', amount: 9, currency: 'USD', reason: 'spent meanwhile', allowedBy: 'person', kind: 'reconciled' });
    await actions.approveAction(proposalId as string);
    expect(codeOf(() => request(spend('req-late-yes', { amount: 8 })))).toBe('budget-exceeded');
    expect(codeOf(() => request(spend('req-late-yes', { amount: 8 })))).toBe('budget-exceeded');
  });
});

describe('the idempotency key', () => {
  it('returns the same state and ticket for the same arguments, and conflict for others', () => {
    grant('spend', 20, 'hosting');
    const a = request(spend('req-idem-1'));
    expect(request(spend('req-idem-1'))).toEqual(a);
    expect(codeOf(() => request(spend('req-idem-1', { amount: 6 })))).toBe('conflict');
    expect(codeOf(() => request(spend('req-idem-1', { summary: 'something else' })))).toBe('conflict');
    expect(statusOf().find((s) => s.kind === 'spend')?.record.autonomous).toBe(1);
  });

  it('treats the defaults as the arguments they stand for', () => {
    grant('spend', 20, 'hosting');
    const a = request({ requestId: 'req-idem-2', kind: 'spend', accountId: 'hosting', summary: 's', amount: 1, currency: 'USD' });
    expect(request({ requestId: 'req-idem-2', kind: 'spend', accountId: 'hosting', summary: 's', amount: 1, currency: 'USD', category: 'infrastructure', recurrence: 'once' })).toEqual(a);
  });
});

describe('who and what is refused', () => {
  it('refuses an account that is not in the registry, with nothing asked or kept', () => {
    expect(codeOf(() => request(spend('req-acct-1', { accountId: 'nobody' })))).toBe('forbidden');
    expect(pending()).toHaveLength(0);
    expect(existsSync(effectsDir())).toBe(false);
  });

  it('refuses a bad field, a currency that is not the budget, a negative amount, and a kind a client may not ask for', () => {
    for (const bad of [{ requestId: 'short' }, { amount: -1 }, { amount: Number.NaN }, { amount: undefined }, { currency: 'EUR' }, { kind: 'dns' }, { category: 'Bad Category' }, { recurrence: 'weekly' }, { summary: '' }, { summary: 'x'.repeat(201) }]) {
      expect(codeOf(() => request(spend('req-bad-1', bad))), JSON.stringify(bad)).toBe('invalid-input');
    }
    expect(codeOf(() => request(destroy('req-bad-2', { amount: 1 })))).toBe('invalid-input');
    expect(codeOf(() => call('effects:request', 'nope'))).toBe('invalid-input');
  });

  it('masks what looks like a credential in the words the person is shown', () => {
    const { proposalId } = request(spend('req-mask-1', { summary: 'server, token=abcdef0123456789abcdef' }));
    expect(JSON.stringify(actions.listActions().find((a) => a.id === proposalId))).not.toContain('abcdef0123456789abcdef');
  });

  it('refuses a test workspace, which writes nothing outside', () => {
    writeRegistry(dataRoot(), { current: workspaceId(), list: [{ id: workspaceId(), name: 'work', createdAt: '2026-10-01T00:00:00Z', test: true }] });
    expect(codeOf(() => request(spend('req-test-1')))).toBe('forbidden');
    expect(pending()).toHaveLength(0);
  });
});

describe('settling', () => {
  it('writes the ledger line with the category, the vendor, the recurrence, the reason and who allowed it, once', () => {
    const g = grant('spend', 20, 'hosting');
    const { ticket } = request(spend('req-settle-1'));
    const out = settle(ticket as string, { amount: 4.5, currency: 'USD', reference: 'srv-42' });
    expect(out).toMatchObject({ overrun: false, entryId: expect.any(String) });
    const entry = ledger().find((e) => e.id === out.entryId);
    expect(entry).toMatchObject({ category: 'infrastructure', vendor: 'example-cloud', amount: 4.5, currency: 'USD', recurrence: 'monthly', reason: 'a small server for the demo', allowedBy: `grant:${g.id}`, kind: 'estimated' });
    expect(listAudit().find((l) => l.target === 'effects:settle:spend')?.fields).toMatchObject({ reference: 'srv-42', overrun: 'false', entry: out.entryId });
    expect(codeOf(() => settle(ticket as string, { amount: 4.5, currency: 'USD' }))).toBe('conflict');
    expect(ledger()).toHaveLength(1);
    expect(codeOf(() => request(spend('req-settle-1')))).toBe('conflict');
  });

  it('records a reconciled amount as reconciled and a person as the one who allowed it', async () => {
    const { proposalId } = request(spend('req-settle-2'));
    await actions.approveAction(proposalId as string);
    const { ticket } = request(spend('req-settle-2'));
    const out = settle(ticket as string, { amount: 5, currency: 'USD', kind: 'reconciled' });
    expect(ledger().find((e) => e.id === out.entryId)).toMatchObject({ allowedBy: 'person', kind: 'reconciled' });
  });

  it('closes the ticket with nothing spent for an amount of zero', () => {
    grant('spend', 20, 'hosting');
    const { ticket } = request(spend('req-settle-3'));
    expect(settle(ticket as string, { amount: 0, currency: 'USD' })).toEqual({ entryId: null, overrun: false });
    expect(ledger()).toHaveLength(0);
    expect(listAudit().some((l) => l.target === 'effects:settle:spend')).toBe(true);
    expect(codeOf(() => settle(ticket as string, { amount: 0, currency: 'USD' }))).toBe('conflict');
  });

  it('records an amount over the authorized one, audits it as an overrun and never refuses', () => {
    grant('spend', 20, 'hosting');
    const { ticket } = request(spend('req-over-1', { amount: 5 }));
    const out = settle(ticket as string, { amount: 7.25, currency: 'USD' });
    expect(out.overrun).toBe(true);
    expect(ledger().find((e) => e.id === out.entryId)?.amount).toBe(7.25);
    const line = listAudit().find((l) => l.target === 'effects:settle:spend');
    expect(line).toMatchObject({ result: 'overrun', fields: { overrun: 'true', authorized: '5', amount: '7.25' } });
  });

  it('records an overrun even when it passes the budget', () => {
    grant('spend', 20, 'hosting');
    updateConfig((c) => ({ ...c, budget: { currency: 'USD', monthly: 6, categories: {} } }));
    const { ticket } = request(spend('req-over-2', { amount: 5 }));
    expect(settle(ticket as string, { amount: 50, currency: 'USD' })).toMatchObject({ overrun: true });
    expect(ledger()[0].amount).toBe(50);
  });

  it('is not-found for an expired, an unknown, a forged or a not yet allowed ticket', () => {
    grant('spend', 20, 'hosting');
    const { ticket } = request(spend('req-exp-1'));
    const file = join(effectsDir(), 'req-exp-1.json');
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    expect(codeOf(() => settle(`req-exp-1.${'x'.repeat(24)}`, { amount: 1, currency: 'USD' }))).toBe('not-found');
    writeFileSync(file, JSON.stringify({ ...rec, until: new Date(Date.now() - 1000).toISOString() }));
    expect(codeOf(() => settle(ticket as string, { amount: 1, currency: 'USD' }))).toBe('not-found');
    expect(codeOf(() => settle('nothing.at-all-here', { amount: 1, currency: 'USD' }))).toBe('not-found');
    const waiting = request(spend('req-exp-2', { amount: 30 }));
    expect(waiting.state).toBe('pending');
    expect(codeOf(() => settle('req-exp-2.whatever-it-is-then', { amount: 1, currency: 'USD' }))).toBe('not-found');
    expect(ledger()).toHaveLength(0);
  });

  it('refuses a negative or non finite amount and a currency that is not the budget', () => {
    grant('spend', 20, 'hosting');
    const { ticket } = request(spend('req-inv-1'));
    for (const actual of [{ amount: -1, currency: 'USD' }, { amount: Number.POSITIVE_INFINITY, currency: 'USD' }, { amount: 1, currency: 'EUR' }, { amount: 1, currency: 'USD', kind: 'guessed' }]) {
      expect(codeOf(() => settle(ticket as string, actual))).toBe('invalid-input');
    }
    expect(settle(ticket as string, { amount: 1, currency: 'USD' }).overrun).toBe(false);
  });
});

describe('destroy', () => {
  it('is a kind with the infrastructure passkey, and a label', () => {
    expect(isEffectKind('destroy')).toBe(true);
    expect(stepUpOfEffect('destroy')).toBe('infrastructure');
    expect(statusOf().find((s) => s.kind === 'destroy')).toMatchObject({ stepUp: 'infrastructure', amountThreshold: false });
  });

  it('with no grant is a pending proposal that a yes from the computer lets through', async () => {
    const first = request(destroy('req-dstr-1'));
    expect(first.state).toBe('pending');
    const [card] = pending();
    expect(card.unit).toMatchObject({ effect: 'destroy', target: 'srv-42', amount: null });
    await actions.approveAction(card.id);
    const done = request(destroy('req-dstr-1'));
    expect(done).toMatchObject({ state: 'allowed', allowedBy: 'person' });
    expect(settle(done.ticket as string, { amount: 0, currency: 'USD' })).toEqual({ entryId: null, overrun: false });
  });

  it('is approved from a paired browser only by an admin device with a fresh passkey of kind infrastructure', async () => {
    const spent: string[] = [];
    setPasskeyHooks({ hasPasskey: (d) => d === 'admin-dev', spend: (_d, assertion, kind) => (assertion === 'good' && kind === 'infrastructure' ? (spent.push(kind), true) : false) });
    const { proposalId } = request(destroy('req-dstr-2'));
    await expect(invoke('actions:approve', [proposalId], 'plain-dev')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(invoke('actions:approve', [proposalId], 'admin-dev')).rejects.toMatchObject({ code: 'passkey-required' });
    await expect(invoke('actions:approve', [proposalId], 'admin-dev', { assertionId: 'for-a-budget' })).rejects.toMatchObject({ code: 'passkey-required' });
    expect(actions.listActions().find((a) => a.id === proposalId)?.state).toBe('pending');
    await invoke('actions:approve', [proposalId], 'admin-dev', { assertionId: 'good' });
    expect(spent).toEqual(['infrastructure']);
    expect(request(destroy('req-dstr-2')).state).toBe('allowed');
  });

  it('leaves the approval of a spend as it was for a paired browser', async () => {
    setPasskeyHooks({ hasPasskey: () => false, spend: () => false });
    const { proposalId } = request(spend('req-dstr-3'));
    await invoke('actions:approve', [proposalId], 'plain-dev');
    expect(request(spend('req-dstr-3')).state).toBe('allowed');
  });

  it('may be refused from anywhere that can see it', async () => {
    const { proposalId } = request(destroy('req-dstr-4'));
    await invoke('actions:skip', [proposalId], 'plain-dev');
    expect(codeOf(() => request(destroy('req-dstr-4')))).toBe('forbidden');
  });
});

describe('accounts:assert', () => {
  it('answers the registered account of a provider, case-insensitive, with references and no value', () => {
    expect(call('accounts:assert', { provider: ' Example-Cloud ' })).toEqual({ id: 'hosting', provider: 'example-cloud', secretRefs: ['cloud.key'] });
  });

  it('is forbidden for a provider nobody opened, and invalid for no provider', () => {
    expect(codeOf(() => call('accounts:assert', { provider: 'unlisted' }))).toBe('forbidden');
    expect(codeOf(() => call('accounts:assert', {}))).toBe('invalid-input');
    expect(codeOf(() => call('accounts:assert', 'example-cloud'))).toBe('invalid-input');
  });
});

describe('who may call', () => {
  const channels = ['effects:request', 'effects:settle', 'accounts:assert'];

  it('has the channels in the contract and the codes it answers with in the closed list', () => {
    for (const c of channels) expect(CHANNELS).toContain(c);
    for (const code of ['budget-exceeded', 'forbidden', 'passkey-required', 'invalid-input', 'conflict', 'not-owner', 'not-found', 'internal']) expect(isErrorCode(code)).toBe(true);
  });

  it('denies a paired browser, an admin device included', () => {
    for (const c of [...channels, 'effects:other']) {
      expect(webAccess(c), c).toBe('deny');
      expect(webAccess(c, true), c).toBe('deny');
    }
  });

  it('refuses the persona, which has no way to the handlers', () => {
    const act = { open: true, id: newActId(), door: 'window' as const, said: '', mask: (x: string) => x, wrote: { count: 0, kinds: new Set<AuditKind>() } };
    for (const [c, args] of [['effects:request', [spend('req-persona-1')]], ['effects:settle', [{ ticket: 'req-persona-1.abcdefghijkl', actual: { amount: 0, currency: 'USD' } }]], ['accounts:assert', [{ provider: 'example-cloud' }]]] as const) {
      expect(() => runAct(act, () => invokePersona(c, [...args])), c).toThrow(/persona/i);
    }
    act.open = false;
    expect(pending()).toHaveLength(0);
  });

  it('answers the admin door with the window rights', async () => {
    grant('spend', 20, 'hosting');
    await expect(invokeAdmin('effects:request', [spend('req-admin-1')])).resolves.toMatchObject({ state: 'allowed' });
    expect(listAudit().find((l) => l.target === 'effects:allow:spend')?.via).toBe('admin');
  });
});

describe('what is kept on disk', () => {
  it('is one file per request in the workspace, with no mode that others can read, and no secret in it', () => {
    grant('spend', 20, 'hosting');
    request(spend('req-disk-1'));
    expect(readdirSync(effectsDir())).toEqual(['req-disk-1.json']);
    expect(statSync(join(effectsDir(), 'req-disk-1.json')).mode & 0o077).toBe(0);
  });

  it('cleans the shape of a request the same way on both sides', () => {
    expect(cleanRequest({ requestId: 'abcdefgh', kind: 'destroy', accountId: ' hosting ', summary: ' a   b ' }, 'USD')).toMatchObject({ accountId: 'hosting', summary: 'a b', amount: null, category: 'infrastructure', recurrence: 'once' });
    expect(getConfig().budget?.currency).toBe('USD');
  });
});
