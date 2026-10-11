// The line each persona write leaves in its conversation (#248): stored with the thread, worded by whoever reads it, with the id of the audit entry, a button target, the names of
// what a raise gave, at most thirty an answer and one count line for the rest.
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { type ForumMessage, agentThreadId, messageText } from '../src/shared/forum';
import { CATALOGS, setLanguage } from '../src/shared/i18n';
import { parseTarget } from '../src/shared/push';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { createSession, ACT_LINES_MAX } = await import('../src/main/persona/session');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore } = await import('../src/main/forum');
const { createForumStore } = await import('../src/main/forum-core');
const { saveConfig } = await import('../src/main/workspaceConfig');
const { ATAS } = await import('../src/main/env');

const THREAD = agentThreadId('me');
const session = (seq = 4) => createSession({ persona: 'me', thread: THREAD, seq, door: 'window' });
const lines = (code = 'persona.act'): ForumMessage[] => forumStore().read(THREAD, 0, 2000)?.messages.filter((m) => m.code === code) ?? [];
const why = 'Because the person asked me to.';

beforeAll(async () => {
  setLanguage('en');
  const base = neutralConfig();
  saveConfig({ ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] } });
  const { ensureAgentThread } = await import('../src/main/forum-channels');
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  const { configModule } = await import('../src/main/configModule');
  const { errorlog } = await import('../src/main/errorlog');
  const { runsModule } = await import('../src/main/runner/module');
  bindIpc(() => undefined);
  for (const register of [configModule, errorlog, runsModule]) register({ handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined } as never);
});

describe('the line of an act', () => {
  it('is a message of the app with a code and its parameters, stored with the thread, before the answer is posted', async () => {
    const s = session();
    await personaDoor.run(s, 'Overview', { op: 'markErrorsSeen', why });
    const [line] = lines().slice(-1);
    expect(line).toMatchObject({ kind: 'system', author: { type: 'app' }, code: 'persona.act' });
    const audit = listAudit().find((e) => e.kind === 'act');
    expect(line.params).toEqual({ tool: 'Overview', op: 'markErrorsSeen', subject: expect.stringContaining('Overview.markErrorsSeen'), result: 'ok', id: audit?.id });
    // Stored with the thread: a store opened on the same folder, as after a restart, reads it back.
    const reopened = createForumStore(join(ATAS, 'forum'));
    expect(reopened.read(THREAD, 0, 2000)?.messages.find((m) => m.seq === line.seq)?.code).toBe('persona.act');
  });

  it('is worded in the language of whoever reads the thread, by its code', () => {
    const [line] = lines().slice(-1);
    setLanguage('en');
    expect(messageText(line)).toBe(CATALOGS.en['main.forum.code.persona.act'].replace('{tool}', 'Overview').replace('{op}', 'markErrorsSeen').replace('{subject}', String(line.params?.subject)).replace('{result}', 'ok'));
    setLanguage('pt-BR');
    expect(messageText(line)).toContain('A persona fez Overview.markErrorsSeen');
    setLanguage('en');
  });

  it('says a refused act was refused, with the handler\'s reason', async () => {
    await expect(personaDoor.run(session(), 'Runs', { op: 'cancel', run: 'r-nothing', why })).rejects.toThrow();
    const [line] = lines().slice(-1);
    expect(line.params).toMatchObject({ tool: 'Runs', op: 'cancel', result: 'refused' });
    expect(String(line.params?.reason).length).toBeGreaterThan(0);
  });

  it('offers a button only for a target the app can open, as a JSON the app checks', async () => {
    await expect(personaDoor.run(session(), 'Runs', { op: 'cancel', run: 'r-nothing', why })).rejects.toThrow();
    const [line] = lines().slice(-1);
    expect(parseTarget(JSON.parse(String(line.params?.target)))).toEqual({ to: 'run', id: 'r-nothing' });
    await personaDoor.run(session(), 'Overview', { op: 'markErrorsSeen', why });
    expect(lines().slice(-1)[0].params?.target).toBeUndefined();
  });

  it('names what a raise gave, as the audit does', async () => {
    await personaDoor.run(session(), 'Settings', { op: 'set', path: 'agents.team[me].tracker', value: 'read', why });
    await personaDoor.run(session(), 'Settings', { op: 'set', path: 'agents.team[me].shell', value: 'host', why });
    expect(lines().slice(-1)[0].params).toMatchObject({ tool: 'Settings', result: 'ok', raised: 'agents.team[me].shell' });
  });

  it('puts no line in the thread for a read', async () => {
    const before = lines().length;
    await personaDoor.run(session(), 'Overview', { op: 'errorsSummary' });
    expect(lines()).toHaveLength(before);
  });
});

describe('the thirty lines of an answer', () => {
  it('writes thirty lines, counts the rest, and says the rest in one line when the answer ends', async () => {
    const s = session(9);
    const before = lines().length;
    for (let i = 0; i < ACT_LINES_MAX + 5; i++) await personaDoor.run(s, 'Overview', { op: 'markErrorsSeen', why });
    expect(lines().length - before).toBe(ACT_LINES_MAX);
    expect(s.acts).toEqual({ lines: ACT_LINES_MAX, more: 5 });
    // the audit has them all
    expect(listAudit().filter((e) => e.kind === 'act' && e.basis?.message === 9)).toHaveLength(ACT_LINES_MAX + 5);

    personaDoor.finish(s);
    const more = lines('persona.act.more');
    expect(more).toHaveLength(1);
    expect(more[0].params).toEqual({ count: 5 });
    expect(messageText(more[0])).toBe(CATALOGS.en['main.forum.code.persona.act.more_other'].replace('{count}', '5'));
    // finishing again says nothing more
    personaDoor.finish(s);
    expect(lines('persona.act.more')).toHaveLength(1);
  });

  it('says nothing at the end of an answer that stayed within the cap, and starts the count again with the next answer', async () => {
    const s = session(10);
    await personaDoor.run(s, 'Overview', { op: 'markErrorsSeen', why });
    const before = lines('persona.act.more').length;
    personaDoor.finish(s);
    expect(lines('persona.act.more')).toHaveLength(before);
    expect(session(11).acts).toEqual({ lines: 0, more: 0 });
  });
});
