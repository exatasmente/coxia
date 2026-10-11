// What a paired browser may do with the questions an agent leaves at a turn limit (#246): see them and answer them, on purpose and without the external-effects switch.
// The two channels are named in webPolicy.ts as open, and any other `turnAsks:` channel is denied by a pattern, so a later change of the default cannot close or open them
// by accident.
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_ASKS_EVENT } from '../src/shared/turnLimit';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, TURN_ASK_CHANNELS, webAccess, webRefusal } from '../src/main/webPolicy';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
const { moduleList } = await import('../src/main/modules');
const { register, turnAsks } = await import('../src/main/turnAsks');
const { bindIpc, handle, invoke } = await import('../src/main/rpc');
const { listAudit } = await import('../src/main/auditoria');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

const SRC = join(import.meta.dirname, '../src/main');
const CHANNELS = ['turnAsks:list', 'turnAsks:answer'];

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
const events: { type: string; name?: string; payload?: { id: string }[] }[] = [];
const notices: { title: string; body: string; onClick: unknown }[] = [];
register({ handle: (channel, fn) => handle(channel, fn as never), notify: (n) => void notices.push(n as never), emit: (e) => void events.push(e as never), job: () => undefined });
const window = (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);
const paired = (channel: string, ...args: unknown[]) => invoke(channel, args, 'device-1');

const record = (over: Record<string, unknown> = {}) => ({ of: 'sub' as const, run: 'r1', thread: 'run-r1', ref: 'app#123', issue: 123, stage: 'review', agent: 'reviewer', name: 'Reviewer', kind: 'explore', task: 'map the tests', used: 12, round: 12, granted: 0, canContinue: true, ...over });

describe('web policy for the turn limit channels', () => {
  it.each(CHANNELS)('lets a paired browser use %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('allow');
    expect(webRefusal(channel, false)).toBeNull();
    expect(webRefusal(channel, true)).toBeNull();
  });

  it('names exactly the two channels as open, and puts none of them in a set of the policy', () => {
    expect([...TURN_ASK_CHANNELS].sort()).toEqual([...CHANNELS].sort());
    for (const channel of CHANNELS) {
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
  });

  it.each(['turnAsks:made-up', 'turnAsks:', 'turnAsks:list2', 'turnAsks:answer:x', 'turnAsks:answers', 'turnAsks:LIST', 'turnAsks:list:all', 'turnAsks:config', 'turnAsks:clear'])('denies %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
  });

  it('does not mistake a channel that only has the word in its name for one of them', () => {
    expect(webAccess('runs:turnAsks:list')).toBe('allow');
    expect(webAccess('myturnAsks:list')).toBe('allow');
  });

  it('classifies every turnAsks channel a module registers: the two open, no other', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(turnAsks:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual([...CHANNELS].sort());
    for (const channel of served) expect(webAccess(channel), channel).toBe('allow');
  });

  it('registers the module in the list the app registers, and has no channel for an agent answerer', () => {
    expect(moduleList()).toContain(register);
    for (const channel of CHANNELS) expect(ipc.has(channel), channel).toBe(true);
    for (const f of readdirSync(join(SRC, 'engine'), { recursive: true }).map(String).filter((x) => x.endsWith('.ts'))) {
      expect(readFileSync(join(SRC, 'engine', f), 'utf8'), f).not.toMatch(/turnAsks:/);
    }
  });
});

