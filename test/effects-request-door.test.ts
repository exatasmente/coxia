// The channels an external client uses to ask before an effect (#199), end to end over the local admin socket of a core started in a temporary folder: ask, be told to wait,
// the person's yes through Actions, the ticket, the settlement in the ledger. Only a local socket in a temp folder.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { type Socket, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

let sandbox = '';
let dataDir = '';
let cleanup: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  vi.resetModules();
  sandbox = mkdtempSync(join(tmpdir(), 'cxe-'));
  dataDir = join(sandbox, 'data');
  mkdirSync(dataDir);
  cleanup = [];
});
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function boot() {
  (await import('../src/shared/i18n')).setLanguage('en');
  const m = { ...(await import('../src/main/core')), env: await import('../src/main/env'), door: await import('../src/shared/adminDoor'), contract: await import('../src/shared/contract') };
  const core = m.createCoxia({ dataDir, adminDoor: true });
  cleanup.push(() => core.stop({ deadlineMs: 500 }));
  await core.start();
  return { ...m, path: join(m.env.atasDir(), m.door.ADMIN_SOCKET_NAME) };
}

type Line = Record<string, any>;

/** A client of the socket: says hello, then `call` sends one channel and waits for its answer. */
async function client(path: string, version: number) {
  const socket: Socket = connect(path);
  socket.setEncoding('utf8');
  const lines: Line[] = [];
  const waiting: Array<() => void> = [];
  let buf = '';
  socket.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
    for (const w of waiting.splice(0)) w();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  cleanup.push(() => void socket.destroy());
  const next = async (match: (l: Line) => boolean): Promise<Line> => {
    for (;;) {
      const i = lines.findIndex(match);
      if (i >= 0) return lines.splice(i, 1)[0];
      await new Promise<void>((r) => waiting.push(r));
    }
  };
  socket.write(`${JSON.stringify({ hello: version })}\n`);
  await next((l) => 'hello' in l);
  let id = 0;
  return async (channel: string, ...args: unknown[]): Promise<Line> => {
    const mine = ++id;
    socket.write(`${JSON.stringify({ id: mine, channel, args })}\n`);
    return next((l) => l.id === mine);
  };
}

const ask = { requestId: 'door-req-0001', kind: 'spend', accountId: 'hosting', summary: 'a small server for the demo', amount: 5, currency: 'USD', recurrence: 'monthly' };

describe('over the admin socket', () => {
  it('asks, waits for the person, gets a ticket, settles into the ledger and cannot settle twice', async () => {
    const { path, contract } = await boot();
    const call = await client(path, contract.CONTRACT_VERSION);

    expect(await call('accounts:assert', { provider: 'example-cloud' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect((await call('accounts:add', { id: 'hosting', provider: 'Example-Cloud', purpose: 'servers', secretRefs: ['cloud.key'] })).ok).toBe(true);
    expect(await call('accounts:assert', { provider: 'example-cloud' })).toMatchObject({ ok: true, value: { id: 'hosting', provider: 'example-cloud', secretRefs: ['cloud.key'] } });

    expect((await call('budget:set', { monthly: 12, categories: {} })).ok).toBe(true);
    expect(await call('effects:request', { ...ask, amount: 20 })).toMatchObject({ ok: false, error: { code: 'budget-exceeded' } });

    const waiting = await call('effects:request', ask);
    expect(waiting).toMatchObject({ ok: true, value: { state: 'pending' } });
    const proposalId = waiting.value.proposalId as string;
    expect(await call('effects:request', ask)).toMatchObject({ ok: true, value: { state: 'pending', proposalId } });
    expect(await call('effects:request', { ...ask, amount: 6 })).toMatchObject({ ok: false, error: { code: 'conflict' } });

    const listed = (await call('actions:list')).value as { id: string; kind: string; state: string }[];
    expect(listed.find((a) => a.id === proposalId)).toMatchObject({ kind: 'effect-request', state: 'pending' });
    expect((await call('actions:approve', proposalId)).ok).toBe(true);

    const allowed = await call('effects:request', ask);
    expect(allowed).toMatchObject({ ok: true, value: { state: 'allowed', allowedBy: 'person' } });
    const ticket = allowed.value.ticket as string;

    const settled = await call('effects:settle', { ticket, actual: { amount: 5.5, currency: 'USD', reference: 'srv-1' } });
    expect(settled).toMatchObject({ ok: true, value: { overrun: true, entryId: expect.any(String) } });
    expect(await call('effects:settle', { ticket, actual: { amount: 5.5, currency: 'USD' } })).toMatchObject({ ok: false, error: { code: 'conflict' } });

    const page = (await call('budget:ledger', 0, 10)).value as { entries?: any[]; items?: any[] };
    const entries = page.entries ?? page.items ?? [];
    expect(entries.find((e) => e.id === settled.value.entryId)).toMatchObject({ vendor: 'example-cloud', category: 'infrastructure', allowedBy: 'person', amount: 5.5, kind: 'estimated' });

    for (const code of ['budget-exceeded', 'forbidden', 'conflict', 'not-found', 'invalid-input']) expect(contract.isErrorCode(code)).toBe(true);
  });

  it('answers a destroy with a pending proposal and closes it with a settlement of zero', async () => {
    const { path, contract } = await boot();
    const call = await client(path, contract.CONTRACT_VERSION);
    await call('accounts:add', { id: 'hosting', provider: 'example-cloud', purpose: 'servers', secretRefs: [] });
    const destroy = { requestId: 'door-req-0002', kind: 'destroy', accountId: 'hosting', summary: 'remove the demo server', target: 'srv-1' };
    const waiting = await call('effects:request', destroy);
    expect(waiting.value.state).toBe('pending');
    await call('actions:approve', waiting.value.proposalId);
    const allowed = await call('effects:request', destroy);
    expect(allowed).toMatchObject({ ok: true, value: { state: 'allowed', allowedBy: 'person' } });
    expect(await call('effects:settle', { ticket: allowed.value.ticket, actual: { amount: 0, currency: 'USD' } })).toMatchObject({ ok: true, value: { entryId: null, overrun: false } });
  });
});
