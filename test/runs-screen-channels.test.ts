// The channels that list, close, stop and answer (acceptance 10 and 11 of #177), driven through the runner's module with the window's door and a paired browser's: who is let
// through is the web policy's (runs-policy.test.ts); this file is what each channel does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, nativeImage: {} }));

const { runsModule, screenAsks, screenSessions } = await import('../src/main/runner/module');
const { callStops } = await import('../src/main/mentions/stop');
const { bindIpc, handle, invoke } = await import('../src/main/rpc');
const { listAudit } = await import('../src/main/auditoria');
const { SCREEN_ASKS_EVENT } = await import('../src/shared/browser');

type Handler = (...args: unknown[]) => unknown;
const events: { type: string; name?: string; payload?: { asks?: { id: string }[] } }[] = [];
const notices: { title: string; body: string; onClick: unknown }[] = [];
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
vi.useFakeTimers({ toFake: ['setTimeout'] });
runsModule({
  handle: (channel, fn) => handle(channel, fn as never),
  notify: (n) => void notices.push(n as never),
  emit: (e) => void events.push(e as never),
  job: () => undefined,
});
vi.useRealTimers();

const window = (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);
const paired = (channel: string, ...args: unknown[]) => invoke(channel, args, 'device-1');

afterEach(() => {
  events.length = 0;
  notices.length = 0;
});

describe('the channels are served', () => {
  it('has the four, next to the frame read', () => {
    for (const channel of ['runs:screens', 'runs:screenClose', 'runs:callStop', 'runs:screenAnswer', 'runs:screen']) expect(ipc.has(channel), channel).toBe(true);
  });
});

describe('runs:screens and runs:screenClose', () => {
  it('lists nothing where no screen is open, for a thread or for all, and never throws on a made-up thread', () => {
    expect(window('runs:screens')).toEqual([]);
    expect(window('runs:screens', 'run-nothing')).toEqual([]);
    expect(window('runs:screens', 42)).toEqual([]);
    expect(screenSessions()?.list()).toEqual([]);
  });

  it('closes nothing for a key that is not open or not a key, and says so without throwing', async () => {
    for (const key of ['call:general:nobody', 'run:r-404', 'r-404', '', 'a:b', 7, null]) expect(await window('runs:screenClose', key), String(key)).toBe(false);
  });
});

describe('runs:callStop', () => {
  it('aborts the answer of that agent in that thread and only that one', () => {
    const mine = new AbortController();
    const other = new AbortController();
    const drop = callStops.register('general', 'dev', mine);
    callStops.register('general', 'ops', other);
    expect(window('runs:callStop', 'general', 'dev')).toBe(true);
    expect(mine.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    drop();
    expect(window('runs:callStop', 'general', 'dev')).toBe(false);
    expect(window('runs:callStop', 'general', 'nobody')).toBe(false);
    expect(window('runs:callStop', 3, {})).toBe(false);
  });
});

describe('runs:screenAnswer', () => {
  beforeEach(async () => {
    const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
    saveConfig({ ...getConfig(), notifications: true });
  });

  const ask = () => {
    const asks = screenAsks()!;
    const pending = asks.confirm({ key: 'call:general:dev', agent: 'dev', place: 'conversation', confirmKind: 'send', words: 'send the report' });
    return { pending, id: asks.list()[0].id };
  };

  it('lets the window answer, and the audit says the window did', async () => {
    const { pending, id } = ask();
    expect(await window('runs:screenAnswer', id, 'yes')).toEqual({ ok: true });
    await expect(pending).resolves.toEqual({ answer: 'yes' });
    // The newest line is the first.
    const line = listAudit().filter((e) => e.kind === 'screen-confirm')[0];
    expect(line).toMatchObject({ kind: 'screen-confirm', fields: { answer: 'yes', through: 'window' } });
  });

  it('knows a paired browser by the door it came through, and says that in the audit', async () => {
    const { pending, id } = ask();
    expect(await paired('runs:screenAnswer', id, 'no', 'not now')).toEqual({ ok: true });
    await expect(pending).resolves.toEqual({ answer: 'no', note: 'not now' });
    expect(listAudit().filter((e) => e.kind === 'screen-confirm')[0]).toMatchObject({ fields: { answer: 'no', through: 'paired' } });
  });

  it('says a question is gone, or that the decision is not one, and answers nothing in either case', async () => {
    expect(await window('runs:screenAnswer', 'no-such-ask', 'yes')).toEqual({ ok: false, reason: 'gone' });
    const { pending, id } = ask();
    expect(await window('runs:screenAnswer', id, 'maybe')).toEqual({ ok: false, reason: 'decision' });
    expect(await window('runs:screenAnswer', id, undefined)).toEqual({ ok: false, reason: 'decision' });
    expect(screenAsks()?.list()).toHaveLength(1);
    await window('runs:screenAnswer', id, 'no');
    await pending;
    expect(await window('runs:screenAnswer', id, 'yes')).toEqual({ ok: false, reason: 'gone' });
  });

  it('publishes the pending questions on every change and notifies the person once, opening the conversation', async () => {
    const { pending, id } = ask();
    const asked = events.filter((e) => e.name === SCREEN_ASKS_EVENT);
    expect(asked.at(-1)?.payload?.asks?.map((a) => a.id)).toEqual([id]);
    await window('runs:screenAnswer', id, 'yes');
    await pending;
    expect(events.filter((e) => e.name === SCREEN_ASKS_EVENT).at(-1)?.payload?.asks).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ onClick: { type: 'open', screen: { name: 'forum', thread: 'general' } } });
    expect(notices[0].title).toContain('dev');
  });

  it('says nothing when the person switched notifications off', async () => {
    const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
    saveConfig({ ...getConfig(), notifications: false });
    const { pending, id } = ask();
    expect(notices).toEqual([]);
    await window('runs:screenAnswer', id, 'yes');
    await pending;
    saveConfig({ ...getConfig(), notifications: true });
  });
});
