import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VcsCommand } from '../src/shared/types';
import type { AuditKind } from '../src/shared/auditoria';
import { effectOfAction, effectOfCommand } from '../src/shared/effects';
import { CHANNELS } from '../src/shared/contract';
import { STEP_UP, webAccess } from '../src/main/webPolicy';
import { GITLAB_SETTINGS as _unused, fakeGitlabRuntime } from './helpers/vcs';

// Autonomy per kind of external effect (#199): every kind asks until the person grants it; the offer is earned by approved, unreverted proposals; a grant lets the next action
// of its kind run inside its threshold, audited with the grant's id; a revocation or an incident stops the very next one.

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-effects-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { atasDir, dataRoot, workspaceId } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { effectGrantsModule, authorizeSpend, grantFor, statusOf } = await import('../src/main/effectGrants');
const { handle, invoke, invokeAdmin, invokePersona } = await import('../src/main/rpc');
const { newActId, runAct } = await import('../src/main/persona/act');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const notices: { title: string; body: string }[] = [];
effectGrantsModule({ handle: (c, fn) => void (handlers.set(c, fn as Handler), handle(c, fn as never)), notify: (n) => void notices.push(n), emit: () => undefined, job: () => undefined });
// A call from the window: the handler as the desktop runs it.
const call = (c: string, ...a: unknown[]) => handlers.get(c)?.(...a);

