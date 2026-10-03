import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { setLanguage } from '../src/shared/i18n';
import type { Decision, Minutes, PriorityChange } from '../src/shared/types';
import { fakeGitlabRuntime } from './helpers/vcs';

// After the call: a priority decision becomes a label proposal in Actions, which waits for its own "yes" like every other write.

const guard = vi.hoisted(() => ({ test: false }));
vi.mock('../src/main/workspace', async (orig) => {
  const refusal = (what: string) => (guard.test ? `test workspace: ${what}` : null);
  return {
    ...(await orig<typeof import('../src/main/workspace')>()),
    externalRefusal: refusal,
    assertExternalWrite: (what: string) => {
      const message = refusal(what);
      if (message) throw new Error(message);
    },
  };
});

let store: typeof import('../src/main/store');
let actions: typeof import('../src/main/actions');
let vcs: typeof import('../src/main/vcs');
let ATAS: string;
const ran: { method: string; endpoint: string; fields: Record<string, string> }[] = [];

const change = (over: Partial<PriorityChange> = {}): PriorityChange => ({ to: 'first', from: 'P1', label: 'P0', add: 'P0', remove: ['P1'], noWrite: null, project: 'acme/app', iid: 12, title: 'Fix the export', ...over });
const decision = (over: Partial<PriorityChange> = {}, extra: Partial<Decision> = {}): Decision => ({ ref: 'app#12', text: 'Prioridade de app#12: P1 → P0', target: 'priority', dest: 'proposta de troca de rótulo em Ações, à espera do seu "sim"', priority: change(over), ...extra });
const minutes = (decisions: Decision[]): Minutes => ({ startedAt: '2026-10-02T09:40:00Z', endedAt: '2026-10-02T09:50:00Z', decisions, effects: [], unanswered: [], transcript: [] });

beforeAll(async () => {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  saveConfig(neutralConfig());
  ATAS = (await import('../src/main/env')).ATAS;
  store = await import('../src/main/store');
  actions = await import('../src/main/actions');
  vcs = await import('../src/main/vcs');
});

beforeEach(() => {
  setLanguage('pt-BR');
  guard.test = false;
  ran.length = 0;
  for (const name of readdirSync(ATAS)) if (name !== 'config.json' && name !== 'secrets.json') rmSync(join(ATAS, name), { recursive: true, force: true });
  vcs.setVcsRuntimeForTests(
    fakeGitlabRuntime(
      async () => {
        throw new Error('the save must not read the host');
      },
      undefined,
      async (command) => {
        ran.push({ method: command.method, endpoint: command.endpoint, fields: command.fields });
        return 'ok';
      },
    ),
  );
});

afterAll(() => vcs.setVcsRuntimeForTests(null));

