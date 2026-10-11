// Secrets and the persona's door (#248): it lists names and sources, sets and removes them through the same channels, and may read a value through the one operation that has
// no channel. The value reaches the model and nothing else: from the moment it is read, everything stored or shown from the answer holds the masked form, and the audit line
// of a read has the name and nothing else.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { setLanguage } from '../src/shared/i18n';
import type { ForumMessage } from '../src/shared/forum';
import { agentThreadId } from '../src/shared/forum';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const VALUE = 'correct-horse-battery-staple-9';
process.env.PERSONA_TEST_SECRET = VALUE;

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { createSession } = await import('../src/main/persona/session');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore } = await import('../src/main/forum');
const { saveConfig } = await import('../src/main/workspaceConfig');
const { DATA_ROOT, ATAS } = await import('../src/main/env');
const { readEntries } = await import('../src/main/errorlog-core');

const THREAD = agentThreadId('me');
const session = () => createSession({ persona: 'me', thread: THREAD, seq: 3, door: 'window' });
const messages = (): ForumMessage[] => forumStore().read(THREAD, 0, 2000)?.messages ?? [];
const why = 'The person asked me to use it.';

beforeAll(async () => {
  setLanguage('en');
  const base = neutralConfig();
  saveConfig({ ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] } });
  const { ensureAgentThread } = await import('../src/main/forum-channels');
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  const { configModule } = await import('../src/main/configModule');
  const { errorlog } = await import('../src/main/errorlog');
  bindIpc(() => undefined);
  for (const register of [configModule, errorlog]) register({ handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined } as never);
});

describe('the secrets the persona sets, checks and lists', () => {
  it('lists names and sources only: no command line, no variable, no value', async () => {
    const s = session();
    await personaDoor.run(s, 'Secrets', { op: 'set', ref: 'test.listed', source: 'env', name: 'PERSONA_TEST_SECRET', why });
    await personaDoor.run(s, 'Secrets', { op: 'set', ref: 'test.cmd', source: 'command', command: '/usr/local/bin/fetch-key', args: ['--vault', 'private-vault'], why });
    const text = await personaDoor.run(s, 'Secrets', { op: 'list' });
    const list = JSON.parse(text) as { ref: string; source: string; available: boolean }[];
    expect(list.map((x) => x.ref).sort()).toEqual(['test.cmd', 'test.listed']);
    expect(list.find((x) => x.ref === 'test.listed')).toEqual({ ref: 'test.listed', source: 'env', available: true });
    for (const leak of [VALUE, 'PERSONA_TEST_SECRET', 'fetch-key', 'private-vault']) expect(text).not.toContain(leak);
    // a list is a read: nothing in the audit for it, and the secret lines of the two sets say who set them
    expect(listAudit().filter((e) => e.kind === 'secret' && e.fields.op === 'set').map((e) => [e.actor, e.fields.ref, e.fields.source])).toEqual([['persona', 'test.cmd', 'command'], ['persona', 'test.listed', 'env']]);
  });

  it('checks a secret without giving its value', async () => {
    const text = await personaDoor.run(session(), 'Secrets', { op: 'check', ref: 'test.listed' });
    expect(text).not.toContain(VALUE);
  });

  it('removes a secret, and says so in the audit as the persona\'s', async () => {
    await personaDoor.run(session(), 'Secrets', { op: 'remove', ref: 'test.cmd', why });
    const line = listAudit().find((e) => e.kind === 'secret' && e.fields.op === 'remove');
    expect(line).toMatchObject({ actor: 'persona', fields: { ref: 'test.cmd', source: 'command' }, ok: true });
  });

  it('masks a value it was given to set in everything it writes, even when the model quotes it in its reason', async () => {
    const given = 'p4ss-given-by-the-person-1';
    const s = session();
    await expect(personaDoor.run(s, 'Plugins', { op: 'setSecret', id: 'no-such-plugin', key: 'token', value: given, why: `Setting ${given} as asked.` })).rejects.toThrow();
    const stored = JSON.stringify([listAudit().slice(0, 5), messages().slice(-3)]);
    expect(stored).not.toContain(given);
    expect(s.maskText(`the value is ${given}`)).toBe('the value is [secret]');
  });
});

describe('reading a value', () => {
  it('gives the value to the model, once, and masks it in everything stored or shown from then on', async () => {
    const s = session();
    const before = messages().length;
    const value = await personaDoor.run(s, 'Secrets', { op: 'read', ref: 'test.listed', why: `I need ${'the key'} to call the service.` });
    // The one place it reaches the model: Done. then the value as it is.
    expect(value).toContain(VALUE);
    expect(s.maskText(`here: ${VALUE}`)).toBe('here: [secret]');

    // The audit line of the read has the name and the kind of source, and the act wrote no second line.
    const read = listAudit().find((e) => e.kind === 'secret' && e.fields.op === 'read');
    expect(read).toMatchObject({ actor: 'persona', door: 'window', via: 'persona', ok: true, fields: { op: 'read', ref: 'test.listed', source: 'env' } });
    expect(JSON.stringify(read)).not.toContain(VALUE);
    expect(listAudit().filter((e) => e.id === read?.id)).toHaveLength(1);
    // The line in the conversation and the record of what was read hold no value.
    expect(JSON.stringify(messages().slice(before))).not.toContain(VALUE);
    expect(s.reads.at(-1)).toBeUndefined();

    // After the read: a result that contains the value, a reason that quotes it, a subject that names it and an error all come out masked.
    const echo = await personaDoor.run(s, 'Overview', { op: 'markErrorsSeen', why: `The key ${VALUE} was fine.` });
    expect(echo).not.toContain(VALUE);
    const line = listAudit().find((e) => e.kind === 'act');
    expect(JSON.stringify(line)).not.toContain(VALUE);
    expect(line?.said).toBe('The key [secret] was fine.');
    expect(JSON.stringify(messages().slice(before))).not.toContain(VALUE);
    // The error log, the audit file and the forum file hold it nowhere.
    const files = [readFileSync(join(ATAS, 'auditoria.jsonl'), 'utf8'), readFileSync(join(ATAS, 'forum', `${THREAD}.jsonl`), 'utf8'), JSON.stringify(readEntries(join(DATA_ROOT, 'logs')))];
    for (const text of files) expect(text).not.toContain(VALUE);
  });

  it('remembers the name of what it read, not the value, for the decision that follows', async () => {
    const s = session();
    await personaDoor.run(s, 'Secrets', { op: 'read', ref: 'test.listed', why });
    // A read operation is remembered; this is a write (it takes a reason), so the answer's record of reads is untouched by it.
    expect(s.reads).toEqual([]);
    await personaDoor.run(s, 'Secrets', { op: 'check', ref: 'test.listed' });
    expect(JSON.stringify(s.reads)).not.toContain(VALUE);
  });

  it('refuses a secret that does not exist, with a line that says it was refused and no value', async () => {
    const s = session();
    await expect(personaDoor.run(s, 'Secrets', { op: 'read', ref: 'test.nothing', why })).rejects.toThrow(/Secrets\.read failed/);
    expect(listAudit().find((e) => e.kind === 'secret' && e.fields.op === 'read' && !e.ok)).toMatchObject({ actor: 'persona', fields: { ref: 'test.nothing' } });
  });

  it('keeps the read out of a paired browser\'s reach and out of every channel: it has no channel', async () => {
    const { OPS } = await import('../src/main/persona/doorTable');
    expect(OPS.find((o) => o.tool === 'Secrets' && o.op === 'read')?.channel).toBeNull();
  });
});