describe('the channels', () => {
  beforeEach(() => {
    events.length = 0;
    notices.length = 0;
  });
  afterEach(() => saveConfig({ ...getConfig(), notifications: true }));

  it('lists what waits, publishes the whole list on its event and notifies once, opening the run', async () => {
    const waiting = turnAsks.ask(record());
    const [item] = turnAsks.list();
    expect(await window('turnAsks:list')).toEqual([item]);
    expect(await paired('turnAsks:list')).toEqual([item]);
    expect(events.filter((e) => e.name === TURN_ASKS_EVENT).at(-1)?.payload?.map((a) => a.id)).toEqual([item.id]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ onClick: { type: 'open', screen: { name: 'run', id: 'r1' } } });
    expect(notices[0].title).toContain('Reviewer');
    await window('turnAsks:answer', item.id, 'finish');
    await waiting;
    expect(events.filter((e) => e.name === TURN_ASKS_EVENT).at(-1)?.payload).toEqual([]);
  });

  it('opens the conversation for a question outside a run, and today when there is no thread', async () => {
    const a = turnAsks.ask(record({ run: null, thread: 'general' }));
    expect(notices.at(-1)).toMatchObject({ onClick: { type: 'open', screen: { name: 'forum', thread: 'general' } } });
    const b = turnAsks.ask(record({ run: null, thread: '' }));
    expect(notices.at(-1)).toMatchObject({ onClick: { type: 'navigate', to: 'today' } });
    for (const q of turnAsks.list()) await window('turnAsks:answer', q.id, 'finish');
    await Promise.all([a, b]);
  });

  it('lets the window answer and a paired browser answer, and the audit says which, with no task text in it', async () => {
    const first = turnAsks.ask(record({ task: 'secret-looking task text' }));
    const id1 = turnAsks.list()[0].id;
    expect(await window('turnAsks:answer', id1, 'continue')).toEqual({ ok: true });
    await expect(first).resolves.toEqual({ decision: 'continue', by: 'person' });
    const second = turnAsks.ask(record({ of: 'stage', kind: null, task: '' }));
    const id2 = turnAsks.list()[0].id;
    expect(await paired('turnAsks:answer', id2, 'finish')).toEqual({ ok: true });
    await expect(second).resolves.toEqual({ decision: 'finish', by: 'person' });
    const lines = listAudit().filter((e) => e.kind === 'turn-limit');
    // The newest line is the first.
    expect(lines[0]).toMatchObject({ target: 'turns:stage', via: 'paired', issue: 123, ok: true, fields: { decision: 'finish', through: 'paired', of: 'stage', agent: 'reviewer', run: 'r1' }, origin: { kind: 'turn-limit', key: id2 } });
    expect(lines[1]).toMatchObject({ target: 'turns:sub', via: 'window', fields: { decision: 'continue', through: 'window', kind: 'explore', used: '12', round: '12', granted: '0' } });
    expect(JSON.stringify(lines)).not.toContain('secret-looking task text');
  });

  it('says a question is gone, or that the decision is not one, and answers nothing in either case', async () => {
    expect(await window('turnAsks:answer', 'no-such-question', 'finish')).toEqual({ ok: false, reason: 'gone' });
    expect(await paired('turnAsks:answer', 'no-such-question', 'finish')).toEqual({ ok: false, reason: 'gone' });
    const waiting = turnAsks.ask(record());
    const id = turnAsks.list()[0].id;
    for (const bad of ['maybe', undefined, 3, 'Continue']) expect(await window('turnAsks:answer', id, bad)).toEqual({ ok: false, reason: 'decision' });
    expect(turnAsks.list()).toHaveLength(1);
    await window('turnAsks:answer', id, 'finish');
    await waiting;
    // a second answer, and one after the work ended, are gone and change nothing
    expect(await window('turnAsks:answer', id, 'continue')).toEqual({ ok: false, reason: 'gone' });
    const before = listAudit().filter((e) => e.kind === 'turn-limit').length;
    expect(await paired('turnAsks:answer', id, 'continue')).toEqual({ ok: false, reason: 'gone' });
    expect(listAudit().filter((e) => e.kind === 'turn-limit')).toHaveLength(before);
  });

  it('refuses continue for a question whose engine cannot, from either door', async () => {
    const waiting = turnAsks.ask(record({ canContinue: false }));
    const id = turnAsks.list()[0].id;
    expect(await window('turnAsks:answer', id, 'continue')).toEqual({ ok: false, reason: 'decision' });
    expect(await paired('turnAsks:answer', id, 'continue')).toEqual({ ok: false, reason: 'decision' });
    expect(await window('turnAsks:answer', id, 'finish')).toEqual({ ok: true });
    await waiting;
  });

  it('says nothing when the person switched notifications off', async () => {
    saveConfig({ ...getConfig(), notifications: false });
    const waiting = turnAsks.ask(record());
    expect(notices).toEqual([]);
    await window('turnAsks:answer', turnAsks.list()[0].id, 'finish');
    await waiting;
  });
});
