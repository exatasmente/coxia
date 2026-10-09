// The channels of a hand-off (#178): take the screen, give it back and read its picture are the desktop window's (`screen:`, denied to a paired browser by the pattern), and
// declining is open. This file is what each does, over the real hub (a fake display) and the real service; who is let through is the web policy's (screen-policy, runs-policy).
// A paired browser's read of the same screen is `held` while the person has it, and the person's own read is the picture.
import { describe, expect, it } from 'vitest';
import { RunError } from '../src/shared/runs';
import { createScreenAsks } from '../src/main/browser/asks';
import { createHandoffService } from '../src/main/screen/handoff';
import { createScreenHub } from '../src/main/screen/hub';
import { handoffChannels } from '../src/main/screen/module';
import { rpcContext } from '../src/main/errorlog-core';
import { fakeConn } from './helpers/screen';

const KEY = 'run:r-1';
const MARKER = 'zq-marker-9137';

async function world() {
  const conn = fakeConn();
  const hub = createScreenHub({
    enabled: true,
    encoder: { encode: (frame, width) => ({ jpeg: Uint8Array.from([0xff, 0xd8, frame.data[0]]), width, height: width / 2 }) },
    connect: async () => conn,
    schedule: () => () => undefined,
    note: () => undefined,
  });
  await hub.open({ key: KEY, thread: 'run-r-1', stage: 'qa', agent: 'qa', socket: '/x/X99', kind: 'sandbox' });
  const asks = createScreenAsks({ changed: () => undefined, audit: () => undefined });
  const service = createHandoffService({ hub, asks, say: () => undefined, schedule: () => () => undefined });
  const call = service.begin({ key: KEY, thread: 'run-r-1', place: 'stage', stage: 'qa', agent: 'qa', agentName: 'QA', about: '', paths: { browser: true, shell: 'none' }, pause: () => () => undefined, signal: new AbortController().signal });
  const channels = handoffChannels({ service: () => service, hub: () => hub });
  const ask = () => asks.list(KEY).find((a) => a.kind === 'handoff')!;
  return { hub, service, call, channels, ask, asks };
}

describe('taking the screen, reading it and giving it back', () => {
  it('walks a hand-off through the three channels, and the phone reads `held` while the person reads the picture', async () => {
    const w = await world();
    const asked = w.call.request({ what: 'Log in to the site' });
    // Nothing is withheld while it is only asked.
    expect((await w.hub.frame(KEY, 0, 640)).state).toBe('frame');
    expect(await w.channels['screen:handoffTake'](KEY, w.ask().id)).toEqual({ ok: true });
    expect(w.call.active()).toBe(true);
    // The read of a paired browser (`runs:screen`) is withheld; the person's own read is the picture.
    expect(await w.hub.frame(KEY, 0, 640)).toEqual({ state: 'held' });
    const mine = await w.channels['screen:handoffFrame'](KEY, 0, 640);
    expect(mine.state).toBe('frame');
    expect(mine).toMatchObject({ jpeg: expect.any(Uint8Array) });
    expect(await w.channels['screen:handoffGive'](KEY)).toEqual({ ok: true });
    expect(await asked).toBe('done');
    expect(w.call.active()).toBe(false);
    expect((await w.hub.frame(KEY, 0, 640)).state).toBe('frame');
  });

  it('answers a state, never an error, for a request that is gone, taken already, or for a screen that ended', async () => {
    const w = await world();
    const asked = w.call.request({ what: 'Log in' });
    const id = w.ask().id;
    expect(await w.channels['screen:handoffTake'](KEY, 'ask-nobody')).toEqual({ ok: false, reason: 'gone' });
    expect(await w.channels['screen:handoffTake'](KEY, 7)).toEqual({ ok: false, reason: 'gone' });
    expect(await w.channels['screen:handoffTake'](KEY, id)).toEqual({ ok: true });
    expect(await w.channels['screen:handoffTake'](KEY, id)).toEqual({ ok: false, reason: 'taken' });
    expect(await w.channels['screen:handoffGive']('run:r-404')).toEqual({ ok: false, reason: 'gone' });
    expect(await w.channels['screen:handoffFrame']('run:r-404', 0, 640)).toEqual({ state: 'none' });
    w.channels['screen:handoffGive'](KEY);
    await asked;
    expect(w.channels['screen:handoffGive'](KEY)).toEqual({ ok: false, reason: 'gone' });
  });

  it('refuses a call that is not formed, and says there is nothing when the runner has no service or hub yet', async () => {
    const w = await world();
    await expect(w.channels['screen:handoffTake'](7, 'x')).rejects.toBeInstanceOf(RunError);
    expect(() => w.channels['screen:handoffGive'](null)).toThrow(RunError);
    await expect(w.channels['screen:handoffFrame']({}, 0, 640)).rejects.toBeInstanceOf(RunError);
    const none = handoffChannels({ service: () => null, hub: () => null });
    expect(await none['screen:handoffTake'](KEY, 'x')).toEqual({ ok: false, reason: 'none' });
    expect(none['screen:handoffGive'](KEY)).toEqual({ ok: false, reason: 'none' });
    expect(await none['screen:handoffFrame'](KEY, 0, 640)).toEqual({ state: 'none' });
  });

  it('reads a made-up since and width as the first picture of the default size', async () => {
    const w = await world();
    const frame = await w.channels['screen:handoffFrame'](KEY, Number.NaN, 'wide');
    expect(frame.state).toBe('frame');
  });
});

describe('declining', () => {
  it('ends a request nobody took, with the agent told so, and cannot end one the person holds', async () => {
    const w = await world();
    const asked = w.call.request({ what: 'Log in' });
    const id = w.ask().id;
    expect(w.service.decline('ask-nobody')).toEqual({ ok: false, reason: 'gone' });
    expect(w.service.decline(id)).toEqual({ ok: true });
    expect(await asked).toBe('declined');
    // One decline is final for the call: a second request answers unavailable.
    expect(await w.call.request({ what: 'Again' })).toBe('unavailable');
    const w2 = await world();
    const taken = w2.call.request({ what: 'Log in' });
    await w2.channels['screen:handoffTake'](KEY, w2.ask().id);
    expect(w2.service.decline(w2.ask().id)).toEqual({ ok: false, reason: 'taken' });
    w2.channels['screen:handoffGive'](KEY);
    expect(await taken).toBe('done');
  });
});

describe('what a failed call of these channels may say about itself', () => {
  it('is the channel and the way it came in, never the key, the ask or what the person typed', () => {
    const typed = [{ t: 'key', key: MARKER, down: true }];
    for (const channel of ['screen:input', 'screen:handoffTake', 'screen:handoffGive', 'screen:handoffFrame', 'runs:handoffDecline']) {
      for (const via of ['ipc', 'web'] as const) {
        const context = rpcContext(channel, [KEY, typed, MARKER], via);
        expect(context, channel).toEqual({ channel, via });
        expect(JSON.stringify(context)).not.toContain(MARKER);
      }
    }
  });
});