describe('a priority decision after the call', () => {
  it('becomes a proposal that takes the old priority label off and puts the new one on, and waits in Actions', async () => {
    const saved = await store.saveMinutes(minutes([decision()]), '', [0]);
    expect(saved.written).toEqual([{ ref: 'app#12', dest: expect.stringContaining('Ações'), ok: true, detail: 'proposta criada em Ações' }]);
    const [action] = actions.listActions();
    expect(actions.listActions()).toHaveLength(1);
    expect(action).toMatchObject({ kind: 'gitlab', state: 'pending', issue: 12, issueTitle: 'Fix the export', summary: 'Prioridade de app#12: P1 → P0' });
    expect(action.command).toMatchObject({ method: 'PUT', endpoint: 'projects/acme%2Fapp/issues/12', fields: { add_labels: 'P0', remove_labels: 'P1' } });
    expect(ran).toEqual([]);
  });

  it('keeps the labels it does not own: only the ones named are in the command, and one already on the issue is not added again', async () => {
    await store.saveMinutes(minutes([decision({ add: null, remove: ['P1', 'P2'] })]), '', [0]);
    expect(actions.listActions()[0].command).toMatchObject({ fields: { remove_labels: 'P1,P2' } });
    expect(actions.listActions()[0].command?.fields).not.toHaveProperty('add_labels');
  });

  it('is run only by approving it, and approving it changes the label through the audited executor', async () => {
    await store.saveMinutes(minutes([decision()]), '', [0]);
    const [action] = actions.listActions();
    expect(ran).toEqual([]);
    const done = await actions.approveAction(action.id);
    expect(done.state).toBe('done');
    expect(ran).toEqual([{ method: 'PUT', endpoint: 'projects/acme%2Fapp/issues/12', fields: { add_labels: 'P0', remove_labels: 'P1' } }]);
  });

  it('is refused by a test workspace, at the save and, if it got there, at the approval', async () => {
    await store.saveMinutes(minutes([decision()]), '', [0]);
    const [action] = actions.listActions();
    guard.test = true;
    await expect(actions.approveAction(action.id)).rejects.toThrow(/test workspace/);
    expect(ran).toEqual([]);
    rmSync(join(ATAS, 'acoes.json'), { force: true });
    const saved = await store.saveMinutes(minutes([decision({}, { ref: 'app#13' })]), '', [0]);
    expect(saved.written[0]).toMatchObject({ ok: false, detail: 'workspace de testes: ficou só na ata' });
    expect(actions.listActions()).toEqual([]);
  });

  it('is not proposed twice on the same day, and says so', async () => {
    await store.saveMinutes(minutes([decision()]), '', [0]);
    const again = await store.saveMinutes(minutes([decision()]), '', [0]);
    expect(actions.listActions()).toHaveLength(1);
    expect(again.written[0].detail).toBe('já existe uma proposta igual em Ações');
  });

  it('only the decisions the person kept selected are written', async () => {
    const other = decision({ to: 'later', label: 'P2', add: 'P2' }, { ref: 'app#14' });
    other.priority = change({ to: 'later', label: 'P2', add: 'P2', iid: 14 });
    await store.saveMinutes(minutes([decision(), other]), '', [1]);
    expect(actions.listActions().map((a) => a.issue)).toEqual([14]);
  });
});

describe('a priority decision that cannot be written', () => {
  it.each(['unconfigured', 'unmapped', 'same', 'unidentified', 'unsupported'] as const)('stays in the minutes (%s): no proposal, and no refusal either', async (noWrite) => {
    guard.test = true;
    const d = decision({ noWrite, label: null, add: null, remove: [] }, { dest: `ata (não gravado no tracker: ${noWrite})` });
    const saved = await store.saveMinutes(minutes([d]), '', [0]);
    expect(saved.written[0]).toMatchObject({ ok: true, dest: d.dest });
    expect(actions.listActions()).toEqual([]);
  });

  it('puts the line that says so in the minutes file', async () => {
    const d = decision({ noWrite: 'unconfigured', label: null, add: null, remove: [] }, { text: 'Prioridade de app#12: vai primeiro', dest: 'ata (não gravado no tracker: este workspace não tem rótulos de prioridade configurados)' });
    const saved = await store.saveMinutes(minutes([d]), '', [0]);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(saved.ataPath, 'utf8')).toContain('- app#12: Prioridade de app#12: vai primeiro → ata (não gravado no tracker: este workspace não tem rótulos de prioridade configurados)');
  });

  it('on a host that cannot change labels, a proposal that would be planned is reported and nothing is created', async () => {
    const { VcsError } = await import('../src/main/vcs/errors');
    vcs.setVcsRuntimeForTests({ provider: { planWrite: async () => { throw new VcsError('unsupported', { kind: 'Bitbucket', what: 'labels' }); } } } as never);
    const saved = await store.saveMinutes(minutes([decision()]), '', [0]);
    expect(saved.written[0].ok).toBe(false);
    expect(saved.written[0].detail).toMatch(/^proposta não criada: /);
    expect(actions.listActions()).toEqual([]);
  });
});