const asReal = () => writeRegistry(dataRoot(), { current: workspaceId(), list: [{ id: workspaceId(), name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
const note = (n: number): VcsCommand => ({ via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/issues/101/notes', fields: { body: `hello ${n}` } });
const propose = (n: number) => actions.proposeVcsAction({ key: `k${n}`, issue: 101, summary: 'Comment', command: note(n) });
const settle = () => new Promise((r) => setTimeout(r, 30));
const comment = () => statusOf().find((s) => s.kind === 'comment')!;

let ran: VcsCommand[];

beforeEach(async () => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(atasDir(), f), { force: true });
  rmSync(join(atasDir(), 'autonomy'), { recursive: true, force: true });
  asReal();
  updateConfig((c) => ({ ...c, effects: { offerAfter: 2, perKind: {} }, runner: { ...c.runner, autonomy: { ...c.runner.autonomy, cycle: false, push: false, pullRequest: false } } }));
  notices.length = 0;
  ran = [];
  setVcsRuntimeForTests(
    fakeGitlabRuntime(async () => ({}), undefined, async (command, meta) => {
      ran.push(command);
      if (meta) meta.code = 201;
      return 'ok';
    }),
  );
});

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

/** Proposes and approves `n` comments: a track record of approved proposals. */
async function earn(n: number, from = 1): Promise<void> {
  for (let i = from; i < from + n; i++) await actions.approveAction(propose(i)!.id);
}

describe('the kinds', () => {
  it('reads a kind from the action: pushes, pull requests, reviews, comments, the rest of the tracker', () => {
    expect(effectOfAction({ kind: 'run-push' })).toBe('push');
    expect(effectOfAction({ kind: 'release-git', unit: { op: 'push-tag' } })).toBe('push');
    expect(effectOfAction({ kind: 'release-git', unit: { op: 'merge-pr' } })).toBe('pull-request');
    expect(effectOfAction({ kind: 'release-git', unit: { op: 'stable' } })).toBe('deploy');
    expect(effectOfAction({ kind: 'suggest-agent' })).toBeNull();
    expect(effectOfCommand({ method: 'POST', endpoint: 'repos/o/r/pulls' })).toBe('pull-request');
    expect(effectOfCommand({ method: 'POST', endpoint: 'projects/g%2Fp/merge_requests' })).toBe('pull-request');
    expect(effectOfCommand({ method: 'POST', endpoint: 'repos/o/r/pulls/1/reviews' })).toBe('review');
    expect(effectOfCommand({ method: 'POST', endpoint: 'repos/o/r/issues/1/comments' })).toBe('comment');
    expect(effectOfCommand({ method: 'PUT', endpoint: 'projects/g%2Fp/issues/1' })).toBe('tracker');
  });
});

describe('asking, the track record and the offer', () => {
  it('asks when no grant exists: a proposal waits and nothing runs', async () => {
    const a = propose(1)!;
    await settle();
    expect(a.state).toBe('pending');
    expect(actions.listActions()[0].state).toBe('pending');
    expect(ran).toHaveLength(0);
    expect(grantFor('comment')).toBeNull();
    expect(comment()).toMatchObject({ offered: false, grant: null, offerAfter: 2, record: { proposed: 1, approved: 0 } });
  });

  it('counts proposed, approved, refused and offers only after N approved in a row, with N visible', async () => {
    await earn(1);
    expect(comment()).toMatchObject({ offered: false, offerAfter: 2, record: { approved: 1, streak: 1 } });
    await actions.skipAction(propose(2)!.id);
    expect(comment().record).toMatchObject({ proposed: 2, approved: 1, refused: 1 });
    await earn(1, 3);
    expect(comment()).toMatchObject({ offered: true, record: { approved: 2, streak: 2, proposed: 3 } });
  });

  it('takes N from the config, per kind first', async () => {
    updateConfig((c) => ({ ...c, effects: { offerAfter: 9, perKind: { comment: 1 } } }));
    expect(comment().offerAfter).toBe(1);
    expect(statusOf().find((s) => s.kind === 'push')!.offerAfter).toBe(9);
    await earn(1);
    expect(comment().offered).toBe(true);
  });

  it('does not offer again once a revert starts the streak over', async () => {
    const first = propose(1)!;
    await actions.approveAction(first.id);
    await earn(1, 2);
    expect(comment().offered).toBe(true);
    call('autonomy:mark-reverted', first.id);
    expect(comment()).toMatchObject({ offered: false, record: { reverted: 1, streak: 0 } });
    expect(() => call('autonomy:mark-reverted', 'nope')).toThrow();
  });
});

describe('granting', () => {
  it('refuses a grant that was not offered, and unknown kinds', () => {
    expect(() => call('autonomy:grant', 'comment')).toThrow(/not offered|oferecida/);
    expect(() => call('autonomy:grant', 'bogus')).toThrow();
  });

  it('lets the next action of a granted kind run without asking, audited with the grant id', async () => {
    await earn(2);
    const g = call('autonomy:grant', 'comment') as { id: string; grantedBy: string; via: string };
    expect(g).toMatchObject({ grantedBy: 'person', via: 'window' });
    ran.length = 0;
    const a = propose(10)!;
    await settle();
    expect(actions.listActions().find((x) => x.id === a.id)?.state).toBe('done');
    expect(ran).toHaveLength(1);
    const line = listAudit().find((l) => l.kind === 'gitlab' && l.fields.body === 'hello 10');
    expect(line?.grant).toBe(`grant:${g.id}`);
    expect(listAudit().some((l) => l.kind === 'autonomy' && l.fields.op === 'grant')).toBe(true);
    // done on its own does not count toward a new offer
    expect(comment().record).toMatchObject({ autonomous: 1, approved: 2 });
  });

  it('asks above the threshold: a grant of one action an hour covers one, the next waits', async () => {
    await earn(2);
    call('autonomy:grant', 'comment', 1);
    const first = propose(10)!;
    await settle();
    const second = propose(11)!;
    await settle();
    const states = Object.fromEntries(actions.listActions().map((x) => [x.id, x.state]));
    expect(states[first.id]).toBe('done');
    expect(states[second.id]).toBe('pending');
  });

  it('does not run a proposal of the persona on its own, whatever the grant', async () => {
    await earn(2);
    call('autonomy:grant', 'comment');
    const act = { open: true, id: newActId(), door: 'window' as const, said: '', mask: (x: string) => x, wrote: { count: 0, kinds: new Set<AuditKind>() } };
    const a = await runAct(act, () => propose(20));
    act.open = false;
    await settle();
    expect(a?.proposedBy).toBe('persona');
    expect(actions.listActions().find((x) => x.id === a!.id)?.state).toBe('pending');
  });

  it('is refused to the persona, and to a paired browser without the passkey', async () => {
    await earn(2);
    const act = { open: true, id: newActId(), door: 'window' as const, said: '', mask: (x: string) => x, wrote: { count: 0, kinds: new Set<AuditKind>() } };
    expect(() => runAct(act, () => invokePersona('autonomy:grant', ['comment']))).toThrow(/persona/i);
    act.open = false;
    await expect(invoke('autonomy:grant', ['comment'], 'dev-1')).rejects.toMatchObject({ code: 'passkey-required' });
    expect(grantFor('comment')).toBeNull();
    // the local admin socket is the machine itself
    await expect(invokeAdmin('autonomy:grant', ['comment'])).resolves.toMatchObject({ via: 'admin' });
  });
});

describe('taking autonomy back', () => {
  it('revoke stops the very next action of the kind', async () => {
    await earn(2);
    call('autonomy:grant', 'comment');
    expect(call('autonomy:revoke', 'comment')).toEqual({ revoked: true });
    const a = propose(10)!;
    await settle();
    expect(actions.listActions().find((x) => x.id === a.id)?.state).toBe('pending');
    expect(comment()).toMatchObject({ grant: null, offered: false, record: { streak: 0 } });
    expect(call('autonomy:revoke', 'comment')).toEqual({ revoked: false });
  });

  it('an incident revokes the grant, tells the person and is audited', async () => {
    await earn(2);
    call('autonomy:grant', 'comment');
    expect(call('autonomy:incident', 'comment', 'it wrote on the wrong issue')).toEqual({ revoked: true });
    expect(grantFor('comment')).toBeNull();
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain('wrong issue');
    expect(listAudit().some((l) => l.kind === 'autonomy' && l.fields.op === 'incident')).toBe(true);
  });

  it('reverting an action of a granted kind is an incident of the kind', async () => {
    const a = propose(1)!;
    await actions.approveAction(a.id);
    await earn(1, 2);
    call('autonomy:grant', 'comment');
    call('autonomy:mark-reverted', a.id);
    expect(grantFor('comment')).toBeNull();
    expect(notices).toHaveLength(1);
  });
});

describe('who may call', () => {
  it('has the channels in the contract; a paired browser reads, an admin device writes with the passkey of the kind', () => {
    for (const c of ['autonomy:grant', 'autonomy:revoke', 'autonomy:incident', 'autonomy:mark-reverted', 'autonomy:status']) expect(CHANNELS).toContain(c);
    expect(webAccess('autonomy:status')).toBe('allow');
    for (const c of ['autonomy:grant', 'autonomy:revoke', 'autonomy:incident', 'autonomy:mark-reverted', 'autonomy:other']) {
      expect(webAccess(c)).toBe('deny');
      expect(webAccess(c, true)).toBe('allow');
    }
    expect(STEP_UP.get('autonomy:revoke')).toBe('permission');
  });
});

describe('the configuration switches read as grants', () => {
  it('reads runner.autonomy push and pullRequest (with cycle) as grants of the person, recorded as such', () => {
    expect(grantFor('push')).toBeNull();
    updateConfig((c) => ({ ...c, runner: { ...c.runner, autonomy: { ...c.runner.autonomy, cycle: true, push: true } } }));
    expect(grantFor('push')).toMatchObject({ id: 'legacy-push', grantedBy: 'person', via: 'config', legacy: true });
    expect(grantFor('pull-request')).toBeNull();
    expect(statusOf().find((s) => s.kind === 'push')).toMatchObject({ offered: false });
  });

  it('names the grant on the pull request it lets out, and revoking turns the switch off and stops the next one', async () => {
    updateConfig((c) => ({ ...c, runner: { ...c.runner, autonomy: { ...c.runner.autonomy, cycle: true, pullRequest: true } } }));
    const policy = { cycle: true, hostCommands: false, gates: false, push: false, pullRequest: true, level: 'workspace' as const, flow: '' };
    const mr: VcsCommand = { via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/merge_requests', fields: { source_branch: 'b', target_branch: 'main', title: 't' } };
    await actions.runVcsAuto({ issue: 101, key: 'pr1', summary: 'PR', by: 'dev', policy }, mr);
    expect(listAudit().find((l) => l.target.includes('merge_requests'))?.grant).toBe('grant:legacy-pull-request');
    call('autonomy:revoke', 'pull-request');
    expect(getConfig().runner.autonomy.pullRequest).toBe(false);
    await expect(actions.runVcsAuto({ issue: 101, key: 'pr2', summary: 'PR', by: 'dev', policy }, mr)).rejects.toThrow(/No autonomy is granted|Nenhuma autonomia/);
  });
});

describe('spend', () => {
  it('runs a spend under a grant only inside its amount and the budget, and names the grant for the ledger', async () => {
    updateConfig((c) => ({ ...c, budget: { currency: 'USD', monthly: 20, categories: {} } }));
    expect(authorizeSpend({ category: 'infrastructure', amount: 5 }, 's1')).toMatchObject({ ok: false, reason: 'no-grant' });
    // earn the offer for spend by the figures a spend flow records
    const { noteProposed, noteDecision } = await import('../src/main/effectGrants');
    for (let i = 0; i < 2; i++) {
      noteProposed('spend');
      noteDecision('spend', `sp${i}`, 'approved');
    }
    expect(() => call('autonomy:grant', 'spend')).toThrow(/most one spend|maior valor/);
    const g = call('autonomy:grant', 'spend', 8) as { id: string };
    expect(authorizeSpend({ category: 'infrastructure', amount: 5 }, 's2')).toEqual({ ok: true, allowedBy: `grant:${g.id}` });
    expect(authorizeSpend({ category: 'infrastructure', amount: 9 }, 's3')).toMatchObject({ ok: false, reason: 'threshold' });
    expect(authorizeSpend({ category: 'infrastructure', amount: 8 }, 's4')).toMatchObject({ ok: true });
    // 5 + 8 spent was not recorded in the ledger here: the budget still refuses what it could not hold
    updateConfig((c) => ({ ...c, budget: { currency: 'USD', monthly: 0, categories: {} } }));
    expect(authorizeSpend({ category: 'infrastructure', amount: 1 }, 's5')).toMatchObject({ ok: false, reason: 'budget' });
  });
});
