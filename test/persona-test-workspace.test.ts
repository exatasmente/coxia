// The persona in a workspace with `test: true` (#248): the guard is inside the handlers and stays there. Every act that leaves the machine is refused by the same message the person
// gets, returned as a tool error and recorded as not done; what is local to the machine (the configuration, the memory) is as open to the persona as to the person.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { setLanguage } from '../src/shared/i18n';
import { agentThreadId } from '../src/shared/forum';
import { fakeGitlabRuntime } from './helpers/vcs';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { createSession } = await import('../src/main/persona/session');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore } = await import('../src/main/forum');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { writeRegistry } = await import('../src/main/workspaces-core');
const { memoryStore } = await import('../src/main/memory/instance');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const actions = await import('../src/main/actions');

const THREAD = agentThreadId('me');
const session = () => createSession({ persona: 'me', thread: THREAD, seq: 2, door: 'window' });
const why = 'Because the person asked me to.';
const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });
const newest = (kind: AuditEntry['kind']): AuditEntry => listAudit().filter((e) => e.kind === kind)[0];
const ran: string[] = [];

beforeAll(async () => {
  setLanguage('en');
  const base = neutralConfig();
  saveConfig({
    ...base,
    language: 'en',
    agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] },
    devCycle: { ...base.devCycle, stages: [{ id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 }] },
  });
  const { ensureAgentThread } = await import('../src/main/forum-channels');
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  const { configModule } = await import('../src/main/configModule');
  const { register: board } = await import('../src/main/board');
  const { memoryModule } = await import('../src/main/memory/module');
  bindIpc(() => undefined);
  for (const register of [configModule, board, memoryModule]) register({ handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined } as never);
  handle('actions:approve', ((id: string) => actions.approveAction(id)) as never);
  setVcsRuntimeForTests(fakeGitlabRuntime(async () => ({}), undefined, async (command) => (ran.push(`${command.method} ${command.endpoint}`), 'ok')));
});

describe('a workspace of test', () => {
  it('refuses an approval, with the message the person gets, and records it as not done by the act that attempted it', async () => {
    asReal(false);
    const proposal = actions.proposeVcsAction({ key: 'k-test-ws', issue: 12, issueTitle: 'Fix', summary: 'Comment on the issue', command: { via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/issues/12/notes', fields: { body: 'hello' } } });
    if (!proposal) throw new Error('no proposal');
    asReal(true);
    await expect(personaDoor.run(session(), 'Actions', { op: 'approve', id: proposal.id, why })).rejects.toThrow(/Test workspace/);
    expect(ran).toEqual([]);
    expect(newest('act')).toMatchObject({ ok: false, target: 'Actions.approve', actor: 'persona', basis: { subject: expect.stringContaining('Comment on the issue') } });
    expect(actions.listActions().find((a) => a.id === proposal.id)?.state).toBe('pending');
  });

  it('refuses a write of the board and a proposal of a priority', async () => {
    asReal(true);
    await expect(personaDoor.run(session(), 'Board', { op: 'create', title: 'A card', column: 'backlog', why })).rejects.toThrow(/Test workspace/);
    expect(newest('act')).toMatchObject({ ok: false, target: 'Board.create' });
    await expect(personaDoor.run(session(), 'Board', { op: 'proposePriority', ref: 'app#1', to: 'first', why })).rejects.toThrow(/Test workspace/);
    expect(newest('act')).toMatchObject({ ok: false, target: 'Board.proposePriority' });
  });

  it('lets a change of the configuration through, as it lets the person, and records it', async () => {
    asReal(true);
    const was = getConfig().notifications;
    await personaDoor.run(session(), 'Settings', { op: 'set', path: 'notifications', value: !was, why });
    expect(getConfig().notifications).toBe(!was);
    expect(newest('config')).toMatchObject({ actor: 'persona', ok: true, fields: { notifications: `${was} → ${!was}` } });
  });

  it('lets a note of the memory be reviewed, which stays on the machine', async () => {
    asReal(true);
    const made = memoryStore().save({ scope: { conversation: 'general', agent: 'me' }, kind: 'note', title: 'A note', text: 'Text of the note.' });
    if (!made.ok) throw new Error(made.text);
    const out = await personaDoor.run(session(), 'Memory', { op: 'review', conversation: 'general', agent: 'me', id: made.note.id, why });
    expect(out).toMatch(/^Done\./);
    expect(listAudit().find((e) => e.kind === 'memory' && e.actor === 'persona')).toMatchObject({ via: 'persona', fields: { surface: 'persona' }, by: 'persona' });
  });

  it('is the same in a workspace that is not a test one: the approval goes out, stamped', async () => {
    asReal(false);
    const proposal = actions.proposeVcsAction({ key: 'k-real-ws', issue: 13, issueTitle: 'Fix', summary: 'Comment again', command: { via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/issues/13/notes', fields: { body: 'hello again' } } });
    if (!proposal) throw new Error('no proposal');
    await personaDoor.run(session(), 'Actions', { op: 'approve', id: proposal.id, why });
    expect(ran).toEqual(['POST projects/acme%2Fweb/issues/13/notes']);
    expect(listAudit().find((e) => e.target === 'POST projects/acme%2Fweb/issues/13/notes')).toMatchObject({ actor: 'persona', ok: true });
  });
});
